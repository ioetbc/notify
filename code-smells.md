# Code Smells Audit — Server-Side & Frontend-Server Boundary

## Bugs

### 1. `updateWorkflow` silently drops `triggerType`
- **Service:** `server/services/workflow/workflow.ts:57-60` passes `triggerType: input.trigger_type`
- **Repository:** `server/repository/workflow/workflow.ts:27` only accepts `Partial<Pick<Workflow, "name" | "triggerEvent" | "status">>` — `triggerType` is silently stripped
- **Impact:** Updating a workflow's trigger type does nothing — silent data loss
- **Fix:** Add `"triggerType"` to the `Pick` union in the repository function signature

### 2. `StepInput.type` is missing `"filter"` and `"exit"`
- **File:** `server/repository/workflow/workflow.types.ts:6`
- `type` is hardcoded as `"wait" | "branch" | "send"` — doesn't include `"filter"` or `"exit"`
- The service layer's `CanvasStep` includes all 5 types, so `toStepInputs` can produce values that don't match `StepInput`
- **Fix:** Use the DB's `Step["type"]` inferred type instead of a hand-rolled union

---

## Code Smells

### 3. Duplicated enum/union types across frontend and server
- **Frontend `client/pages/canvas/types.ts:15-19`** manually redeclares:
  - `StepType = 'wait' | 'branch' | 'send' | 'filter' | 'trigger' | 'exit'`
  - `TriggerType = "system" | "custom"`
  - `SystemEvent = "user_created" | "user_updated"`
  - `BranchOperator = '=' | '!=' | 'exists' | 'not_exists'`
- These duplicate what's already defined in `server/db/schema.ts` (pgEnum definitions and config types like `BranchConfig["operator"]`)
- **Fix:** Derive from DB schema types. e.g. `type TriggerType = Workflow["triggerType"]`

### 4. Duplicated constant arrays
- `client/pages/canvas/utils.ts:17-18` — `SYSTEM_EVENTS` and `TRIGGER_TYPES`
- `server/schemas/workflow/workflow.ts:63` — `systemEvents`
- Same values defined in 2+ places
- **Fix:** Single source of truth in server schema, imported by client

### 5. Unsafe `as` casts in `walkStep`
- **File:** `server/services/enrollment/enrollment.ts:76,88,99,110`
- `currentStep.config as SendConfig`, `as BranchConfig`, `as FilterConfig`, `as WaitConfig`
- Bypasses type narrowing — if the DB has mismatched type/config, this silently breaks
- **Fix:** Use a type guard or Zod parse to safely narrow. The `type` field discriminates which config it is but `Step` from Drizzle doesn't model it as a discriminated union — a runtime check makes it safe.

### 6. Excessive `as` casting in canvas code
- `client/pages/canvas/utils.ts:39-71` — every branch of `createNodeData` casts with `as XNodeData`
- `client/pages/canvas/utils.ts:117` — `as StepNodeData`
- `client/pages/canvas/canvas.tsx:113,149,150` — `as StepType`, `as StepNodeData`, `as CanvasNode`
- `client/pages/canvas/config-panel.tsx:76,94,106,192,297` — `as TriggerType`, `as TriggerEvent`, `as typeof config.operator`
- **Fix:** Use `satisfies` instead of `as` where the object already matches the type. For event handler values, validate with Zod or a helper.

### 7. `switch` instead of `ts-pattern` in `createNodeData`
- **File:** `client/pages/canvas/utils.ts:34-73`
- Project convention is to use `ts-pattern` exhaustive matching over switch statements
- **Fix:** Convert to `match(type).with(...).exhaustive()`

### 8. Triplicated `getCustomerId` function
- `server/functions/admin/index.ts:9-13`
- `server/functions/admin/workflows.ts:6-10`
- `server/functions/public/index.ts:12-16`
- Identical function copy-pasted 3 times
- **Fix:** Extract to shared utility or Hono middleware

### 9. Inconsistent error response shapes
- Admin routes return `{ error: "string" }` (`workflows.ts:17,38,49`)
- Public routes return `{ error: { code: "...", message: "..." } }` (`public/index.ts:35-43`)
- **Fix:** Standardize on the structured format everywhere

### 10. Hardcoded event strings
- `server/services/public/public.ts:28` — `"user_created"` string literal
- `server/services/public/public.ts:63` — `"user_updated"` string literal
- A `systemEvents` constant already exists in `server/schemas/workflow/workflow.ts:63`
- **Fix:** Import and use the constant

### 11. Debug console.logs in production code
- **File:** `server/services/enrollment/enrollment.ts` — 22 `console.log`/`console.error` calls
- No log-level distinction, debug logs mixed into business logic
- **Fix:** Remove debug logs or use a logger with levels

12. whereever we reference table names we are getting it from db like this: workflowEnrollment,
       8 +  communicationLog,
       9  } from "../../db";

I would prefer to import * as schema then in the code we reference schema.communicationLog so that it is clear we're using a db table model

13. Deep modules are better than shallow modules.
Deep modules = Lots of functionality, simple interface and hides complexity
Shallow modules (we do not want this) = Not much functionality, complex interface and surfaces complexity
we can use this improve-codebase-architecture skills from matt pocock