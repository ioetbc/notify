## Notify — Project Status (2026-04-23)

### 1. Infrastructure
- **SST on AWS** — fully configured with two Lambda functions (Admin API, Public API) and a static site for the frontend
- **Neon PostgreSQL 17** — managed DB provisioned via SST, Drizzle ORM + migrations in place
- **3 migrations applied** — schema is stable and deployed

### 2. Database Schema (Drizzle)
All core tables are defined and migrated:
- **customer** — multi-tenant accounts with API key field
- **user** — end users per customer, identified by `external_id`, with flexible `attributes` JSONB column and gender/phone fields
- **workflow** — workflow definitions with name, trigger event, and status enum (`draft`/`active`/`paused`/`archived`)
- **step** — workflow steps with type enum (`wait`/`branch`/`send`/`filter`) and typed JSONB config
- **step_edge** — directed edges between steps, with `handle` field for branch outputs
- **workflow_enrollment** — tracks which users are in which workflows, their current step, status, and `process_at` timestamp
- **event** — log of all tracked events with properties JSONB
- Full relations defined between all tables, cascade deletes, unique constraints (e.g. one enrollment per user per workflow)

### 3. Admin API (Hono, internal)
- `POST /workflows` — create workflow with steps + edges
- `PUT /workflows/:id` — update workflow (replaces all steps/edges)
- `GET /workflows/:id` — get workflow with steps + edges
- `GET /workflows/` — list all workflows for customer
- `GET /user-columns` — introspects JSONB attributes across all users to populate branch/filter dropdowns in the canvas
- All endpoints scoped by `x-customer-id` header
- Zod validation on all request bodies
- Layered architecture: routes → services → repositories

### 4. Public API (Hono, customer-facing)
- `PATCH /v1/users/:external_id` — update user attributes (merges into JSONB)
- `POST /v1/events` — track an event, store it, and auto-enroll the user into any active workflows whose trigger event matches
- Both endpoints return structured error responses for missing users
- Event tracking returns `workflows_triggered` count

### 5. Canvas UI (React + @xyflow/react)
- **Full visual workflow builder** with infinite canvas, pan/zoom
- **Step palette** — drag-and-drop sidebar with wait, branch, send, filter, trigger nodes (color-coded with icons)
- **Config panel** — right sidebar that renders type-specific forms:
  - Trigger: dropdown to pick trigger event (`contact_added`, `contact_updated`, `event_received`)
  - Wait: hours input with formatted duration display
  - Branch: user column dropdown (populated from API), operator picker, compare value
  - Send: title + body text inputs
  - Filter: attribute key, operator, compare value
- **Connection validation** — prevents self-loops and cycles
- **Auto-layout** — Dagre-based hierarchical layout
- **Persistence** — saves/loads workflows via Admin API with React Query; `dbToCanvas` converts API response back into xyflow nodes/edges
- Create (`/workflow`) and edit (`/workflow/:id`) routes

### 6. Frontend Shell
- React Router with sidebar navigation
- Home page with accordion sections for campaigns/transactional (currently using mock data)
- Pages exist for campaigns, transactional, and loops but are placeholder/mock-driven
- Hono RPC client with type-safe API calls

### 7. Seeding / Dev Tooling
- DB reset, seed (creates test customer), migrate, and Drizzle Studio scripts
- Hardcoded test customer ID in the frontend API client for development

---

### What Does NOT Exist Yet

- **Workflow execution engine** — enrollments are created but no step processor exists (no queue, no worker, no scheduler to advance users through steps)
- **Actual notification delivery** — Send step stores title/body but nothing calls Expo's Push API
- **Push token storage** — the `POST /users/register` endpoint from north-star.md is not implemented; user table has no `push_token` column
- **API key authentication** — `apiKey` column exists on customer but is never validated; everything uses `x-customer-id` header
- **Workflow status lifecycle** — no publish/activate flow; workflows save as `draft` but the event tracker looks for `active` workflows
- **Analytics / delivery receipts** — no notification log, no Expo receipt polling, no metrics
- **Campaign / transactional / loop distinction** — the home page references these concepts but they're backed by mock data, not the workflow system
- **User registration endpoint** — no public endpoint to register users + push tokens
