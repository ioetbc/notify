# Enrollment Processing Pipeline (EventBridge → SQS → Worker Lambda)

## Context

The execution engine (`EnrollmentWalker`) is fully implemented but nothing advances enrollments without a manual `POST /enrollments/process` call. Workflows containing `wait` steps therefore cannot complete end-to-end. We need an automated, fault-tolerant pipeline that:

1. Wakes up on a fixed schedule.
2. Claims enrollments whose `process_at <= now()` without double-processing.
3. Processes each enrollment with retries and a dead-letter queue for poison messages.

The naive option — invoking `processReadyEnrollments()` directly from a cron — is a single point of failure: one slow enrollment blocks the rest, errors are silent, and concurrent ticks race. Splitting the dispatcher (claim) from the worker (process) gives us per-enrollment retries, parallelism via Lambda concurrency, and observable failure modes via the DLQ.

## Architecture

```
EventBridge Schedule (every 60s)
        ↓ invokes
Dispatcher Lambda
   - SELECT ... FOR UPDATE SKIP LOCKED
   - UPDATE status = 'processing'
   - SQS SendMessageBatch (one msg per enrollment)
        ↓
SQS: enrollment-queue
   - visibility timeout: 90s (> Lambda timeout)
   - maxReceiveCount: 3 → DLQ
        ↓ event source mapping
Worker Lambda (batchSize: 10, reportBatchItemFailures)
   - walker.processEnrollment(enrollmentId) per record
        ↓ on 3 failures
SQS: enrollment-dlq (14 day retention)
```

### Why each piece

- **EventBridge Schedule** — managed cron. SST-native, no host to maintain. Replaces a self-hosted crontab.
- **Dispatcher Lambda** — claims work atomically using `SELECT ... FOR UPDATE SKIP LOCKED` + `status = 'processing'`. Prevents two ticks from picking the same enrollment.
- **SQS** — decouples claim from execution; gives us automatic retries (`maxReceiveCount`), per-message visibility, and Lambda concurrency for parallel workers.
- **DLQ** — captures enrollments that fail 3× so they don't block the queue and can be inspected/replayed.
- **Worker Lambda** — runs `walker.processEnrollment(id)` for one enrollment at a time. Failure → SQS retry → eventually DLQ.

## Changes

### 1. `sst.config.ts`

Add inside `run()`:

```ts
const dlq = new sst.aws.Queue("EnrollmentDLQ", {
  retention: "14 days",
});

const queue = new sst.aws.Queue("EnrollmentQueue", {
  visibilityTimeout: "90 seconds",
  dlq: { queue: dlq.arn, retry: 3 },
});

queue.subscribe({
  handler: "apps/server/functions/worker/index.handler",
  link: [db],
  timeout: "60 seconds",
  nodejs: { install: ["expo-server-sdk"] },
});

const dispatcher = new sst.aws.Function("EnrollmentDispatcher", {
  handler: "apps/server/functions/dispatcher/index.handler",
  link: [db, queue],
  timeout: "30 seconds",
});

new sst.aws.Cron("EnrollmentCron", {
  schedule: "rate(1 minute)",
  function: dispatcher.arn,
});
```

`link: [queue]` injects the queue URL into the dispatcher via SST's `Resource` binding; `link: [db]` is unchanged.

### 2. `apps/server/functions/dispatcher/index.ts` (new)

- Import Drizzle `Db`, `workflowEnrollment`, and the SST `Resource` binding for the queue.
- Run a single transaction:

```ts
const claimed = await db
  .select({ id: workflowEnrollment.id })
  .from(workflowEnrollment)
  .where(and(
    eq(workflowEnrollment.status, "active"),
    lte(workflowEnrollment.processAt, new Date()),
  ))
  .limit(100)
  .for("update", { skipLocked: true });

if (claimed.length === 0) return { dispatched: 0 };

await db.update(workflowEnrollment)
  .set({ status: "processing" })
  .where(inArray(workflowEnrollment.id, claimed.map(c => c.id)));
```

- Send to SQS via `@aws-sdk/client-sqs` `SendMessageBatchCommand` (chunks of 10).
- Message body: `{ enrollmentId: string }`.

### 3. `apps/server/functions/worker/index.ts` (new)

- SQS Lambda handler with `reportBatchItemFailures`.
- For each record: parse body, call `walker.processEnrollment(enrollmentId)`.
- On thrown error: push the record's `messageId` into `batchItemFailures` so SQS retries only that message.
- Construct walker exactly as `apps/server/functions/admin/index.ts` does (reuse the `expo-server-sdk` `onSend` callback — extract it into `apps/server/services/enrollment/send.ts` so admin and worker share it).

### 4. `EnrollmentWalker.processEnrollment` — idempotency tweak

Current code transitions an `active` enrollment as it walks. Now the dispatcher pre-marks enrollments `processing` before SQS receives them. Update `processEnrollment` to:

- Accept enrollments in `processing` state (already does — no enum change needed).
- On any successful terminal transition (`wait` / `exit` / `complete`) the existing `updateEnrollment` already overwrites status, so no further change required.
- On thrown error inside the worker: do NOT reset to `active` here (the existing `processReadyEnrollments` does this). Instead, let SQS retry. If all 3 retries fail and the message lands in DLQ, the enrollment will sit in `processing` indefinitely — acceptable for v1 since the DLQ is the alarm signal.

### 5. Remove or repurpose `POST /enrollments/process`

Keep the route for manual debugging but mark it as a dev-only escape hatch. The dispatcher is now the production path.

### 6. Dependencies

Add to root `package.json` (or worker-specific install): `@aws-sdk/client-sqs`. `@aws-sdk/*` is provided by the Lambda runtime, so it can also be marked external in SST's `nodejs.install`.

## Critical Files

- `sst.config.ts` — infra additions
- `apps/server/functions/dispatcher/index.ts` — new
- `apps/server/functions/worker/index.ts` — new
- `apps/server/services/enrollment/send.ts` — new (extracted Expo `onSend`)
- `apps/server/functions/admin/index.ts` — switch to imported `onSend`
- `apps/server/services/enrollment/enrollment.ts` — minor: ensure `processEnrollment` is safe to call directly with a `processing` enrollment

## Verification

1. `sst dev` — confirm `EnrollmentDispatcher`, `EnrollmentQueue`, `EnrollmentDLQ`, `EnrollmentCron` provision without error.
2. Seed: create a workflow with `Trigger → Wait(0h) → Send`. Enroll a user via `POST /v1/users` so `process_at = now()`.
3. Wait ≤60s. Confirm via Drizzle Studio that enrollment status moves `active → processing → completed` and a `communication_log` row exists.
4. Force a failure: temporarily throw inside `onSend`. Watch CloudWatch for the worker Lambda; confirm 3 retries then a message in `EnrollmentDLQ`.
5. Concurrency check: insert 50 due enrollments at once, confirm dispatcher claims all in one tick and each is processed exactly once (no duplicate `communication_log` rows per `(enrollment_id, step_id)`).
6. `sst shell -- bun test` — existing walker unit tests must still pass.
