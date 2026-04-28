# RFC: Deep WorkflowStore Module

## Problem

The workflow graph persistence layer is spread across 4 files with 3 separate type systems for the same data:

- **`CanvasStep` / `CanvasEdge`** (`services/workflow/workflow.types.ts`) — correct discriminated union with all 5 step types
- **`StepInput` / `EdgeInput`** (`repository/workflow/workflow.types.ts`) — incomplete, only allows `"wait" | "branch" | "send"`, silently drops filter/exit steps
- **`canvasStepSchema`** (`schemas/workflow/workflow.ts`) — Zod validation, correct with all 5 types

This causes:

- **Silent data loss**: `StepInput.type` missing `"filter"` and `"exit"` means those steps are dropped on persist
- **Silent field drop**: `updateWorkflow()` Pick type excludes `triggerType`, so trigger type changes are lost on update
- **Non-atomic updates**: `updateWorkflow` deletes all steps then reinserts with no transaction — crash between operations = orphaned data
- **Shallow modules**: `toStepInputs()` / `toEdgeInputs()` are trivial field mappers that exist only because the types don't line up across layers

The service layer (`services/workflow/workflow.ts`) adds almost no value over the repository — it's a passthrough with field renaming. The repository (`repository/workflow/workflow.ts`) is a bag of standalone functions with no shared transaction context.

## Proposed Interface

Consolidate into a single deep `WorkflowStore` class following the `EnrollmentWalker` pattern: constructor takes `{ db: Db }`, all DB access is private, testable with PGlite.

```typescript
import type { Db } from "../../db";
import type {
  Workflow, Step, StepEdge,
  WaitConfig, BranchConfig, SendConfig, FilterConfig, ExitConfig,
} from "../../db/schema";

// ── Single canonical type system ────────────────────────────────────────

export type GraphStep =
  | { id: string; type: "wait";   config: WaitConfig }
  | { id: string; type: "branch"; config: BranchConfig }
  | { id: string; type: "send";   config: SendConfig }
  | { id: string; type: "filter"; config: FilterConfig }
  | { id: string; type: "exit";   config: ExitConfig };

export type GraphEdge = {
  source: string;
  target: string;
  handle?: boolean | null;
};

export type TriggerConfig =
  | { triggerType: "system"; triggerEvent: "user_created" | "user_updated" }
  | { triggerType: "custom"; triggerEvent: string };

export type WorkflowView = {
  workflow: Workflow;
  steps: Step[];
  edges: StepEdge[];
};

export type SaveWorkflowInput = {
  id?: string;             // absent = create, present = update
  customerId: string;
  name: string;
  trigger: TriggerConfig;
  steps: GraphStep[];
  edges: GraphEdge[];
};

// ── Module ──────────────────────────────────────────────────────────────

export interface WorkflowStoreDeps {
  db: Db;
}

export class WorkflowStore {
  constructor(private deps: WorkflowStoreDeps) {}

  async save(input: SaveWorkflowInput): Promise<WorkflowView> { ... }
  async get(workflowId: string): Promise<WorkflowView | null> { ... }
  async list(limit?: number): Promise<Workflow[]> { ... }
  async publish(workflowId: string): Promise<Workflow> { ... }
}
```

**Usage in Hono handler:**

```typescript
import { WorkflowStore } from "../../services/workflow/workflow-store";
import { db } from "../../db";

const store = new WorkflowStore({ db });

const workflows = new Hono()
  .get("/:id", async (c) => {
    const result = await store.get(c.req.param("id"));
    if (!result) return c.json({ error: "Workflow not found" }, 404);
    return c.json(result, 200);
  })
  .post("/", zValidator("json", createWorkflowSchema), async (c) => {
    const customerId = getCustomerId(c);
    const body = c.req.valid("json");
    const result = await store.save({
      customerId,
      name: body.name,
      trigger: { triggerType: body.trigger_type, triggerEvent: body.trigger_event },
      steps: body.steps,
      edges: body.edges,
    });
    return c.json(result, 201);
  })
  .put("/:id", zValidator("json", updateWorkflowSchema), async (c) => {
    const customerId = getCustomerId(c);
    const body = c.req.valid("json");
    const result = await store.save({
      id: c.req.param("id"),
      customerId,
      name: body.name,
      trigger: { triggerType: body.trigger_type, triggerEvent: body.trigger_event },
      steps: body.steps,
      edges: body.edges,
    });
    if (!result) return c.json({ error: "Workflow not found" }, 404);
    return c.json(result, 200);
  })
  .patch("/:id/publish", async (c) => {
    const result = await store.publish(c.req.param("id"));
    if (!result) return c.json({ error: "Workflow not found" }, 404);
    return c.json({ workflow: result }, 200);
  });
```

The handler has zero knowledge of tables, transactions, or type mapping.

## Dependency Strategy

**Local-substitutable** — `Db` is the only constructor dependency.

- **Production**: `new WorkflowStore({ db })` where `db` is the SST-injected Drizzle/Neon instance
- **Tests**: `new WorkflowStore({ db: drizzle(new PGlite(), { schema }) })` — same interface, no mocks

This mirrors exactly how `EnrollmentWalker` is tested in `services/enrollment/enrollment.test.ts`.

## Testing Strategy

**New boundary tests to write** (`workflow-store.test.ts`):
- Create workflow with all 5 step types — verify all persist (catches the filter/exit data loss bug)
- Update workflow — verify `triggerType` persists (catches the silent drop bug)
- Update workflow — verify atomicity (steps and edges are consistent, no orphans)
- Get workflow — returns full graph (workflow + steps + edges)
- Publish — transitions status to active
- List — returns workflows ordered by createdAt desc

**Old tests to delete** (in follow-up):
- No existing tests for the workflow service/repository, so nothing to remove

**Test environment**: PGlite via `createTestDb()` from `test/db.ts`, run with `sst shell -- bun test`

## Implementation Recommendations

### What the module should own (responsibilities)
- All CRUD operations on workflow + steps + edges as a single graph
- Type mapping from API-facing input types to DB column shapes
- Transaction management for multi-table writes
- Status transitions (publish)

### What it should hide (implementation details)
- Drizzle query construction
- Snake_case ↔ camelCase field mapping (trigger_type → triggerType)
- Delete-then-reinsert strategy for graph replacement
- Transaction boundaries

### What it should expose (the interface contract)
- `GraphStep` discriminated union (all 5 types) — the canonical step type
- `SaveWorkflowInput` — one input shape for both create and update
- `WorkflowView` — workflow row + steps array + edges array
- 4 methods: `save`, `get`, `list`, `publish`

### How callers should migrate
1. Fix the two existing bugs in repository types first (safety net for any remaining consumers)
2. Create WorkflowStore and tests
3. Update `functions/admin/workflows.ts` to use WorkflowStore
4. Keep old `services/workflow/workflow.ts` and `repository/workflow/` until all callers are migrated
5. Delete old files in follow-up once verified

### Files involved

| Action | File |
|--------|------|
| Create | `apps/server/services/workflow/workflow-store.ts` |
| Create | `apps/server/services/workflow/workflow-store.test.ts` |
| Modify | `apps/server/functions/admin/workflows.ts` |
| Fix bug | `apps/server/repository/workflow/workflow.types.ts` — add `"filter" \| "exit"` to StepInput.type |
| Fix bug | `apps/server/repository/workflow/workflow.ts` — add `"triggerType"` to updateWorkflow Pick |
| Keep | `apps/server/services/workflow/workflow.ts` — delete in follow-up |
| Keep | `apps/server/schemas/workflow/workflow.ts` — Zod schemas stay as-is |
| Keep | `apps/server/db/schema.ts` — no changes needed |
