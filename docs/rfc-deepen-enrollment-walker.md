# RFC: Deepen Enrollment Step Walker

## Problem

The enrollment step walker is split across two tightly-coupled modules that create integration risk:

- **`server/services/enrollment/enrollment.ts`** (256 lines) — pure step-walking logic (`walkStep`, `evaluateBranchCondition`, `evaluateFilterCondition`, `findOutgoingEdge`) mixed with side-effectful orchestration (`processEnrollment`, `processReadyEnrollments`)
- **`server/repository/enrollment/enrollment.ts`** (66 lines) — 6 anemic Drizzle wrappers (`findReadyEnrollments`, `findUserById`, `findStepsByWorkflowId`, `findEdgesByWorkflowId`, `updateEnrollment`, `insertCommunicationLog`)

The repository is so thin that it adds cognitive overhead without reducing complexity. The service imports all 6 functions and calls them inline — understanding the module requires reading both files as one.

**Concrete risks today:**

1. **Unsafe `as` casts** — `currentStep.config as BranchConfig` (lines 76, 88, 99, 110). If a migration renames a config field, tests pass (mocks return whatever you give them), production crashes.
2. **Mock/prod divergence** — the test file (1000 lines) mocks all 6 repository functions. A broken `WHERE` clause or schema change wouldn't be caught.
3. **Inconsistent null semantics** — `evaluateBranchCondition` returns `null` when attribute is missing (exit); `evaluateFilterCondition` returns `false` (also exit). Same user-visible behavior, different internal paths, untestable through mocks.

## Proposed Interface

Design B — flexible, with hooks for extensibility:

```typescript
import type { PgDatabase } from "drizzle-orm/pg-core";
import type { SendConfig } from "../db/schema";

type SendHandler = (payload: {
  userId: string;
  enrollmentId: string;
  stepId: string;
  config: SendConfig;  // Zod-validated, never `as`-cast
}) => Promise<void>;

type StepEvent =
  | { kind: "stepped"; stepId: string; type: StepType; result: WalkResult }
  | { kind: "exited"; reason: "filter" | "branch" | "missing_user" }
  | { kind: "completed" }
  | { kind: "waiting"; until: Date };

type WalkObserver = (event: StepEvent) => void;

interface EnrollmentWalkerDeps {
  db: Db;
  onSend: SendHandler;       // required — caller owns the send provider
  observe?: WalkObserver;    // optional — audit, metrics, debugging
}

interface EnrollmentWalker {
  processEnrollment(enrollmentId: string): Promise<void>;
  processReadyEnrollments(): Promise<{ processed: number; failed: number }>;
}

function createEnrollmentWalker(deps: EnrollmentWalkerDeps): EnrollmentWalker;
```

### Usage

```typescript
// Production
const walker = createEnrollmentWalker({
  db: productionDb,
  onSend: ({ userId, config }) => sendgrid.send({ to: userId, ...config }),
});
await walker.processReadyEnrollments();

// Test — PGLite, no mocks, real SQL
const walker = createEnrollmentWalker({
  db: pgliteDb,
  onSend: async () => {},
  observe: (e) => events.push(e),
});
await walker.processEnrollment(enrollmentId);
const logs = await db.select().from(communicationLog)
  .where(eq(communicationLog.enrollmentId, enrollmentId));
expect(logs).toHaveLength(1);
```

### What it hides internally

- All 6 repository queries (become private closures inside the factory)
- `walkStep`, `evaluateBranchCondition`, `evaluateFilterCondition`, `findOutgoingEdge`
- Zod parsing of `step.config` jsonb at read time
- The processing lock (`status: "processing"`) and its rollback on failure
- Step-map construction from flat array

## Dependency Strategy

| Dependency | Category | Injection mechanism |
|---|---|---|
| Postgres / PGLite | Local-substitutable | `db` param to factory |
| Email / SMS / push provider | True external | `onSend: SendHandler` — caller owns the provider |
| Audit / observability | Optional cross-cut | `observe?: WalkObserver` — zero-cost when omitted |

New step types (e.g., `webhook`, `sms`) add a new handler to the deps object. Existing callers break at compile time if the handler is required, which is the correct failure mode.

## Testing Strategy

### New boundary tests to write

Tests use PGLite with the real Drizzle schema. Assert on observable DB state, not mock call patterns:

- **Send step** — after processing, `communicationLog` table has the expected row; `onSend` handler was called with Zod-validated config
- **Branch step** — enrollment ends at the correct terminal status (`completed` vs `exited`) based on user attributes in the DB
- **Filter step** — same as branch but single-path (pass/exit)
- **Wait step** — enrollment row has `processAt` set to the expected future timestamp
- **Exit step** — enrollment status is `exited`
- **Multi-step workflows** — seed a full workflow graph in PGLite, process enrollment, verify final state
- **Config validation** — malformed step config in DB causes a Zod error, not a runtime crash on `undefined.attribute_key`
- **Missing user** — returns early without side effects
- **processReadyEnrollments** — seeds multiple enrollments with different `processAt` timestamps, verifies only ready ones are processed

### Old tests to delete

The entire `enrollment.test.ts` (1000 lines) can be replaced. Every test currently mocks the repository and asserts on mock call patterns — these become redundant when tests assert on real DB state through the boundary.

### Test environment needs

- **PGLite** — in-process Postgres for tests (same Drizzle interface, real SQL execution)
- Drizzle schema migrations applied to PGLite at test setup
- No mocks needed — the factory is the only seam

## Implementation Recommendations

- The deep module should **own**: enrollment state transitions, step-config validation (Zod), workflow graph traversal, communication logging, the processing lock/unlock cycle
- The deep module should **hide**: all SQL queries, pure step-walking functions, condition evaluation logic, edge traversal
- The deep module should **expose**: `createEnrollmentWalker(deps)` returning `{ processEnrollment, processReadyEnrollments }` — nothing else
- **Callers migrate** by replacing `import { processEnrollment } from "services/enrollment"` with `walker.processEnrollment(id)` where `walker` is constructed at app startup
- The `onSend` handler decouples the walker from any specific notification provider — today it can write to `communicationLog` only; tomorrow it wires up SendGrid/Twilio/FCM
- `observe` is synchronous and fire-and-forget — it cannot gate execution. If gating is ever needed, promote it to `async`
- Delete `server/repository/enrollment/enrollment.ts` entirely — its queries become private closures inside the factory
