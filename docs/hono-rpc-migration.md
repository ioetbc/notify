# Hono RPC Migration Plan

## Goal
Replace raw `fetch()` calls in the frontend with Hono's built-in RPC client (`hono/client`). This gives end-to-end type safety — request bodies, response shapes, and enum values all flow from the server route definitions. No more manual interfaces or `/enums` endpoint.

## What Hono RPC gives you
- The server exports its app type: `export type AppType = typeof app`
- The frontend creates a typed client: `const client = hc<AppType>(API_URL)`
- All request/response types are inferred automatically
- No runtime overhead — it's just `fetch()` under the hood with type inference

---

## Server Changes

### File: `server/functions/admin/index.ts`

**1. Derive types from DB schema enums (already done)**

```ts
import { stepTypeEnum, branchOperatorEnum, triggerEventEnum } from "../../db";

type StepType = (typeof stepTypeEnum.enumValues)[number];
type BranchOperator = (typeof branchOperatorEnum.enumValues)[number];
type TriggerEvent = (typeof triggerEventEnum.enumValues)[number];
```

**2. Remove unused endpoints**

Delete these (not called by the frontend):
- `GET /` (hello world)
- `GET /version`
- `GET /enums` (types will flow via RPC instead)
- `DELETE /workflows/:id` (not used by frontend)

**3. Export the app type**

At the bottom of the file, add:

```ts
// The route chain must be stored in a variable for type inference
const routes = app
  .get("/workflows/:id", async (c) => { ... })
  .get("/workflows", async (c) => { ... })
  .post("/workflows", async (c) => { ... })
  .put("/workflows/:id", async (c) => { ... })
  .get("/user-columns", async (c) => { ... })
  .put("/steps/:id", async (c) => { ... });

export type AppType = typeof routes;
export const handler = handle(app);
```

**Important:** The chained methods must be assigned to a variable (`routes`) for TypeScript to infer the full type. If you just chain on `app` without capturing the return, the type won't include the route definitions.

---

## Frontend Changes

### File: `src/react-app/pages/canvas/canvas.tsx`

**Before:**
```ts
const API_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

// Fetch user columns and enums
const [columnsRes, enumsRes] = await Promise.all([
  fetch(`${API_URL}/user-columns`),
  fetch(`${API_URL}/enums`),
]);
const columnsData = await columnsRes.json();
const enumsData = await enumsRes.json();
setTriggerEvents(enumsData.trigger_event || []);
```

**After:**
```ts
import { hc } from 'hono/client';
import type { AppType } from '../../../server/functions/admin/index';

const client = hc<AppType>(import.meta.env.VITE_API_URL || '');

// Fetch user columns — fully typed, no manual interface needed
const columnsRes = await client['user-columns'].$get();
const columnsData = await columnsRes.json();
// columnsData.columns is typed as { id: string; name: string; dataType: string }[]
setUserColumns(columnsData.columns);
```

Remove the `/enums` fetch entirely. For `triggerEvents`, the `TriggerEvent` type in `canvas/types.ts` already has the values. If you need the array at runtime for a dropdown, just define it once:

```ts
// In canvas/types.ts or wherever makes sense
export const TRIGGER_EVENTS: TriggerEvent[] = ['contact_added', 'contact_updated', 'event_received'];
```

This is fine because the values come from a DB enum — they don't change at runtime.

**Load existing workflow:**
```ts
// Before
const res = await fetch(`${API_URL}/workflows/${workflowId}`);
const data = await res.json();

// After
const res = await client.workflows[':id'].$get({ param: { id: workflowId } });
const data = await res.json();
// data.workflow and data.steps are fully typed
```

**Save workflow (POST/PUT):**
```ts
// Before
const res = await fetch(url, {
  method: workflowId ? 'PUT' : 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
});

// After — POST (new workflow)
const res = await client.workflows.$post({
  json: {
    name: workflowName,
    trigger_event: triggerEvent,
    steps,
    edges: canvasEdges,
  },
});

// After — PUT (update existing)
const res = await client.workflows[':id'].$put({
  param: { id: workflowId },
  json: {
    name: workflowName,
    trigger_event: triggerEvent,
    steps,
    edges: canvasEdges,
  },
});
```

### File: `src/react-app/pages/workflow/workflow.tsx`

**Before:**
```ts
interface Enums {
  trigger_event: string[];
  step_type: string[];
  branch_operator: string[];
}

const [enums, setEnums] = useState<Enums | null>(null);

const [enumsRes, listRes] = await Promise.all([
  fetch(`${API_URL}/enums`),
  fetch(`${API_URL}/workflows`),
]);
```

**After:**
```ts
import { hc } from 'hono/client';
import type { AppType } from '../../../server/functions/admin/index';

const client = hc<AppType>(import.meta.env.VITE_API_URL || '');

// No more Enums interface or enums state needed
// For the trigger_event dropdown, use the const array
const TRIGGER_EVENTS = ['contact_added', 'contact_updated', 'event_received'] as const;
const BRANCH_OPERATORS = ['=', '!=', 'exists', 'not_exists'] as const;

// Fetch workflows list
const listRes = await client.workflows.$get();
const listData = await listRes.json();

// Fetch single workflow
const res = await client.workflows[':id'].$get({ param: { id: workflowId } });
const result = await res.json();

// Update trigger event
await client.workflows[':id'].$put({
  param: { id: data.workflow.id },
  json: { trigger_event: value },
});

// Update step
await client.steps[':id'].$put({
  param: { id: stepId },
  json: updates,
});
```

Remove the `Enums` interface, `enums` state, and all `/enums` fetch calls. Replace `enums.trigger_event` and `enums.branch_operator` usage with the const arrays above.

In `StepEditPopover`, change:
```ts
// Before
enums.branch_operator.map((op) => ...)

// After
BRANCH_OPERATORS.map((op) => ...)
```

And remove the `enums` prop from `StepEditPopover` entirely.

### File: `src/react-app/pages/canvas/types.ts`

This file already has the right types. No changes needed — Hono RPC will validate against the server types at compile time.

---

## Important Caveats (from Hono docs)

### Path params and query values must be strings
Both path parameters and query values **must** be passed as `string`, even if the underlying value is a different type. The validator will coerce them.
```ts
// Correct
client.workflows[':id'].$get({ param: { id: '123' } })

// Wrong — will cause type errors
client.workflows[':id'].$get({ param: { id: 123 } })
```

### Status codes must be explicit for type inference
The server handlers should always return explicit status codes so the client can infer response types correctly. Check that all `c.json()` calls include a status:
```ts
// Good — client can infer the response shape per status code
return c.json({ workflow: workflowResult, steps }, 200);
return c.json({ error: "Workflow not found" }, 404);

// Bad — RPC client can't distinguish success/error shapes
return c.json({ workflow: workflowResult, steps });
```

Go through all handlers in `admin/index.ts` and add explicit `200` to success responses. Error responses already have status codes.

### Don't use `c.notFound()`
The Hono docs warn that `c.notFound()` prevents the client from inferring response types. Use `c.json({ error: '...' }, 404)` instead (the current code already does this correctly).

### Hono versions must match
The `hono` package version in `server/package.json` and the root `package.json` (frontend) must be the same. If they differ, you'll get type instantiation errors. Check with:
```bash
# In both package.json files, ensure hono version matches
grep hono server/package.json package.json
```

### tsconfig needs `strict: true`
Both the server and client tsconfigs must have `"strict": true` for RPC types to work. The project already has this in `tsconfig.app.json`.

### Optional: pre-compiled client type for faster IDE performance
If type checking gets slow, you can pre-compile the client type:
```ts
export type Client = ReturnType<typeof hc<AppType>>;
export const hcWithType = (...args: Parameters<typeof hc>): Client =>
  hc<typeof app>(...args);
```

## Import Path Note

The `import type { AppType }` is a **type-only import** — it's erased at compile time. No server code is bundled into the frontend. Vite/TypeScript just needs to resolve the path for type checking.

Make sure `tsconfig.app.json` can resolve the server path. You may need to either:
- Widen `include` to cover the server types: `"include": ["src/react-app", "server/functions/admin/index.ts"]`
- Or add a path alias in `tsconfig.app.json`:
  ```json
  "paths": {
    "@server/*": ["../server/*"]
  }
  ```

---

## Summary of what gets deleted

- `GET /` endpoint
- `GET /version` endpoint  
- `GET /enums` endpoint
- `DELETE /workflows/:id` endpoint
- `Enums` interface in `workflow.tsx`
- `enums` state in `workflow.tsx`
- All `fetch(`${API_URL}/enums`)` calls
- All manual `fetch()` calls (replaced by typed `client.*` calls)
- Manual request/response interfaces that Hono RPC now infers
