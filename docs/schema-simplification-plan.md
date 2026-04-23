# Plan: Simplify workflow schema — JSONB config + explicit edges

## Context

The current workflow system stores step configuration across 4 tables (`step`, `step_wait`, `step_branch`, `step_send`) and encodes graph edges implicitly as FKs on the type-specific tables (`nextStepId`, `trueStepId`, `falseStepId`). This forces type-switching on every save, load, and update — both backend and frontend. The project is early (no production data), so we can restructure cleanly.

The goal: collapse to `step` (with JSONB config) + `step_edge` (explicit edges). This simplifies the code while keeping the schema queryable for the workflow engine described in `delivery.md`.

## Benefits

- **3 fewer tables**: drop `step_wait`, `step_branch`, `step_send`
- **No type-switching on save**: `insertSteps` becomes a single insert per step (config passes through as JSONB)
- **No type-switching on link**: `linkEdges` becomes a single bulk insert into `step_edge`
- **No LEFT JOINs on load**: GET endpoint does two simple queries (`step` + `step_edge`) instead of a 4-table join returning nullable columns
- **Frontend `dbToCanvas` shrinks from ~130 lines to ~40**: no reconstructing edges from scattered FK fields, no type-switching to build node data
- **Steps PUT shrinks from ~50 lines to ~10**: just update the JSONB column
- **Engine-ready**: step_edge table gives clean graph traversal for the delivery engine (`SELECT target_step_id FROM step_edge WHERE source_step_id = ?`)
- **New step types don't require migrations**: adding a new step type (e.g. "delay_until", "webhook") is just a new config shape — no new table

## Disadvantages

- **No column-level constraints on config**: you lose `hours INTEGER NOT NULL` on wait steps — validation moves to Zod at the API boundary (already there today)
- **No FK from branch config to attributeDefinition**: currently `step_branch.attributeDefinitionId` references `attribute_definition.id`. This moves into the JSONB config and loses referential integrity at the DB level. The engine would need to validate at runtime.
- **JSONB queries are slightly more verbose**: `step.config->>'hours'` instead of `step_wait.hours`, but we only need this for the engine, not the canvas

## New schema

```
workflow (id, customer_id, name, trigger_event, status, created_at)  -- unchanged
step (id, workflow_id, step_type, config jsonb, created_at)          -- config replaces sub-tables
step_edge (id, workflow_id, source_step_id, target_step_id, handle)  -- new, replaces implicit FKs
```

Execution tables unchanged:
```
workflow_enrollment (id, user_id, workflow_id, current_step_id, status, process_at, created_at)
```

## Engine queries with new schema

```sql
-- Load the current step
SELECT step_type, config FROM step WHERE id = $current_step_id;

-- Find next step(s)
SELECT target_step_id, handle FROM step_edge WHERE source_step_id = $current_step_id;

-- For branch: pick edge by handle
SELECT target_step_id FROM step_edge
WHERE source_step_id = $current_step_id AND handle = 'yes';  -- or 'no'

-- Cron for wait resumption (unchanged)
SELECT * FROM workflow_enrollment WHERE status = 'waiting' AND resume_at <= NOW();
```

## Files to change

### 1. `server/db/schema.ts` — Schema

- Add `jsonb` import from `drizzle-orm/pg-core`
- Add `config: jsonb("config").notNull()` to `step` table
- Add new `stepEdge` table:
  ```ts
  stepEdge = pgTable("step_edge", {
    id: uuid("id").primaryKey().defaultRandom(),
    workflowId: uuid("workflow_id").notNull().references(() => workflow.id, { onDelete: "cascade" }),
    sourceStepId: uuid("source_step_id").notNull().references(() => step.id, { onDelete: "cascade" }),
    targetStepId: uuid("target_step_id").notNull().references(() => step.id, { onDelete: "cascade" }),
    handle: text("handle"),  // "yes"/"no" for branch, null for linear
  })
  ```
- Remove `stepWait`, `stepBranch`, `stepSend` table definitions
- Remove `branchOperatorEnum` (operator lives in JSONB now)
- Remove `stepWaitRelations`, `stepBranchRelations`, `stepSendRelations`
- Update `stepRelations`: remove `waitConfig`/`branchConfig`/`sendConfig`, add `edges: many(stepEdge)`
- Add `stepEdgeRelations`
- Update type exports

### 2. Generate migration

- Run `npx drizzle-kit generate` from `server/`
- Review generated SQL
- No data migration needed (no production data)

### 3. `server/functions/admin/workflows.ts` — Endpoints

**Imports**: remove `stepWait`, `stepBranch`, `stepSend`, `branchOperatorEnum`, `match`. Add `stepEdge`.

**Zod schemas**: keep the discriminated union for input validation — no change needed.

**`insertSteps`** (~36 lines → ~12 lines):
```ts
async function insertSteps(workflowId: string, canvasSteps: CanvasStep[]) {
  const idMap = new Map<string, string>();
  for (const cs of canvasSteps) {
    const [row] = await db.insert(step)
      .values({ workflowId, stepType: cs.type, config: cs.config })
      .returning();
    idMap.set(cs.id, row.id);
  }
  return idMap;
}
```

**`linkEdges`** (~36 lines → ~15 lines):
```ts
async function linkEdges(workflowId: string, idMap: Map<string, string>, edges: CanvasEdge[]) {
  const rows = edges
    .map(e => {
      const src = idMap.get(e.source), tgt = idMap.get(e.target);
      if (!src || !tgt) return null;
      return { workflowId, sourceStepId: src, targetStepId: tgt, handle: e.sourceHandle ?? null };
    })
    .filter(Boolean);
  if (rows.length) await db.insert(stepEdge).values(rows);
}
```

**GET /:id**: replace 4-table LEFT JOIN with two simple queries returning `{ workflow, steps, edges }`.

### 4. `server/functions/admin/steps.ts` — Step update

Replace entire file (~65 lines → ~15 lines):
```ts
// PUT /:id → db.update(step).set({ config: body.config }).where(eq(step.id, stepId))
```

### 5. `src/react-app/pages/canvas/canvas.tsx` — Frontend

**`DbStep` interface**: simplify to `{ id, stepType, config }`. Add `DbEdge`: `{ id, sourceStepId, targetStepId, handle }`.

**`dbToCanvas`** (~130 lines → ~40 lines):
- Map steps to nodes directly (config already matches)
- Map DB edges to React Flow edges directly
- Add trigger node, connect to root, run dagre

**Save mutation**: simplify to `{ id: n.id, type: n.data.type, config: n.data.config }` — no type-switching.

### 6. No changes needed

- `types.ts`, `nodes.tsx`, `layout.ts`, `step-palette.tsx` — unchanged
- `api.ts` — Hono RPC types auto-update
- `functions/admin/index.ts` — routes unchanged

## Verification

1. Run `npx drizzle-kit generate` and review the migration SQL
2. Apply migration to local DB
3. Start dev server
4. Create a new workflow with all 3 step types and edges
5. Reload the page — verify workflow loads with correct positions and edges
6. Edit step configs, save, reload — verify persistence
7. Add/remove steps, save, reload — verify update path
8. Check DB: `SELECT * FROM step` shows config JSONB, `SELECT * FROM step_edge` shows edges
