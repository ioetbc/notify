## Notify — Project Status (2026-04-29)

### 1. Infrastructure
- **SST on AWS** — fully configured with two Lambda functions (Admin API, Public API) and a static site for the frontend
- **Neon PostgreSQL 17** — managed DB provisioned via SST, Drizzle ORM + migrations in place
- **3 migrations applied** — schema is stable and deployed

### 2. Database Schema (Drizzle)
All core tables are defined and migrated:
- **customer** — multi-tenant accounts with API key field
- **user** — end users per customer, identified by `external_id`, with flexible `attributes` JSONB column and gender/phone fields
- **workflow** — workflow definitions with name, `trigger_type` enum (`system`/`custom`), `trigger_event` (text), and status enum (`draft`/`active`/`paused`/`archived`)
- **step** — workflow steps with type enum (`wait`/`branch`/`send`/`filter`) and typed JSONB config
- **step_edge** — directed edges between steps, with boolean `handle` field for branch yes/no outputs
- **workflow_enrollment** — tracks which users are in which workflows, their current step, status (`active`/`completed`/`exited`), and `process_at` timestamp. Allows concurrent enrollments (no unique constraint on user+workflow).
- **event** — log of all tracked events with properties JSONB
- Full relations defined between all tables, cascade deletes

### 3. Admin API (Hono, internal)
- `POST /workflows` — create workflow with steps + edges
- `PUT /workflows/:id` — update workflow (replaces all steps/edges)
- `GET /workflows/:id` — get workflow with steps + edges
- `GET /workflows/` — list all workflows for customer
- `PATCH /workflows/:id/publish` — set workflow status to `active`
- `GET /user-columns` — introspects JSONB attributes across all users to populate branch/filter dropdowns in the canvas
- `GET /event-names` — returns distinct custom event names tracked by the customer, used to populate the trigger event dropdown
- All endpoints scoped by `x-customer-id` header
- Zod validation on all request bodies, including discriminated union for trigger type/event
- Layered architecture: routes → services → repositories

### 4. Public API (Hono, customer-facing)
- `POST /v1/users` — create a new user; auto-enrolls into active workflows with `user_created` trigger
- `PATCH /v1/users/:external_id` — update user attributes (merges into JSONB); auto-enrolls into active workflows with `user_updated` trigger
- `POST /v1/events` — track a custom event, store it, and auto-enroll the user into any active workflows whose `trigger_event` matches the event name
- `POST /v1/users/:external_id/push-tokens` — register an Expo push token for a user; upserts on `(user_id, token)` conflict so repeat registrations are idempotent
- Shared `enrollUser` function handles all enrollment logic: finds the first step (no incoming edges), sets `current_step_id` and `process_at` based on step type (wait → now + hours, others → now)
- All endpoints return structured error responses for missing users
- Event tracking returns `workflows_triggered` count

### 5. Execution Engine & Notification Delivery
- **`EnrollmentWalker`** (`apps/server/services/enrollment/enrollment.ts`) advances users through workflows
  - `processReadyEnrollments()` — polls `workflow_enrollment` for rows where `status='active'` and `process_at <= now()`
  - `processEnrollment(enrollmentId)` — loads the workflow's steps and edges, then executes the current step
  - Handles all step types: `send`, `branch`, `filter`, `wait`, `exit`
- **Manual trigger** — `POST /enrollments/process` on the Admin API invokes the walker. No cron, EventBridge rule, or SQS queue yet — invocation is purely on-demand.
- **Push delivery via Expo** — `expo-server-sdk` is wired into the walker's `onSend` callback (`apps/server/functions/admin/index.ts`)
  - Filters tokens through `Expo.isExpoPushToken()` before dispatch
  - Calls `expo.sendPushNotificationsAsync()` and logs the returned tickets
- **Push token storage** — `push_token` table (unique on `user_id, token`) with full repo/service/route layers

### 6. Canvas UI (React + @xyflow/react)
- **Full visual workflow builder** with infinite canvas, pan/zoom
- **Step palette** — drag-and-drop sidebar with wait, branch, send, filter, trigger nodes (color-coded with icons)
- **Config panel** — right sidebar that renders type-specific forms:
  - Trigger: trigger type dropdown (`System`/`Custom Event`), then event dropdown — system shows `User Created`/`User Updated`, custom shows previously tracked event names fetched from the API
  - Wait: hours input with formatted duration display
  - Branch: user column dropdown (populated from API), operator picker, compare value
  - Send: title + body text inputs with character limits
  - Filter: attribute key dropdown, operator, compare value dropdown (values from API)
- **Publish button** — sets workflow status to `active` via the publish endpoint
- **Connection validation** — prevents self-loops and cycles
- **Auto-layout** — Dagre-based hierarchical layout
- **Persistence** — saves/loads workflows via Admin API with React Query; `dbToCanvas` converts API response back into xyflow nodes/edges
- Create (`/workflow`) and edit (`/workflow/:id`) routes

### 7. Frontend Shell
- React Router with sidebar navigation
- Home page with accordion sections for campaigns/transactional (currently using mock data)
- Pages exist for campaigns, transactional, and loops but are placeholder/mock-driven
- Hono RPC client with type-safe API calls

### 8. Seeding / Dev Tooling
- DB reset, seed (creates test customer), migrate, and Drizzle Studio scripts
- Hardcoded test customer ID in the frontend API client for development

---

### What Does NOT Exist Yet 

- **No automatic walker invocation** — `processReadyEnrollments()` is only callable via the `POST /enrollments/process` admin endpoint. No EventBridge cron, no SQS queue, no scheduled worker Lambda — nothing advances enrollments without a manual HTTP call.
- **No fault tolerance** — the walker processes enrollments synchronously inside one Lambda invocation; no retry logic, no DLQ, no idempotency guard if a step partially completes (e.g. notification sent but `current_step_id` not updated).
- **No Expo receipt polling** — tickets returned by `sendPushNotificationsAsync` are logged but never reconciled against Expo's receipts endpoint, so delivery status, invalid tokens, and provider errors are invisible.
- **API key authentication** — `apiKey` column exists on customer but is never validated; everything uses `x-customer-id` header
- **Analytics / metrics** — no notification log table, no per-customer delivery stats, no dashboards
- **Campaign / transactional / loop distinction** — the home page references these concepts but they're backed by mock data, not the workflow system
