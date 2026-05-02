# Plan: Push Delivery Receipt Polling

## Context

When the worker calls `expo.sendPushNotificationsAsync(...)` (`apps/server/services/enrollment/send.ts:40`), Expo replies with an **acknowledgement** per message — not a delivery confirmation. The actual hand-off to APNs/FCM happens asynchronously inside Expo's infrastructure and is reported back via `expo.getPushNotificationReceiptsAsync(...)`. Receipts are only retained ~24h.

The previous communication-log work (`docs/communication-log.md`) added `communication_log.expo_tickets` to unblock this follow-up. Today we persist acks but never reconcile them, so we have no visibility into:

- Whether a notification reached APNs/FCM (`status: "ok"` receipt) vs failed (`status: "error"`).
- Dead device tokens (`DeviceNotRegistered`) — we keep sending to tokens that will never deliver.
- Provider/config errors (`MessageTooBig`, `MessageRateExceeded`, `InvalidCredentials`, ...) that need surfacing.

Also called out in `docs/project-status.md:94` ("No Expo receipt polling") as a known gap.

**Outcome:** A scheduled job that pulls receipts within the provider's retention window, writes the result back onto `communication_log`, transitions row status to `delivered` / `undelivered`, and prunes dead push tokens.

### Naming & provider neutrality

The current `expo_tickets` column bakes Expo into the schema. Native APNs/FCM is on the roadmap — at that point the column either becomes a misnomer or we sprawl into `apns_*` / `fcm_*` parallels. Fix it now while there's no production data to migrate.

- "Ticket" is Expo's word; APNs uses `apns-id`, FCM uses `name`. The generic concept is **a dispatch**: one attempted send to one token, with a provider's ack and (later) a receipt.
- New column shape collapses today's three planned additions (`expo_tickets`, `expo_receipts`, `receipts_polled_at`) into one structured column keyed per-token, plus a `provider` discriminator on the row.
- Status enum renames `sent` → `dispatched` (request accepted by provider) and adds `delivered` / `undelivered` (receipt resolved).

## Schema changes

Single new migration via `drizzle-kit generate` (next is `0006_*`; current head is `0005_round_miek.sql`). **Human runs the migration commands — do not run them.**

### `delivery_provider` enum — new

```ts
export const deliveryProviderEnum = pgEnum("delivery_provider", ["expo"]);
// future: "apns" | "fcm"
```

### `communication_status` enum — rename + add

`apps/server/db/schema.ts:35-39`:

```ts
export const communicationStatusEnum = pgEnum("communication_status", [
  "claimed",
  "dispatched",   // RENAMED from "sent" — provider accepted the request
  "failed",       // pre-flight failure (Expo refused at send time, or our code threw)
  "delivered",    // NEW — all receipts came back ok
  "undelivered",  // NEW — at least one receipt came back error
]);
```

Postgres enums need `ALTER TYPE ... RENAME VALUE` for the rename and `ADD VALUE` for the new ones — both must run outside a transaction, so confirm the generated SQL has `--> statement-breakpoint` between each statement. Drizzle should detect the rename automatically (it'll prompt during `db:generate`); accept the rename rather than the drop+recreate.

Update every `status === "sent"` reference in code to `"dispatched"`:
- `apps/server/services/enrollment/enrollment.ts:239` (`markCommunicationLogSent` → rename to `markCommunicationLogDispatched`, set `status: "dispatched"`).
- `apps/server/db/schema.ts:161` default value.
- All test assertions in `apps/server/services/enrollment/enrollment.test.ts` (search `"sent"`).

### `communication_log` — restructure

Drop: `expo_tickets`.
Add:

```ts
provider: deliveryProviderEnum("provider"),                       // null until dispatched
dispatches: jsonb("dispatches").$type<Dispatch[]>(),              // null until dispatched
receiptsPolledAt: timestamp("receipts_polled_at", { withTimezone: true }),
```

`Dispatch` is a provider-tagged discriminated union, defined in a new `apps/server/services/notification/dispatch.ts`:

```ts
export type Dispatch =
  | { provider: "expo"; token: string; ack: ExpoAck; receipt?: ExpoReceipt }
  // future: | { provider: "apns"; token: string; ack: ApnsAck; receipt?: ApnsReceipt }
  ;

type ExpoAck =
  | { status: "ok"; id: string }                                  // has id → poll for receipt
  | { status: "error"; message: string; details?: unknown };      // pre-flight refusal — no id, no receipt

type ExpoReceipt =
  | { status: "ok" }
  | { status: "error"; message: string; details?: { error?: string } };
```

Why per-token entries instead of bare arrays:
- Solves the **token-attribution gap** — `DeviceNotRegistered` cleanup needs to know which token failed. Today the Expo SDK correlates ack ↔ token by array order with `messages[]`, which is fragile and lost the moment we re-key by ticket id.
- Per-token outcome lives in one place: ack + receipt + (future) timing.
- `dispatches[i].ack.status === "error"` already captures pre-flight refusals — no separate column needed.

No new index initially; add `CREATE INDEX ... ON communication_log (sent_at) WHERE status = 'dispatched'` later if the polling query slows.

## Polling job

### Wiring (SST)

`sst.config.ts` — add alongside `EnrollmentDispatcher` / `EnrollmentCron` (lines 77-86):

```ts
const receiptPoller = new sst.aws.Function('ReceiptPoller', {
  handler: 'apps/server/functions/receipt-poller/index.handler',
  link: [db],
  timeout: '60 seconds',
  nodejs: { install: ['expo-server-sdk'] },
});

new sst.aws.CronV2('ReceiptPollerCron', {
  schedule: 'rate(15 minutes)',
  function: receiptPoller,
});
```

Why 15 min: Expo holds receipts ~24h and recommends not polling tighter than ~15min. Even a multi-hour outage won't lose data. No SQS — receipt polling is a single periodic batch, not per-message work.

### Send path changes

`apps/server/services/enrollment/send.ts` — return a provider-tagged result rather than raw tickets:

```ts
return {
  provider: "expo" as const,
  dispatches: messages.map((m, i) => ({
    provider: "expo" as const,
    token: m.to as string,
    ack: tickets[i] as ExpoAck,
  })),
};
```

`markCommunicationLogDispatched` (`apps/server/services/enrollment/enrollment.ts:235-244`) accepts `{ provider, dispatches }` and writes both columns plus `status: "dispatched"`.

### Handler: `apps/server/functions/receipt-poller/index.ts`

Thin Lambda wrapper — all logic in the service:

```ts
import Expo from "expo-server-sdk";
import { and, eq, isNull, isNotNull, sql } from "drizzle-orm";
import { db, communicationLog } from "../../db";
import { pollReceipts } from "../../services/notification/poll-receipts";

export async function handler() {
  const rows = await db
    .select()
    .from(communicationLog)
    .where(and(
      eq(communicationLog.status, "dispatched"),
      isNotNull(communicationLog.dispatches),
      isNull(communicationLog.receiptsPolledAt),
      sql`${communicationLog.sentAt} > NOW() - INTERVAL '23 hours'`,
    ))
    .limit(500);

  if (rows.length === 0) return { polled: 0 };

  const result = await pollReceipts({ db, expo: new Expo(), rows });
  console.log(`[receipt-poller] ${JSON.stringify(result)}`);
  return result;
}
```

### Service: `apps/server/services/notification/poll-receipts.ts` (new)

Responsibilities:

1. **Group by provider.** `match(row.provider)` (ts-pattern, exhaustive) — today only `"expo"`, future-proof for `"apns"` / `"fcm"`. Each branch knows how to fetch and parse its receipts.
2. **For Expo rows:** collect ack ids from `dispatches.filter(d => d.ack.status === "ok").map(d => d.ack.id)`. Pre-flight errors are already terminal and need no receipt.
3. **Chunk + fetch.** `Expo.chunkPushNotificationReceiptIds(ids)` then `expo.getPushNotificationReceiptsAsync(chunk)` per chunk. Wrap each chunk call in try/catch — a transient failure on one chunk shouldn't lose the rest.
4. **Merge receipts back into dispatches.** For each row, walk `row.dispatches`, attach `receipt` to entries whose `ack.id` got a response.
5. **Per-row decision** via `ts-pattern` over the dispatches:
   - All eligible dispatches resolved and all `ok` → `delivered`.
   - All eligible dispatches resolved and any `error` → `undelivered`.
   - Some still missing receipts → leave as `dispatched`, leave `receiptsPolledAt` null so we re-poll next tick. (Pre-flight `ack.status === "error"` dispatches count as resolved but contribute "error" to the row decision — they're already known-bad.)
6. **Persist.** One `UPDATE` per row: `dispatches` (now with receipts merged in), `status`, `receiptsPolledAt`.
7. **Dead-token cleanup.** Collect `dispatch.token` for any dispatch whose `receipt.details.error === "DeviceNotRegistered"` OR whose pre-flight `ack.details.error === "DeviceNotRegistered"`. Single `DELETE FROM push_token WHERE token = ANY($1)` after the batch.

Return shape: `{ polled, delivered, undelivered, deferred, deadTokensRemoved }` for log/metric visibility.

`expo` is injected so tests can stub it without `mock.module`.

## Files to touch

- `apps/server/db/schema.ts` — new `delivery_provider` enum, rename `sent` → `dispatched`, add `delivered` / `undelivered`, replace `expo_tickets` with `provider` + `dispatches`, add `receipts_polled_at`.
- `apps/server/db/migrations/0006_*.sql` — generated.
- `apps/server/services/notification/dispatch.ts` — **new**, `Dispatch` discriminated union + per-provider ack/receipt types.
- `apps/server/services/enrollment/send.ts` — return `{ provider, dispatches }`.
- `apps/server/services/enrollment/enrollment.ts:235-244` — rename `markCommunicationLogSent` → `markCommunicationLogDispatched`, write the new shape.
- `apps/server/services/notification/poll-receipts.ts` — **new**.
- `apps/server/functions/receipt-poller/index.ts` — **new** Lambda handler.
- `sst.config.ts` — `ReceiptPoller` function + `ReceiptPollerCron`.
- `apps/server/services/enrollment/enrollment.test.ts` — update `"sent"` → `"dispatched"`, update fixtures from `expoTickets` to `dispatches` shape (line 680, 694).

## Tests

`apps/server/services/notification/poll-receipts.test.ts` (new) — real test DB via `apps/server/test/db.ts`, run with `sst shell -- bun test`:

1. **Happy path — all delivered.** Seed a `dispatched` row with one Expo dispatch (`ack.status = ok`); stub receipt fetch to return `{ status: "ok" }`; assert row → `delivered`, dispatch entry has `receipt` populated, `receipts_polled_at` set.
2. **Mixed outcome.** Two dispatches, one `ok` receipt one `error` receipt → row → `undelivered`.
3. **Pre-flight error counts toward undelivered.** A dispatch whose `ack.status === "error"` and one with `ok` ack + `ok` receipt → row → `undelivered`.
4. **DeviceNotRegistered → token deleted.** Seed `push_token`, dispatch row, stub receipt with `details.error = "DeviceNotRegistered"`; assert that `push_token` row is gone, other tokens for the same user remain.
5. **Receipt not ready yet.** Stub receipt fetch returns no entry for the ack id → row stays `dispatched`, `receipts_polled_at` stays null, eligible for next poll.
6. **Idempotency.** Running twice over the same row produces the same end state.
7. **24h window.** Row with `sent_at` older than 23h is excluded from the query.

Existing `enrollment.test.ts` assertions need fixture updates only (no logic changes) — the walker still claims, sends, marks dispatched.

## Verification (end-to-end)

1. `bun run db:generate` — confirm migration contains the rename, the two `ADD VALUE`s, and the column swap. Human reviews + runs.
2. `bun run db:migrate` against dev Neon (human).
3. `sst shell -- bun test apps/server/services/notification/poll-receipts.test.ts` — green.
4. `sst shell -- bun test apps/server/services/enrollment/enrollment.test.ts` — green after fixture updates.
5. Deploy to a personal stage → trigger a real send → after the next 15-minute tick, inspect a `communication_log` row to confirm `status = delivered`, `dispatches[*].receipt` populated, `receipts_polled_at` set, `provider = expo`.
6. Force a `DeviceNotRegistered` (uninstall the test app, send, wait for poll) → confirm the corresponding `push_token` row is gone.

## Out of scope

- Stuck-`claimed` row recovery (separate observability ticket — `project-status.md:95`).
- DLQ / CloudWatch alerting for the poller — initial cut relies on Lambda errors only.
- Retry-on-`undelivered` — product decision, not part of this ticket.
- Surfacing receipt outcomes in the frontend — schema first; UI later.
- APNs / FCM provider implementations — schema is shaped to accept them; code paths land when those channels do.
