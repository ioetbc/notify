# Plan: Deepen Workflow Persistence Hooks

## Context

The workflow editor at `apps/client/pages/canvas/` exposes its persistence layer as three shallow hooks in `pages/canvas/hooks.ts`: `useWorkflow`, `useSaveWorkflow`, `usePublishWorkflow`. Each is small but glues together five concerns: HTTP I/O, canvas ⇄ DB transform, validation, navigation side effects, and error UX (`alert()`). The result is a wide, leaky interface — `Canvas` (`canvas.tsx:35`, `canvas.tsx:113-121`, `canvas.tsx:247-251`) has to know about the transform shape, manage a `(name, nodes, edges, status)` `onLoad` callback, and pass `nodes`/`edges` back into `useSaveWorkflow` (which then re-derives the trigger and re-serializes the payload on every render).

Two concrete bugs the current shape allows:
- **Stale closure on save.** `useSaveWorkflow` captures `nodes`/`edges` via parameters; refactors that move work into `mutationFn` will break subtly because the closure tracks the render that mutated, not a stable ref.
- **Lost canvas state on publish.** `publishMutation.mutate` (`canvas.tsx:248`) only invalidates the workflow query; the editor sets `workflowStatus = 'active'` locally in `onSuccess` and ignores the refetched truth.

The goal of this refactor is to replace those three hooks with one **deep** module — `useWorkflowSession` — whose interface is small, captures invariants in types, and lets the canvas component stay focused on editing.

## Recommended Approach

### New module: `pages/canvas/workflow-session.ts`

Single hook exposing one composite state object plus action methods.

```ts
type WorkflowSession = {
  // model
  name: string;
  setName: (name: string) => void;
  nodes: CanvasNode[];
  edges: Edge[];
  status: 'draft' | 'active';
  // lifecycle
  isLoading: boolean;
  isReady: boolean;            // initial load complete (or new workflow)
  // mutations
  save: () => Promise<{ id: string } | { error: string }>;
  publish: () => Promise<{ ok: true } | { error: string }>;
  saveState: 'idle' | 'pending' | 'error';
  publishState: 'idle' | 'pending' | 'error';
  lastError: string | null;
  // editor escape hatches (kept narrow)
  applyEdit: (next: { nodes?: CanvasNode[]; edges?: Edge[] }) => void;
};

export function useWorkflowSession(workflowId: string | undefined): WorkflowSession;
```

What it hides:
- `useQuery` / `useMutation` wiring (TanStack Query stays internal)
- `dbToCanvas` / canvas → DB serialization (today inline in `useSaveWorkflow` lines 96-117)
- Navigation side effect on first save (today inline at `hooks.ts:147-149`)
- Cache invalidation and re-derivation of `status` from server response after publish
- The `(name, nodes, edges, status)` onLoad callback — replaced by reading the model directly
- `alert()` calls — replaced by `lastError` so callers can render a toast

What stays in `Canvas`:
- ReactFlow state (`useNodesState` / `useEdgesState`) — the live editing buffer
- Undo/redo stack — orthogonal concern, separate deepening candidate
- The `applyEdit` bridge: live edits go ReactFlow → `applyEdit(session)`; loaded state flows session → canvas via an effect

Two viable wirings — pick one when implementing:
1. **Session owns model, canvas mirrors it for ReactFlow.** Cleanest. Session is the source of truth; canvas mirrors `session.nodes/edges` into `useNodesState` via effect. Save reads from session, not canvas state. Live edits go ReactFlow → `applyEdit`.
2. **Canvas owns live state, session is a thin facade.** Smallest diff. `save()` accepts current `nodes/edges`. Loses the stale-closure win.

**Recommendation: option (1).** Option (2) is just a rename, not a deepening.

### Codec extraction (subordinate change, same PR)

Pull the two transforms into a small module so the session can compose them:

- `pages/canvas/codec.ts`
  - `dbToCanvas(...)` — moved verbatim from `utils.ts`
  - `canvasToDb(name, nodes, edges)` → `{ name, trigger_type, trigger_event, steps, edges }` — extracted from `useSaveWorkflow` lines 88-117

This is what makes the session interface narrow. The codec is pure (in-process), trivially unit-testable, and removes the need for the session to know about `CanvasStep`, trigger-node id-fishing, or `sourceHandle === 'yes'` mappings.

### Files to modify

- `apps/client/pages/canvas/hooks.ts` — delete `useWorkflow`, `useSaveWorkflow`, `usePublishWorkflow`. Keep `useUserColumns`, `useEventNames` (orthogonal).
- `apps/client/pages/canvas/utils.ts` — remove `dbToCanvas`, leaving factories / layout helpers.
- `apps/client/pages/canvas/codec.ts` — **new**: `dbToCanvas`, `canvasToDb`.
- `apps/client/pages/canvas/workflow-session.ts` — **new**: `useWorkflowSession`.
- `apps/client/pages/canvas/canvas.tsx` — replace the three hook calls + `onLoad` callback + manual mutation wiring at `canvas.tsx:113-121` and `canvas.tsx:244-269` with one `useWorkflowSession(workflowId)` call. Render save/publish errors from `session.lastError` instead of `alert()`.

### Dependency category

**Local-substitutable.** The remote dependency is your own Hono API via `lib/api.ts`. The codec is pure (in-process). Tests run by mocking the `client.workflows[':id']` calls; injecting a port is a possible follow-up, not required for this refactor.

### Reuse / existing utilities

- `match` (`ts-pattern`) — already in `hooks.ts:97`; reuse in `canvasToDb`.
- `dbToCanvas` (`utils.ts`) — moved as-is.
- `client`, `queryClient` (`lib/api.ts`) — used internally by the session.
- `CanvasStep`, `TriggerType`, `TriggerEvent` types — re-exported via codec.

## Verification

1. `cd apps/client && bun run dev` and exercise:
   - Open `/workflow/new`, drop a few steps, click Save → URL replaces with `/workflow/:id`, no `alert()` on success, refresh shows the saved graph.
   - Edit existing workflow, save → no redirect, graph round-trips identically.
   - Click status → Active on a saved workflow → status reflects server response, persists across refresh.
   - Force a save error (e.g. break the API URL) → inline error renders; no `alert()`.
2. Add `apps/client/pages/canvas/codec.test.ts` covering `dbToCanvas(canvasToDb(x)) ≈ x` for: trigger-only, linear, branch with yes/no edges. Run via `sst shell -- bun test`.
3. Type check: `bun run typecheck` (or equivalent) — the narrowed `useWorkflowSession` signature should remove several casts in `canvas.tsx`.

## Out of scope

- Undo/redo refactor (separate deepening candidate).
- Step-kind registry consolidation (separate candidate).
- Replacing TanStack Query with a port — possible later, not required here.
