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

## 4. Cron Job

**Frequency:** Every hour.

**Logic:**
1. Query all `workflow_enrollment` rows where `process_at <= now()` AND `status = 'active'`
2. For each enrollment, push a message onto the SQS queue containing:
   ```json
   {
     "enrollment_id": "uuid",
     "user_id": "uuid",
     "workflow_id": "uuid",
     "current_step_id": "uuid"
   }
   ```
3. Update enrollment status to `processing` (optional — prevents the next cron from re-queuing the same enrollment)

**Infrastructure:** SST cron construct triggering a Lambda function.

---

## 5. SQS Queue + Dead Letter Queue

- **Main queue** — receives enrollment messages from the cron
- **DLQ** — messages that fail after N retries land here
- Configure max receive count (e.g. 3 retries before DLQ)
- Lambda trigger on the main queue

---

## 6. Step Walker Lambda

The core processing logic. Consumes messages from SQS and walks the user through the workflow.

### Processing loop

For each message:

1. Load the enrollment, user, workflow steps, and step edges
2. Start at `current_step_id`
3. **Walk the chain** until you hit a `wait` step or reach the end:

#### Step type handling

**send**
- Read the step config (title, body)
- Call Expo Push API to deliver the notification (future — for MVP, just log it)
- Follow the single outgoing edge to the next step
- Continue walking

**branch**
- Read the branch config (`user_column`, `operator`, `compare_value`)
- Look up the user's attributes
- **If the attribute key doesn't exist on the user:** exit the user from the workflow (set enrollment status to `exited`). Do NOT send them down the false path.
- Evaluate the condition:
  - `=` — attribute value matches compare_value → `true` edge
  - `!=` — attribute value doesn't match → `true` edge
  - `exists` — attribute key is present → `true` edge
  - `not_exists` — attribute key is absent → `true` edge
- Follow the edge where `handle` matches the boolean result
- Continue walking

**filter**
- Similar to branch but with a single outgoing edge
- Evaluate the filter condition against user attributes
- If the user passes: follow the edge, continue walking
- If the user fails: exit the workflow (set enrollment status to `exited`)

**wait**
- Update `current_step_id` to the next step (follow the outgoing edge)
- Set `process_at` to `now() + wait_duration_in_hours`
- Set status back to `active`
- **Stop walking** — the next cron cycle will pick this enrollment up again

#### End of workflow

If there's no outgoing edge from the current step, the workflow is complete:
- Set enrollment status to `completed`
- Stop walking

### Failure / retry behaviour

- If the Lambda errors mid-walk, the message goes back on the queue
- On retry, processing resumes from whatever `current_step_id` is stored on the enrollment
- Branch/filter conditions are re-evaluated with fresh user data — this is intentionally correct (user state may have changed)
- After max retries, message goes to DLQ for investigation

---

## 7. Implementation Order

1. **Database migration** — `handle` column to boolean, drop unique constraint, verify enrollment columns
2. **Publish endpoint + UI** — `PATCH /workflows/:id/publish`, publish button in canvas
3. **Shared enrollment function** — `enrollUser` with `current_step_id` and `process_at` logic
4. **Three trigger entry points** — wire `enrollUser` into events, user creation, and user update endpoints
5. **Step walker function** — the core logic that walks a user through steps until a wait or end

---

## 8. Out of Scope (MVP)

- Workflow validation on publish (e.g. must have send node, no dangling branches)
- Transactional vs campaign workflow distinction
- Analytics / delivery receipts / Expo receipt polling
- Notification logging table
- UI indicators showing where users are in a workflow
- SQS queue + DLQ infrastructure
- Cron job to queue ready enrollments
- Expo Push API integration (send step just logs for now)
- Dedicated step walker Lambda (logic exists but isn't on its own Lambda yet)
