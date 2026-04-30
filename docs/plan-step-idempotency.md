# Plan: Step Idempotency Guard

## Context

Today, `EnrollmentWalker.processEnrollment` (`apps/server/services/enrollment/enrollment.ts:256-272`) executes a `send` step in this order:

1. `onSend()` — fires the Expo push (external, non-rollbackable)
2. `insertCommunicationLog()` — writes the log row
3. step pointer (`current_step_id`) only advances in DB when the loop hits a terminal action (`wait` / `exit` / `complete`, lines 287–309)

If the worker crashes or the Lambda times out anywhere between step 1 and the eventual `updateEnrollment` write, SQS redelivers the message, the walker re-loads the same `current_step_id`, and the user receives the **same push notification a second time**. With three SQS retries before DLQ, a single hiccup can mean up to 3× duplicate sends.

`branch` / `filter` / `wait` / `exit` steps have no external side effects, so they are already idempotent — re-executing them just recomputes the same result. The fix only needs to guard `send`.

The goal is **at-most-once** delivery semantics for push: a crash mid-Expo-call may, in the worst case, mean a single notification is lost, but the user will never receive duplicates. This matches user expectations for push and is the explicit tradeoff the existing system docs imply.

## Approach

Use `communication_log` itself as the idempotency record, written **before** the Expo call, with a unique constraint that makes the second attempt a no-op.

### 1. Schema changes — `communication_log`

File: `apps/server/db/schema.ts` (lines 141–154)

Add:
- `status` enum column: `attempted` | `sent` | `failed` (default `attempted`)
- `expo_tickets` `jsonb` (nullable) — store the array returned by `expo.sendPushNotificationsAsync` for later receipt polling
- `error` `text` (nullable)
- `sent_at` `timestamp with time zone` (nullable)
- **Unique constraint** on `(enrollment_id, step_id)`

The unique constraint is safe because the workflow graph is a DAG walked once per enrollment — each `(enrollment, step)` pair should produce exactly one send.

Generate migration via `drizzle-kit generate` into `apps/server/drizzle/0005_*.sql`.

### 2. Walker change — claim-then-send

File: `apps/server/services/enrollment/enrollment.ts:256-272`

Replace the current send block with a claim-then-send pattern:

```ts
if (currentStep.type === "send") {
  const config = SendConfigSchema.parse(currentStep.config);

  // Claim: insert attempted row. ON CONFLICT DO NOTHING.
  // If 0 rows returned, another attempt already claimed this (enrollment, step).
  const claimed = await this.claimSend({
    enrollmentId: enrollment.id,
    stepId: currentStep.id,
    userId: enrollment.userId,
    config,
  });

  if (claimed) {
    try {
      const tickets = await this.onSend({ ... });
      await this.markSendSucceeded({ logId: claimed.id, tickets });
    } catch (err) {
      await this.markSendFailed({ logId: claimed.id, error: String(err) });
      throw err; // let SQS retry — but the unique row blocks re-send
    }
  }
}
```

Key points:

- `claimSend` does `INSERT ... ON CONFLICT (enrollment_id, step_id) DO NOTHING RETURNING id`. If it returns no row, the step has already been attempted on a prior delivery — we skip the Expo call and fall through to `walkStep` to advance.
- `onSend` is changed to **return** the Expo tickets so we can persist them. Currently `sendPushNotification` (`apps/server/services/enrollment/send.ts:40`) discards them.
- On Expo failure we mark the row `failed` and rethrow. The next SQS retry will see the existing row and skip — at-most-once. Failed sends are visible in the log for debugging and future receipt polling work.

### 3. Repository / service additions

- `apps/server/services/enrollment/repo.ts` (or wherever `insertCommunicationLog` lives) — add `claimCommunicationLog` and `updateCommunicationLogStatus`.
- `apps/server/services/enrollment/send.ts` — change return type from `void` to `ExpoPushTicket[] | undefined` and return `tickets` from line 40.
- Wire the new methods through `EnrollmentWalker`'s constructor deps.

### 4. Tests

Per the saved preference, run via `sst shell -- bun test`.

Add to (or create) walker tests:

- Happy path: claim succeeds → `onSend` called once → row marked `sent` with tickets.
- Retry path: pre-seed a `communication_log` row for `(enrollmentId, stepId)` → `processEnrollment` skips `onSend` entirely → walker still advances past the send step.
- Expo failure: `onSend` throws → row marked `failed` → walker rethrows → second invocation skips `onSend`.

Use the in-process walker (no SQS) and a real DB through the existing test setup.

## Files to modify

- `apps/server/db/schema.ts` — extend `communication_log`
- `apps/server/drizzle/0005_*.sql` — generated migration
- `apps/server/services/enrollment/enrollment.ts:256-272` — claim-then-send
- `apps/server/services/enrollment/send.ts` — return tickets
- `apps/server/services/enrollment/*repo*.ts` — claim / update helpers
- Walker test file (existing or new)

## Out of scope (call out, don't build)

- **Expo receipt polling.** Storing `expo_tickets` unblocks this, but the polling job itself is a separate item from the project status doc.
- **Branch/filter/wait idempotency.** Already idempotent.
- **Whole-enrollment transaction.** Not needed — per-step idempotency is sufficient.
- **DLQ alerting.** Tracked separately.

## Verification

1. `sst shell -- bun run db:migrate` — apply the new migration.
2. `sst shell -- bun test` — walker tests pass (happy path + replay + failure).
3. Manual end-to-end: enroll a user in a `send`-only workflow, force the worker to throw after `onSend` (temporary `throw` after the Expo call), confirm SQS retries do not produce a second push to the device, and the `communication_log` row is in `attempted` state. Remove the forced throw and confirm `sent` with tickets populated.
