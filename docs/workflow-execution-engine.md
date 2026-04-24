# Workflow Execution Engine — Implementation Plan

## Overview

Build the engine that advances enrolled users through workflow steps. When an event triggers a workflow, the user is enrolled and a cron job + SQS + Lambda pipeline processes them through the step chain until they hit a wait node or reach the end of the workflow.

---

## 1. Database Changes

### 1a. Migrate `handle` column from text to boolean

The `step_edge.handle` column currently stores `"yes"` / `"no"` as text. Change it to a boolean column where `true` = the affirmative branch path and `false` = the negative branch path. Non-branch edges keep `handle` as `null`.

**Migration:** Drop and recreate the DB. Change the column type directly in the Drizzle schema and run a fresh migration.

**Affected code:**
- Drizzle schema (`server/db/schema.ts`)
- Admin API workflow save — `toEdgeInputs` in `server/services/workflow/workflow.ts`
- Canvas UI edge creation — `client/pages/canvas/canvas.tsx` `onConnect` handler
- Canvas UI save — `client/pages/canvas/hooks.ts` edge mapping
- Canvas UI load — `client/pages/canvas/utils.ts` `dbToCanvas` edge conversion

### 1b. Drop unique constraint on `workflow_enrollment`

Remove the unique constraint on `userId + workflowId` to allow concurrent enrollments. A user can be in the same workflow multiple times simultaneously (e.g. plan changes twice, each triggering a new enrollment). The workflow's own filter/branch logic handles deduplication — not the database.

### 1c. Add `trigger_type` column and trigger validation

Add a `trigger_type` enum column to the `workflow` table. Values are `system` or `custom`. The existing `trigger_event` column stays as text.

Validation is handled in the Zod layer with a discriminated union:
- `trigger_type: "system"` → `trigger_event` must be one of `user_created`, `user_updated`
- `trigger_type: "custom"` → `trigger_event` is free text (customer-defined event names like `purchase_completed`)

The DB stores both as plain text. No enum needed — the application layer enforces the union.

### 1d. Ensure `workflow_enrollment` has required columns

Verify the enrollment table has:
- `current_step_id` — UUID FK to `step.id`
- `process_at` — timestamp, used by the cron to find enrollments ready to process
- `status` — enum with at least `active`, `completed`, `exited`

---

## 2. Workflow Publish Flow

### 2a. Default status to `draft`

Ensure workflows are created with `status = 'draft'` (this may already be the case).

### 2b. Add publish endpoint

`PATCH /workflows/:id/publish` — sets workflow status to `active`. No validation for MVP — trust the builder to create correct workflows.

### 2c. Add publish button to canvas UI

Add a "Publish" button in the canvas toolbar. Calls the publish endpoint. Visual indicator showing whether the workflow is `draft` or `active`.

---

## 3. Enrollment Logic

### 3a. Shared enrollment function

Create a single `enrollUser(userId, workflowId)` function that handles all enrollment logic regardless of which trigger type initiated it. This function:

1. Finds the trigger step for the matched workflow
2. Follows the single outgoing edge from the trigger to get the first real step
3. Sets `current_step_id` to that step
4. Sets `process_at` based on step type:
   - **wait** — `now() + duration_in_hours`
   - **branch / filter / send** — `now()`
5. Sets `status` to `active`

Where this function lives (service layer, shared util, etc.) is TBD — but the key requirement is that all three trigger entry points call the same function.

### 3b. Three trigger entry points

Each public API endpoint checks for matching active workflows by trigger type and calls `enrollUser`:

| Trigger type | Fires from | Matches workflows where trigger event = |
|---|---|---|
| `event_received` | `POST /v1/events` | The specific event name (e.g. `purchase_completed`) |
| `contact_added` | User creation endpoint (new — does not exist yet) | `contact_added` |
| `contact_updated` | `PATCH /v1/users/:external_id` | `contact_updated` |

**`event_received`** — current behaviour but updated to call `enrollUser` instead of the bare insert.

**`contact_added`** — requires a new user registration endpoint. When a user is created, find all active workflows with trigger `contact_added` and enroll the user.

**`contact_updated`** — when `PATCH /v1/users/:external_id` updates user attributes, find all active workflows with trigger `contact_updated` and enroll the user. For MVP, any attribute change triggers enrollment — no filtering by which attribute changed.

---

## 4. Step Walker

The step walker is the core processing engine. It finds enrollments that are ready to be processed, walks each user through their workflow steps, and updates enrollment state along the way.

All logic lives in two layers:

- **Service layer** — `server/services/enrollment/enrollment.ts`
- **Repository layer** — `server/repository/enrollment/enrollment.ts`

### 4a. Entry point — `processReadyEnrollments()`

`server/services/enrollment/enrollment.ts`

This is the function that the cron job (or Lambda) will call. It orchestrates the full processing cycle:

1. **Query** — calls `findReadyEnrollments()` which selects all `workflow_enrollment` rows where `status = 'active'` AND `process_at <= now()`
2. **Lock** — for each enrollment, sets `status` to `processing` before walking. This prevents overlapping cron invocations from picking up the same enrollment
3. **Walk** — calls `processEnrollment(enrollment)` with the full enrollment object (no re-fetch)
4. **Error handling** — if processing throws, resets enrollment to `active` so the next cron tick retries it. If the recovery update itself fails (e.g. DB is down), logs a CRITICAL error — the enrollment will be stuck in `processing` and needs manual intervention
5. **Returns** — `{ processed: number, failed: number, results: [...] }` for observability

### 4b. Single enrollment processing — `processEnrollment(enrollment)`

`server/services/enrollment/enrollment.ts`

Takes a full `WorkflowEnrollment` object. Loads the user, all workflow steps, and all edges, then enters a `while` loop starting from `enrollment.currentStepId`.

Each iteration calls `walkStep()` which returns one of four actions:

| Action | What happens | Terminal? |
|---|---|---|
| `continue` | Advance `currentStepId` to the next step, keep looping | No |
| `wait` | Update enrollment: `currentStepId` = next step, `processAt` = `now + hours`, `status` = `active`. Stop walking | Yes |
| `exit` | Update enrollment: `currentStepId` = null, `processAt` = null, `status` = `exited`. Stop walking | Yes |
| `complete` | Update enrollment: `currentStepId` = null, `processAt` = null, `status` = `completed`. Stop walking | Yes |

If the loop ends without hitting a terminal action (e.g. `currentStepId` points to a step that doesn't exist), the enrollment is marked `completed`.

### 4c. Step type handling — `walkStep()`

`server/services/enrollment/enrollment.ts`

Uses `ts-pattern` exhaustive matching on `step.type`:

**send**
- Logs the notification title and body (Expo Push API integration is out of scope for MVP)
- Follows the single outgoing edge → `continue`
- If no outgoing edge → `complete`

**branch**
- Reads `BranchConfig`: `{ user_column, operator, compare_value }`
- If the attribute key doesn't exist on the user → `exit` (user is removed from the workflow)
- Evaluates the condition using `evaluateBranchCondition()`:
  - `=` — string equality
  - `!=` — string inequality
  - `exists` — attribute key is present
  - `not_exists` — attribute key is absent
- Follows the edge where `handle` matches the boolean result (`true` or `false` branch)
- If matching edge exists → `continue`, otherwise → `complete`

**filter**
- Reads `FilterConfig`: `{ attribute_key, operator, compare_value }`
- Evaluates using `evaluateFilterCondition()`:
  - `=` — string equality
  - `!=` — string inequality
  - `>` — numeric greater than
  - `<` — numeric less than
- If user fails the condition → `exit`
- If user passes, follows the single outgoing edge → `continue`, or → `complete` if no edge

**wait**
- Reads `WaitConfig`: `{ hours }`
- Follows the outgoing edge to find the next step
- Returns `wait` with `processAt = now + hours` and `nextStepId` = the step after the wait
- If no outgoing edge → `complete`

### 4d. Edge traversal — `findOutgoingEdge()`

`server/services/enrollment/enrollment.ts`

Finds the outgoing edge from a step. For branch steps, pass `handleMatch` (boolean) to select the correct branch. For all other step types, returns the first edge where `source` matches.

### 4e. Repository functions

`server/repository/enrollment/enrollment.ts`

| Function | Purpose |
|---|---|
| `findReadyEnrollments()` | Select enrollments where `status = 'active'` AND `processAt <= now()` |
| `findUserById(userId)` | Load user record with attributes |
| `findStepsByWorkflowId(workflowId)` | Load all steps for a workflow |
| `findEdgesByWorkflowId(workflowId)` | Load all edges for a workflow |
| `updateEnrollment(id, values)` | Partial update — `currentStepId`, `processAt`, `status` |

### 4f. Enrollment status lifecycle

```
active → processing → active (on wait, or on failure retry)
active → processing → completed (reached end of workflow)
active → processing → exited (failed branch/filter condition)
```

The `processing` status is a lock — it prevents overlapping cron invocations from double-processing the same enrollment. Only `active` enrollments are picked up by `findReadyEnrollments()`.

### 4g. Wait handling

Wait duration is always determined by the step walker, never by the enrollment function. When `enrollUser()` creates a new enrollment, it sets `processAt = now()` regardless of the first step type. The walker then handles the wait by setting `processAt = now + hours` and advancing `currentStepId` to the step after the wait.

This means the cron picks up the enrollment immediately, the walker sees a wait step, schedules it for the future, and stops. The next cron tick picks it up when `processAt` has passed.

### 4h. Failure / retry behaviour

- If `processEnrollment` throws, the enrollment is reset to `active` so the next cron tick retries it
- On retry, the walker resumes from whatever `currentStepId` is stored — partial progress is preserved
- Branch/filter conditions are re-evaluated with fresh user data on retry (user state may have changed between attempts)
- If the recovery update also fails, the enrollment is stuck in `processing` and logged as CRITICAL for manual investigation

---

## 7. Implementation Order

1. ~~**Database migration** — `handle` column to boolean, drop unique constraint, verify enrollment columns~~ DONE
2. ~~**Publish endpoint + UI** — `PATCH /workflows/:id/publish`, publish button in canvas~~ DONE
3. ~~**Shared enrollment function** — `enrollUser` with `current_step_id` and `process_at` logic~~ DONE
4. ~~**Three trigger entry points** — wire `enrollUser` into events, user creation, and user update endpoints~~ DONE
5. ~~**Step walker function** — the core logic that walks a user through steps until a wait or end~~ DONE
6. **Cron infrastructure** — SST cron construct that calls `processReadyEnrollments()` on a schedule
7. **SQS queue + DLQ** — queue for enrollment messages, dead letter queue for failed processing
8. **Expo Push API integration** — replace console.log in send step with actual push delivery

---

## 8. Out of Scope (MVP)

- Workflow validation on publish (e.g. must have send node, no dangling branches)
- Transactional vs campaign workflow distinction
- Analytics / delivery receipts / Expo receipt polling
- Notification logging table
- UI indicators showing where users are in a workflow
- Expo Push API integration (send step just logs for now)
- Infinite loop protection (cyclic workflows)
