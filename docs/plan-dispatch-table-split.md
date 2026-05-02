# Plan: Split `communication_log.outcomes` into a `dispatch` table

## Context

Today `communication_log` is one row per `(enrollment_id, step_id)` — the per-event idempotency anchor. When a user has N push tokens, the worker sends N notifications and stores all N per-token outcomes inside a single `outcomes jsonb[]` column on that one row (`apps/server/db/schema.ts:168`).

This bites in three places:

1. **Status semantics fight the data.** `delivered` / `undelivered` are per-token concepts forced onto a per-event row, so the row needs aggregation logic ("any error → undelivered") that hides the per-token truth.
2. **Receipt polling walks JSON.** The poller has to load the whole row, filter `outcomes` for `ack.status === "ok"`, merge receipts back into the array, then re-serialise. No useful index, no row-level `receipts_polled_at`.
3. **Dead-token cleanup is a JSON scan.** Finding `DeviceNotRegistered` outcomes means scanning every row's `outcomes` array rather than a real `WHERE` clause.

**Outcome:** keep `communication_log` as the per-event row (claim + audit), and add a new `dispatch` table holding one row per `(communication_log, push_token)`. Per-token state — ack, receipt, status, polling timestamp — moves there.

## Why option (a), and why two tables

We considered three shapes:

- **(b) Claim per `(enrollment, step, token)` in a single per-token table.** Rejected: the claim runs at `enrollment.ts:287` *before* `onSend` resolves tokens. Hoisting token resolution above the claim opens a race — a token registered between resolve and send isn't covered. Also a user with zero tokens leaves no audit row that we tried to send.
- **Single per-token table, claim still at `(enrollment, step)`.** Rejected: the unique key would need to include token to allow N rows, which means the unique constraint no longer prevents two workers from each claiming a *different* token for the same event and double-sending.
- **(a) Two tables — chosen.** `communication_log` keeps its `(enrollment_id, step_id)` unique constraint and remains the idempotency boundary. `dispatch` is a child table with one row per token. Claim flow is unchanged.

## Schema changes

Single new migration via `drizzle-kit generate` (next is `0007_*`; current head is `0006_*` from the receipt-polling work). **Human runs the migration commands — do not run them.**

### `communication_log` — slim down

Drop:

- `provider` (moves to `dispatch`)
- `outcomes` (replaced by `dispatch` rows)
- `receipts_polled_at` (moves to `dispatch`)

Keep `status` but narrow the enum to event-level outcomes only.

### `communication_status` enum — narrow

`apps/server/db/schema.ts:36-42`:

```ts
export const communicationStatusEnum = pgEnum("communication_status", [
  "claimed",
  "dispatched",   // onSend returned, dispatch rows written
  "failed",       // onSend threw or pre-flight refusal before any dispatch row
]);
```

Drop `delivered` and `undelivered` — those concepts now live per-token on `dispatch.status`. Drizzle should detect the value removals; postgres requires recreating the enum (drop + create + re-cast columns) since `DROP VALUE` isn't supported. Confirm the generated SQL handles this correctly during `db:generate`.

### `dispatch_status` enum — new

```ts
export const dispatchStatusEnum = pgEnum("dispatch_status", [
  "dispatched",   // provider accepted (ack ok) — awaiting receipt
  "delivered",    // receipt ok
  "undelivered",  // receipt error, OR pre-flight ack error (terminal at send time)
]);
```

### `dispatch` — new table

```ts
export const dispatch = pgTable(
  "dispatch",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    communicationLogId: uuid("communication_log_id")
      .notNull()
      .references(() => communicationLog.id, { onDelete: "cascade" }),
    provider: deliveryProviderEnum("provider").notNull(),
    token: text("token").notNull(),
    status: dispatchStatusEnum("status").notNull(),
    ack: jsonb("ack").$type<ExpoAck>().notNull(),
    receipt: jsonb("receipt").$type<ExpoReceipt>(),
    receiptsPolledAt: timestamp("receipts_polled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    unique().on(table.communicationLogId, table.token),
  ]
);
```

`(communication_log_id, token)` unique prevents accidental duplicates if a fan-out is replayed.

Index strategy: defer until measured. The poller's hot query is `WHERE status = 'dispatched' AND receipts_polled_at IS NULL AND created_at > NOW() - INTERVAL '23 hours'` — add `CREATE INDEX ON dispatch (created_at) WHERE status = 'dispatched' AND receipts_polled_at IS NULL` if/when it slows.

### Type colocation

Move `ExpoAck` / `ExpoReceipt` from `apps/server/services/notification/poll-receipts.types.ts` to `apps/server/services/notification/dispatch.ts` (the file the original plan already proposed). Drop the `Outcome` type — it's replaced by `dispatch` rows. Schema imports the ack/receipt types from there.

## Send path changes

`apps/server/services/enrollment/send.ts` — return the same per-token shape but rename for clarity (it's no longer an `Outcome`, it's a *prospective dispatch row*):

```ts
return {
  provider: "expo" as const,
  dispatches: messages.map((m, i) => ({
    token: m.to as string,
    ack: tickets[i] as ExpoAck,
  })),
};
```

`enrollment.ts:238-251` (`markCommunicationLogDispatched`) — instead of writing `provider` + `outcomes` onto the log row, it:

1. Inserts N rows into `dispatch` in one statement.
2. Each row's `status` is derived from its ack: `ack.status === "ok"` → `"dispatched"`, `ack.status === "error"` → `"undelivered"` (pre-flight refusal is terminal).
3. Sets `communication_log.status = 'dispatched'` and `sent_at = now()`.

All inside one transaction — partial fan-out is the worst failure mode.

If `onSend` returned no dispatches (zero tokens), still set `status = 'dispatched'` with `sent_at` so the event audit is preserved; no `dispatch` rows written.

## Polling job changes

`apps/server/functions/receipt-poller/index.ts` — the eligibility query becomes per-dispatch:

```ts
const rows = await db
  .select()
  .from(dispatch)
  .where(and(
    eq(dispatch.status, "dispatched"),
    isNull(dispatch.receiptsPolledAt),
    sql`${dispatch.createdAt} > NOW() - INTERVAL '23 hours'`,
  ))
  .limit(500);
```

No more loading `communication_log` rows just to walk their `outcomes`.

`apps/server/services/notification/poll-receipts.ts`:

1. **Group by provider** with `match()` (ts-pattern, exhaustive). Today only `"expo"`.
2. **For Expo dispatches:** pull `ack.id` from each row (we know ack is `ok` because `status = 'dispatched'` filtered out pre-flight errors at insert time).
3. **Chunk + fetch** via `Expo.chunkPushNotificationReceiptIds(...)` and `expo.getPushNotificationReceiptsAsync(...)`. Each chunk call wrapped in try/catch.
4. **Per-row decision** with `ts-pattern` over the receipt:
   - Receipt `ok` → row → `delivered`.
   - Receipt `error` → row → `undelivered`.
   - No receipt for this ack id yet → leave `status = 'dispatched'` and `receipts_polled_at = null`, eligible next tick.
5. **Persist.** One `UPDATE dispatch SET status, receipt, receipts_polled_at WHERE id IN (...)` per outcome bucket, or one row at a time — pick whichever is cleaner; volume is low.
6. **Dead-token cleanup.** Collect tokens where `receipt.details.error === "DeviceNotRegistered"`. (Pre-flight `DeviceNotRegistered` is already captured at send time — see step 7.) Single `DELETE FROM push_token WHERE token = ANY($1)`.
7. **Pre-flight DeviceNotRegistered.** This now happens at send time, not poll time, because `undelivered` dispatches with `ack.status = 'error'` aren't returned by the poller. Either: (a) handle it inline in `markCommunicationLogDispatched` after fan-out (delete tokens whose ack came back `DeviceNotRegistered`), or (b) add a small periodic sweep over `dispatch WHERE status = 'undelivered' AND ack->>'details'->>'error' = 'DeviceNotRegistered' AND <not-yet-cleaned>`. Pick (a) — simpler, no extra column, and the token is already in scope at send time.

Return shape: `{ polled, delivered, undelivered, deferred, deadTokensRemoved }`.

## Files to touch

- `apps/server/db/schema.ts` — narrow `communication_status`; add `dispatch_status` enum + `dispatch` table; drop `provider`/`outcomes`/`receipts_polled_at` from `communication_log`; add `dispatch` relations.
- `apps/server/db/migrations/0007_*.sql` — generated.
- `apps/server/services/notification/dispatch.ts` — **new**, hosts `ExpoAck` / `ExpoReceipt` types (moved from `poll-receipts.types.ts`).
- `apps/server/services/notification/poll-receipts.types.ts` — delete (or shrink to whatever the poller still needs that isn't on schema).
- `apps/server/services/enrollment/send.ts` — return `{ provider, dispatches }` (rename from outcomes).
- `apps/server/services/enrollment/enrollment.ts` — `markCommunicationLogDispatched` writes one log update + N `dispatch` inserts in a transaction; also handles inline pre-flight `DeviceNotRegistered` token deletion.
- `apps/server/services/notification/poll-receipts.ts` — query `dispatch` directly; per-row updates; dead-token cleanup unchanged in spirit.
- `apps/server/functions/receipt-poller/index.ts` — new eligibility query.
- `apps/server/services/enrollment/enrollment.test.ts` — fixtures move from `outcomes` on the log row to `dispatch` rows; status assertions on the log row no longer include `delivered`/`undelivered`.
- `apps/server/services/notification/poll-receipts.test.ts` — restructure around `dispatch` rows (see Tests).

## Tests

`apps/server/services/notification/poll-receipts.test.ts` (rewrite) — real DB via `apps/server/test/db.ts`, run with `sst shell -- bun test`:

1. **Happy path — delivered.** Seed `communication_log` (`dispatched`) + one `dispatch` row (`status=dispatched`, ack ok). Stub receipt fetch → `{ status: "ok" }`. Assert dispatch row → `delivered`, `receipt` populated, `receipts_polled_at` set. Log row untouched.
2. **Receipt error → undelivered.** Same setup, receipt `{ status: "error", ... }`. Dispatch row → `undelivered`.
3. **Two dispatches, mixed outcome.** One log row + two dispatch rows. One receipt ok, one error. Each dispatch row settles independently; the log row still says `dispatched`.
4. **DeviceNotRegistered → token deleted.** Seed `push_token`, dispatch row, receipt with `details.error = "DeviceNotRegistered"`. Assert `push_token` row gone; other tokens for the same user remain.
5. **Receipt not ready.** Stub returns no entry for the ack id. Dispatch row stays `dispatched`, `receipts_polled_at` null. Eligible next tick.
6. **Idempotency.** Run poller twice; final state stable.
7. **24h window.** Dispatch row with `created_at` older than 23h is excluded.

Also add to `enrollment.test.ts`:

8. **Pre-flight ack error → dispatch row written as `undelivered`.** Stub `expo.sendPushNotificationsAsync` to return one ok ticket and one `{ status: "error", details: { error: "DeviceNotRegistered" } }`. Assert: log row → `dispatched`; two dispatch rows (one `dispatched`, one `undelivered`); the bad token is deleted from `push_token` inline.
9. **Zero tokens.** User has no push tokens. Log row → `dispatched`, no dispatch rows, `sent_at` set.

## Verification (end-to-end)

1. `bun run db:generate` — confirm migration drops three columns from `communication_log`, narrows the enum, adds `dispatch_status` + `dispatch`. Human reviews + runs.
2. `bun run db:migrate` against dev Neon (human).
3. `sst shell -- bun test apps/server/services/notification/poll-receipts.test.ts` — green.
4. `sst shell -- bun test apps/server/services/enrollment/enrollment.test.ts` — green.
5. Deploy → trigger a real send with two devices logged into one account → confirm one `communication_log` row + two `dispatch` rows, each with its own ack. After next 15-minute tick: both dispatch rows show `delivered` with receipts.
6. Force `DeviceNotRegistered` on one device (uninstall app, send) → that dispatch row → `undelivered`, the corresponding `push_token` row gone, the *other* device's dispatch row unaffected.

## Out of scope

- Surfacing per-token outcomes in the frontend.
- Stuck-`claimed` row recovery (separate ticket).
- Retry-on-`undelivered`.
- APNs / FCM provider implementations — `dispatch.provider` and `dispatch.ack`/`receipt` jsonb shapes are sized to absorb them; code paths land when those channels do.
- Backfill of existing `communication_log.outcomes` data — the original plan noted no production data yet; if that's still true, the migration drops the column without backfill. If not, add a one-shot backfill step that fans `outcomes[]` into `dispatch` rows before the column drop.
