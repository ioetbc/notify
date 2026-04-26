# Implementation Plan: Deepen Enrollment Step Walker

RFC: `docs/rfc-deepen-enrollment-walker.md`

---

## Step 1: Add Zod schemas for step configs

**Files:** `server/db/schema.ts`

Replace the plain TypeScript types with Zod schemas. Keep the exported type aliases as `z.infer<...>` so nothing downstream breaks.

```typescript
import { z } from "zod";

export const WaitConfigSchema = z.object({ hours: z.number() });
export const BranchConfigSchema = z.object({
  user_column: z.string(),
  operator: z.enum(["=", "!=", "exists", "not_exists"]),
  compare_value: z.string().optional(),
});
export const SendConfigSchema = z.object({ title: z.string(), body: z.string() });
export const FilterConfigSchema = z.object({
  attribute_key: z.string(),
  operator: z.enum(["=", "!=", ">", "<"]),
  compare_value: z.union([z.string(), z.number(), z.boolean()]),
});
export const ExitConfigSchema = z.object({}).strict();

export type WaitConfig = z.infer<typeof WaitConfigSchema>;
export type BranchConfig = z.infer<typeof BranchConfigSchema>;
// ... etc
```

**Why first:** everything else depends on validated configs. This step is safe — existing code that uses the types keeps working.

**Verify:** `sst shell -- bun test` still passes (no runtime change yet).

---

## Step 2: Add PGLite + Drizzle test infrastructure

**Install:** `@electric-sql/pglite`

**New file:** `server/test/db.ts` — shared test helper

```typescript
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "../db/schema";

export async function createTestDb() {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: "./drizzle" }); // or apply SQL directly
  return { db, client };
}
```

**Concern — migration strategy:** The project uses Drizzle Kit migrations. We need to either:
- (a) Point PGLite at the existing `drizzle/` migrations folder, or
- (b) Generate the DDL from schema and `exec()` it directly

Option (a) is preferred if a `drizzle/` folder with migration SQL already exists. Option (b) if not — we can use `drizzle-kit generate` to create one, or use `pgTable` introspection to build CREATE TABLE statements.

**Check:** does `drizzle/` migration folder exist? If not, generate it before proceeding. Also need to handle the `pgEnum` types which PGLite supports.

**Verify:** write a smoke test that creates the test db, inserts a row, reads it back.

---

## Step 3: Define the `Db` type

**File:** `server/db/index.ts` (or a new `server/db/types.ts`)

Both Neon HTTP and PGLite Drizzle instances extend `PgDatabase`. The factory needs a type that accepts either:

```typescript
import type { PgDatabase } from "drizzle-orm/pg-core/db";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core/session";
import type * as schema from "./schema";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
```

Export this from `server/db/index.ts` alongside the existing `db` instance. The factory will use `Db` as its parameter type.

---

## Step 4: Create `createEnrollmentWalker` factory

**File:** `server/services/enrollment/enrollment.ts` (rewrite in place)

### 4a. Define types

```typescript
import type { SendConfig } from "../../db/schema";
import type { Db } from "../../db";

type SendHandler = (payload: {
  userId: string;
  enrollmentId: string;
  stepId: string;
  config: SendConfig;
}) => Promise<void>;

type StepEvent =
  | { kind: "stepped"; stepId: string; type: StepType; result: WalkResult }
  | { kind: "exited"; reason: "filter" | "branch" | "missing_user" }
  | { kind: "completed" }
  | { kind: "waiting"; until: Date };

type WalkObserver = (event: StepEvent) => void;

interface EnrollmentWalkerDeps {
  db: Db;
  onSend: SendHandler;
  observe?: WalkObserver;
}

interface EnrollmentWalker {
  processEnrollment(enrollmentId: string): Promise<void>;
  processReadyEnrollments(): Promise<{ processed: number; failed: number }>;
}
```

### 4b. Factory implementation

```typescript
export function createEnrollmentWalker(deps: EnrollmentWalkerDeps): EnrollmentWalker {
  const { db, onSend, observe } = deps;

  // ── Private: repository queries (inlined from old repository module) ──
  async function findReadyEnrollments() { /* uses deps.db */ }
  async function findUserById(userId: string) { /* uses deps.db */ }
  async function findStepsByWorkflowId(workflowId: string) { /* uses deps.db */ }
  async function findEdgesByWorkflowId(workflowId: string) { /* uses deps.db */ }
  async function updateEnrollment(id: string, values: ...) { /* uses deps.db */ }
  async function insertCommunicationLog(values: ...) { /* uses deps.db */ }

  // ── Private: pure step-walking logic (unchanged) ──
  function evaluateBranchCondition(...) { /* same logic */ }
  function evaluateFilterCondition(...) { /* same logic */ }
  function findOutgoingEdge(...) { /* same logic */ }
  function walkStep(...) { /* same logic, but Zod-parse config instead of `as` cast */ }

  // ── Public ──
  async function processEnrollment(enrollmentId: string) {
    // Fetch enrollment by ID from db (new — old version took the object)
    // Run the walk loop
    // Call onSend for send steps
    // Emit observe() events
  }

  async function processReadyEnrollments() {
    // Same logic, calls processEnrollment(id) for each
  }

  return { processEnrollment, processReadyEnrollments };
}
```

### Key changes from current code

1. **`processEnrollment` takes `enrollmentId: string`** not a full `WorkflowEnrollment` object — it fetches the enrollment internally. This is cleaner for callers and lets the factory own the "lock to processing" step inside `processEnrollment` itself rather than in `processReadyEnrollments`.
2. **Zod parsing** replaces every `as` cast: `SendConfigSchema.parse(step.config)` etc., matched via `ts-pattern` on `step.type`.
3. **`onSend` handler** is called for send steps. The factory still writes to `communicationLog` internally — `onSend` is the external integration point.
4. **`observe`** is called at each step transition with a `StepEvent`. Synchronous, fire-and-forget.
5. **All 6 repository functions** become private closures using `deps.db` instead of the module-level `db` singleton.

**Verify:** should not be importable except through the factory. Only `createEnrollmentWalker` is exported.

---

## Step 5: Update the caller

**File:** `server/functions/admin/index.ts`

```typescript
// Before:
import { processReadyEnrollments } from "../../services/enrollment";

// After:
import { createEnrollmentWalker } from "../../services/enrollment";
import { db } from "../../db";

const walker = createEnrollmentWalker({
  db,
  onSend: async () => {},  // no external provider wired yet
});

// In route handler:
const result = await walker.processReadyEnrollments();
```

Check for any other callers of `processEnrollment` or `processReadyEnrollments` (grep found only this one).

---

## Step 6: Delete the repository module

**Delete:**
- `server/repository/enrollment/enrollment.ts`
- `server/repository/enrollment/index.ts`

**Check:** grep for any remaining imports of `repository/enrollment` — there should be none after step 4.

---

## Step 7: Replace tests with PGLite boundary tests

**File:** `server/services/enrollment/enrollment.test.ts` (rewrite in place)

### Test structure

```typescript
import { describe, it, expect, beforeEach } from "bun:test";
import { createTestDb } from "../../test/db";
import { createEnrollmentWalker } from "./enrollment";
// ... schema imports for seeding

let db: TestDb;
let events: StepEvent[];
let sendCalls: SendPayload[];

beforeEach(async () => {
  ({ db } = await createTestDb());
  events = [];
  sendCalls = [];
});

function createWalker() {
  return createEnrollmentWalker({
    db,
    onSend: async (payload) => { sendCalls.push(payload); },
    observe: (event) => { events.push(event); },
  });
}
```

### Test cases (from RFC)

Each test seeds real rows in PGLite and asserts on DB state after processing:

1. **Send step** — `communicationLog` has expected row; `onSend` called with Zod-validated config
2. **Branch step (true/false/missing attribute)** — enrollment ends at correct terminal status
3. **Filter step (pass/fail/missing attribute)** — same
4. **Wait step** — enrollment row has `processAt` set to expected future timestamp
5. **Exit step** — enrollment status is `exited`
6. **Multi-step workflows** — seed full graph, process, verify final state
7. **Config validation** — malformed config causes Zod error
8. **Missing user** — returns early, no side effects
9. **processReadyEnrollments** — seeds multiple enrollments with different `processAt`, verifies only ready ones processed

### Seeding helper

Write a small `seedWorkflow(db, { steps, edges, user, enrollment })` helper that inserts the full object graph (customer -> user -> workflow -> steps -> edges -> enrollment) and returns the IDs. This replaces the mock `setupMocks` function with real data.

**Verify:** `sst shell -- bun test` — all new tests pass.

---

## Execution order

Steps 1-2 can be done in parallel (no dependency). Steps 3-7 are sequential.

```
[1: Zod schemas] ──┐
                    ├── [3: Db type] → [4: Factory] → [5: Update caller] → [6: Delete repo] → [7: Tests]
[2: PGLite infra] ─┘
```

---

## Open questions to resolve during implementation

1. **Migration folder:** Does `drizzle/` exist with SQL migrations? If not, we need to generate it or use raw DDL for PGLite setup.
2. **`processEnrollment` signature change:** The RFC says `processEnrollment(enrollmentId: string)` but the current code takes a full `WorkflowEnrollment`. This means the factory needs to fetch the enrollment by ID internally. This is a minor behavior change — confirm it's intentional. (I believe it is, since `processReadyEnrollments` already fetches them.)
3. **`onSend` vs `communicationLog`:** Should `onSend` be called *in addition to* writing to `communicationLog`, or *instead of*? The RFC says the factory owns communication logging internally, so I'll do both — log to DB, then call `onSend`.
