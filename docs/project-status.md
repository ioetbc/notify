## Notify — Project Status (2026-04-29)

### 1. Infrastructure
- **SST on AWS** — Admin API + Public API Lambdas, dispatcher + worker Lambdas, EventBridge cron, two SQS queues, and a static site for the frontend
- **Neon PostgreSQL 17** — managed DB provisioned via SST, Drizzle ORM + migrations in place
- **3 migrations applied** — schema is stable and deployed
- **EnrollmentQueue (SQS)** — 90s visibility timeout, batch size 10 with partial-batch responses, redrives to DLQ after 3 retries
- **EnrollmentDLQ (SQS)** — 14-day message retention for poisoned enrollments
- **EnrollmentCron (CronV2)** — `rate(1 hour)` trigger that invokes the dispatcher Lambda

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
  - `processEnrollment(enrollmentId)` — loads the workflow's steps and edges, then executes the current step
  - Handles all step types: `send`, `branch`, `filter`, `wait`, `exit`
- **Dispatcher Lambda** (`apps/server/functions/dispatcher/index.ts`) — invoked hourly by `EnrollmentCron`
  - Atomically claims up to 100 ready enrollments via `UPDATE ... FOR UPDATE SKIP LOCKED`, flipping them to `status='processing'` to prevent double-dispatch
  - Fans out claimed IDs to `EnrollmentQueue` using `SendMessageBatchCommand` (batches of 10)
- **Worker Lambda** (`apps/server/functions/worker/index.ts`) — SQS-subscribed consumer
  - Processes each message through the walker; failed messages return as `batchItemFailures` so SQS only retries the failed records
  - Three retries before redrive to `EnrollmentDLQ`
- **Push delivery via Expo** — `sendPushNotification` (`apps/server/services/enrollment/send.ts`) is wired into the worker's `onSend` callback
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

**Auth & multi-tenancy**
- **API key authentication** — `customer.apiKey` exists but is never validated; the Public API trusts the `x-customer-id` header. The client hardcodes a dev customer id in `apps/client/lib/api.ts`.
- **Customer onboarding / signup / login** — no auth UI, session, or signup flow. The product currently assumes a single seeded customer.
- **Tenant isolation at the query layer** — repositories scope by `customerId` from the header but nothing prevents a forged header from reading another tenant's data.

**Notification correctness & observability**
- **No idempotency guard inside steps** — a worker that partially completes a step (notification sent but `current_step_id` not yet updated) will re-send on SQS retry. Step execution is not transactional.
- **No Expo receipt polling** — tickets returned by `sendPushNotificationsAsync` are logged but never reconciled against Expo's receipts endpoint, so delivery status, invalid tokens, and provider errors are invisible.
- **`communication_log` is send-only metadata** — table captures the rendered config but has no status, error, ticket id, or receipt fields. There's no way to answer "did this notification deliver?".
- **Hourly dispatch granularity** — `EnrollmentCron` runs at `rate(1 hour)`, so a wait step set to "1 hour" can fire up to ~1 hour late. Sub-hour precision needs a faster cron or per-enrollment scheduling.
- **No DLQ alerting** — messages land in `EnrollmentDLQ` after 3 retries but nothing alerts on depth or replays them.

**Journey-engine features called out in north-star**
- **"Has event been received" condition** — branch operators today only inspect user attributes (`=`, `!=`, `exists`, `not_exists`). The north-star example journey ("has `purchase_completed` been received?") cannot be expressed.
- **Deep links on send steps** — `SendConfig` accepts `title` + `body` only; no `deep_link` / `url` field, no UI for it in the canvas.
- **Journey templates** — no scaffolded starter journeys for new customers.

**Product surfaces (frontend)**
- **Campaigns / transactional / loops pages are stubs** — `NewCampaign`, `CampaignDetail`, `NewTransactional`, `TransactionalDetail`, `NewLoop` are placeholder components. The home page lists them with mock data from `apps/client/data/mock-data.ts`.
- **Broken `/canvas2` routes** — `App.tsx` still imports `NewCanvas2Page` / `EditCanvas2Page` from `pages/canvas2`, but that directory no longer exists. The build will fail until the routes are removed.
- **No analytics dashboard** — home page columns (Sends / Opens / Clicks / Status) are populated from mocks; no real per-journey or per-customer delivery stats.
- **No settings area** — no billing/tier display, no MAU usage meter, no team management, no API key rotation UI.
- **No developer integration surface** — no in-app code snippets, SDK docs, or "test your integration" panel to help a customer's developer wire up token registration and event firing.

**Billing & metering**
- **No MAU tracking** — the north-star prices on monthly active users. No table, no rollup job, no enforcement of the Free / Starter / Growth / Scale caps.
- **No billing integration** — no Stripe or other payment provider wired up.

**Campaign / transactional / loop semantics**
- The home page distinguishes these concepts but the `workflow` table doesn't — every workflow has the same shape regardless of which bucket it appears in. Either the data model needs a discriminator column or the frontend distinction needs to collapse.
