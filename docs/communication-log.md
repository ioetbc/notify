# Communication Log

## Problem

The `send` step in the workflow walker just `console.log`s the message title and body. There is no record of what was sent, to whom, or when. This causes two problems:

1. **Tests can't verify which branch was taken.** Both sides of a branch end in `status: "completed"`, so asserting on the enrollment status doesn't prove the walker followed the correct path.
2. **No audit trail.** There's no way to answer "what communications were sent to user X?" — the only trace is ephemeral console output.

## Solution

Add a `communication_log` table. Every time the walker processes a `send` step, it inserts a row before continuing. Tests can then assert on `insertCommunicationLog` calls to verify the exact title/body that was "sent" and which step produced it.

## Schema changes

`server/db/schema.ts`

```
communication_log
├── id              uuid, pk, defaultRandom
├── enrollment_id   uuid, not null, FK → workflow_enrollment(id) ON DELETE CASCADE
├── step_id         uuid, not null, FK → step(id) ON DELETE CASCADE
├── user_id         uuid, not null, FK → user(id) ON DELETE CASCADE
├── config          jsonb, not null (SendConfig shape — matches step table pattern)
└── created_at      timestamp with tz, defaultNow
```

- `enrollment_id` ties the log entry to a specific workflow run — the key column for test assertions.
- `step_id` records which send step produced it. Useful for multi-send workflows.
- `user_id` is denormalized from the enrollment for easier querying ("show all communications for user X"). Same pattern as the `event` table.
- `config` stores the `SendConfig` as JSONB, matching the step table's `config` column pattern. Contains `{ title, body }`.

DB migration via `drizzle-kit generate`.

## Repository changes

`server/repository/enrollment/enrollment.ts`

Add two functions:

- `insertCommunicationLog({ enrollmentId, stepId, userId, config })` — used by the walker when it hits a send step.
- `findCommunicationLogsByEnrollmentId(enrollmentId)` — for querying what was sent during a given enrollment.

## Walker changes

`server/services/enrollment/enrollment.ts`

The insert happens in `processEnrollment`, not inside `walkStep`. This keeps `walkStep` as a pure function (no side effects, no async).

Inside the `while` loop, after calling `walkStep` and before handling the result with `match` — if the current step is a `send`, insert the log row:

```ts
if (currentStep.type === "send") {
  await repository.insertCommunicationLog({
    enrollmentId: enrollment.id,
    stepId: currentStep.id,
    userId: enrollment.userId,
    config: currentStep.config as SendConfig,
  });
}
```

## Test impact

`server/services/enrollment/enrollment.test.ts`

Add a `mockInsertCommunicationLog` mock to the repository mock block. Branch tests can now assert which path was taken:

```ts
expect(mockInsertCommunicationLog).toHaveBeenCalledWith({
  enrollmentId: "enr-1",
  stepId: "step-2",
  userId: "user-1",
  config: { title: "Welcome to Pro!", body: "Enjoy your benefits" },
});
```

## What this does NOT change

- No delivery channel column yet — add when there's a second channel to distinguish (push, email, SMS).
- No status column (queued/sent/failed) — the send step is synchronous today. Add when async delivery exists.
- No `workflow_id` or `customer_id` columns — reachable via joins through `enrollment_id` or `step_id`.
- `walkStep` stays pure — the DB write is in `processEnrollment`.
