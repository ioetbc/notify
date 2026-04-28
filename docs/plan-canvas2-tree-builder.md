# Canvas2: Structured Tree-Based Workflow Builder

## Context

The existing workflow canvas at `apps/client/pages/canvas/` uses `@xyflow/react` to render a free-form, drag-and-drop graph. Users can drop nodes anywhere and link them in any order, which (a) lets them produce invalid workflows, (b) gives no guidance about what step to add next, and (c) is overkill for the actual problem now that the data model is structured.

The new design turns the workflow into a guided, structured tree:

- A new workflow opens with a **Trigger** card and an **Exit** card already connected.
- Steps are added by hovering a connector → "+" appears → click → modal lets the user pick a step type. New steps auto-link into the chain.
- **Branch** steps split into two sub-chains (True / False) and rejoin into the next outer step. Branches can nest. A sub-chain may end in an Exit instead of rejoining.
- The **Trigger card is edited inline** (not via a side drawer).
- All other steps open a config drawer when clicked.

This page is built as `/canvas2` and `/canvas2/:id` alongside the existing `/workflow` routes. The existing API is reused unchanged — the tree is serialized client-side to the same flat `steps[]` + `edges[]` shape the server already accepts.

## Decisions (confirmed with user)

1. **Branch defaults**: both sub-chains start empty and rejoin directly to the next outer step. No auto-inserted Filter, no auto-Exit. The user adds steps (including Filter, if wanted) by clicking the "+" on either sub-chain's connector. A sub-chain may stay empty (pure passthrough), end in Exit, or contain any sequence of steps.
2. **Branch deletion**: deleting a Branch step removes the entire subtree (both sub-chains and any nested branches).
3. **Exit insertion**: the step picker hides "Exit" if a downstream Exit already exists in the same chain. Cannot create unreachable steps.
4. **Config form reuse**: the Wait / Branch / Send / Filter form components are **duplicated into canvas2**. The existing canvas is not touched.

## Architecture

### Tooling

No `@xyflow/react`, no `dagre`. Layout is plain React + Tailwind, with small inline SVG only for the branch fan-out / fan-in connectors.

### Tree data model — `apps/client/pages/canvas2/types.ts`

```ts
import type {
  WaitConfig, BranchConfig, SendConfig, FilterConfig, ExitConfig,
} from '../../../server/db/schema';

export type TriggerType = 'system' | 'custom';
export interface TriggerData { triggerType: TriggerType; event: string }

export type TreeNode =
  | { id: string; kind: 'wait';   config: WaitConfig }
  | { id: string; kind: 'send';   config: SendConfig }
  | { id: string; kind: 'filter'; config: FilterConfig }
  | { id: string; kind: 'exit';   config: ExitConfig }   // terminates a chain
  | {
      id: string;
      kind: 'branch';
      config: BranchConfig;
      yes: TreeNode[];   // may be empty (passthrough) or start with any step kind
      no:  TreeNode[];   // may be empty (passthrough) or start with any step kind
    };

export interface WorkflowTree {
  name: string;
  trigger: TriggerData;
  root: TreeNode[];           // top-level chain; must end in 'exit' on every terminal path
  status?: 'draft' | 'active' | 'paused' | 'archived';
}

export type ChainPath = { branchId: string; side: 'yes' | 'no' }[];
export interface ConnectorLocation { chainPath: ChainPath; index: number }
```

A sub-chain that ends in `kind === 'exit'` terminates that path (no rejoin edge). Otherwise the sub-chain's tail rejoins into whatever step follows the Branch in the parent chain (or, if the Branch is the parent's last node, into the parent's own enclosing rejoin point — handled naturally by recursion).

### Tree → flat serialization — `serialize.ts`

```text
treeToFlat(tree) -> { steps, edges }

serialize(chain, fallback):       # fallback = id this chain rejoins to, or null
  for i in 0..chain.length-1:
    node      = chain[i]
    successor = chain[i+1]?.id ?? fallback   # what this node links to next

    push step row for node
    switch node.kind:
      wait | send | filter:
        if successor != null: push edge { source: node.id, target: successor }
      exit:
        # terminal — no outgoing edge
      branch:
        yesEntry = serialize(node.yes, successor)   # sub-chains rejoin to OUR successor
        noEntry  = serialize(node.no,  successor)
        if yesEntry: push edge { source: node.id, target: yesEntry, handle: true }
        if noEntry:  push edge { source: node.id, target: noEntry,  handle: false }

  return chain[0]?.id ?? fallback   # entry id of this chain

serialize(tree.root, null)
```

Both sub-chain tails emit a regular (no-handle) edge to the same `successor` — that is the rejoin. A sub-chain ending in Exit emits no rejoin edge from that side.

### Flat → tree deserialization — `deserialize.ts`

```text
flatToTree(workflow, steps, edges):
  byId, outgoing, incoming = build maps
  rootStep = step with no incoming edge from another step

  walkChain(startId, stopAtId):
    chain = []
    cur = startId
    while cur != null and cur != stopAtId:
      step = byId[cur]; outs = outgoing[cur] ?? []
      if step.type == 'branch':
        yesEdge = outs.find handle === true
        noEdge  = outs.find handle === false
        rejoin  = findRejoin(yesEdge.target, noEdge.target, stopAtId)
        chain.push branch node with
          yes: walkChain(yesEdge.target, rejoin)
          no:  walkChain(noEdge.target,  rejoin)
        cur = rejoin
      else if step.type == 'exit':
        chain.push exit; cur = null
      else:
        chain.push leaf; cur = outs[0]?.target ?? null
    return chain

  findRejoin(yesStart, noStart, outerStopId):
    walk forward from yesStart, recording every visited id (skipping past nested
    branches via recursive findRejoin) until exit/null.
    walk forward from noStart the same way; first id seen by both = rejoin.
    if neither converges before exit/null, return null.

  return { name, trigger: {triggerType, event}, root: walkChain(rootStep.id, null), status }
```

The "skip past nested branch" recursion is what makes nested branches deserialize correctly.

### File layout — `apps/client/pages/canvas2/`

| File | Purpose |
| --- | --- |
| `index.ts` | Re-exports `NewCanvas2Page`, `EditCanvas2Page`. |
| `new-canvas2.tsx` | Route component for `/canvas2`. Renders `<Canvas2 />` with a seed tree. |
| `edit-canvas2.tsx` | Route component for `/canvas2/:id`. Reads `:id` from router, renders `<Canvas2 workflowId={id} />`. |
| `canvas2.tsx` | Top-level container: holds `tree` state + `selectedStepId` + `pickerLocation`; renders toolbar, `<TriggerCard>`, `<Chain>`, modal, drawer; wires save/publish. |
| `types.ts` | `TreeNode`, `WorkflowTree`, `ChainPath`, `ConnectorLocation`. Re-exports config types from server schema. |
| `tree.ts` | Pure helpers: `seedTree()`, `findNodeById`, `findPathById`, `updateNodeAtPath`, `insertNodeAtPath`, `removeNodeAtPath`, `chainHasDownstreamExit`. |
| `serialize.ts` | `treeToFlat(tree)`. |
| `deserialize.ts` | `flatToTree(workflow, steps, edges)`. |
| `validation.ts` | `validateTree(tree): string[]`. |
| `hooks.ts` | `useWorkflow2`, `useSave2`, `usePublish2`, `useUserColumns2`, `useEventNames2` (mirror existing canvas hooks; load/save uses `flatToTree` / `treeToFlat`). |
| `chain.tsx` | `<Chain>` — vertical list of `<TreeNode>` interleaved with `<Connector>`. |
| `tree-node.tsx` | `<TreeNode>` — switches on `kind` → `<StepCard>` or `<BranchBlock>`. |
| `step-card.tsx` | Visual card for `wait` / `send` / `filter` / `exit`. Click → select. Hover → trash icon (hidden only for the root chain's required terminal Exit). |
| `branch-block.tsx` | Branch step card + side-by-side True/False columns + SVG fan-out (top) and fan-in (bottom; rendered only if at least one side rejoins). |
| `trigger-card.tsx` | Inline-editable Trigger card (`triggerType` select + event select). Calls `onChange` upward. |
| `connector.tsx` | 32px vertical line + hover-only "+" button. Click → `onInsert(location)`. |
| `step-picker-modal.tsx` | Modal listing `wait`, `branch`, `send`, `filter`, `exit`. Hides `exit` when the target chain already has a downstream exit. |
| `step-config-drawer.tsx` | Right-hand drawer wrapping the four duplicated form components. |
| `config-forms.tsx` | **Duplicated** from `canvas/config-panel.tsx`: `WaitConfigForm`, `BranchConfigForm`, `SendConfigForm`, `FilterConfigForm`. Existing canvas is not touched. |

### Component contracts (key ones)

`<Canvas2>` (`canvas2.tsx`)
- Props: `{ workflowId?: string }`.
- State: `tree: WorkflowTree`, `selectedStepId: string | null`, `pickerLocation: ConnectorLocation | null`.
- Loads via `useWorkflow2(workflowId, setTree)` when `workflowId` set.
- Renders: toolbar (name + Save + Publish), `<TriggerCard trigger={tree.trigger} onChange=...>`, `<Chain chain={tree.root} chainPath={[]} ...>`, `<StepPickerModal>`, `<StepConfigDrawer>`.
- Insert flow: connector → `setPickerLocation(loc)` → modal `onPick(kind)` → call `insertNodeAtPath(tree, loc, newNodeForKind(kind))`. For `kind === 'branch'`, the new branch is constructed with `yes: []` and `no: []` — both sides rejoin directly to the branch's successor and the user fills them in via the sub-chain connectors.
- Delete flow: `removeNodeAtPath(tree, loc)`. If the removed node is a Branch, `removeNodeAtPath` drops the entire subtree. Only the root chain's terminal Exit hides its delete affordance.

`<Connector>`
- Props: `{ location: ConnectorLocation, onInsert: (loc) => void }`.
- Visual: `relative w-px h-8 bg-slate-300 mx-auto group` with a hover-only centered `+` button.

`<StepPickerModal>`
- Props: `{ open: boolean, location: ConnectorLocation | null, onClose: () => void, onPick: (kind) => void, hideExit: boolean }`.
- Caller computes `hideExit = chainHasDownstreamExit(tree, location)` so insert never produces an unreachable step.

`<BranchBlock>`
- Renders `<StepCard>` for the branch step itself, then a `grid grid-cols-2 gap-12` containing two `<Chain>` components (yes / no) with column headers "True" and "False". Each sub-chain may be empty — in that case it renders just a `<Connector>` so the user can insert steps. Two short inline SVGs draw the splitter (always) and merger (only if at least one side does not terminate in exit).

### Layout

- Outer page is centered: `max-w-[640px] mx-auto py-12 px-6` inside the existing `<Layout>` shell from `apps/client/components/layout/layout.tsx`.
- Vertical line between cards is the `<Connector>` element itself — straight CSS, no SVG.
- Branch fan-out / fan-in are tiny inline SVGs (`width=full, height=24`) drawn just above and below the two-column grid. Two diagonal segments per Y.
- Nested branches just nest the same grid recursively. Page allows horizontal scroll for very wide trees.

### State management

- One `useState<WorkflowTree>` in `<Canvas2>`. Immutable updates via the `tree.ts` helpers (structural copy via spread/map — workflows are tiny).
- React Query (`@tanstack/react-query`) only owns server fetch/save/publish. No Immer.
- Drawer reads the live node via `findNodeById(tree, selectedStepId)` each render; writes via `updateNodeAtPath`.

### Step config editing

- Click a `<StepCard>` → `setSelectedStepId(node.id)` → drawer opens.
- Drawer body picks the form component based on `node.kind`:
  - `wait` → `WaitConfigForm`
  - `branch` → `BranchConfigForm`
  - `send` → `SendConfigForm`
  - `filter` → `FilterConfigForm`
  - `exit` → static help text (no form)
- Trigger has no drawer — the Trigger card edits inline.

### Validation rules — `validation.ts`

`validateTree(tree): string[]` returns user-readable errors; Save is disabled when non-empty.

1. `tree.trigger.event` is non-empty.
2. `tree.root` non-empty AND every terminal path ends in `exit`. Walk recursively into branches. An empty sub-chain is treated as a passthrough that inherits the Branch's successor — it terminates correctly iff the surrounding chain does. (For a Branch that is the last node of a chain, both sub-chains must independently end in `exit`; an empty sub-chain in that position is invalid.)
3. No duplicate node ids (defensive — UUIDs).
4. Per-step config sanity (warnings, not blockers): `send` title/body non-empty, `branch` user_column / `filter` attribute_key non-empty, `wait.hours >= 1`.

### Save / load flow

Hooks live in `apps/client/pages/canvas2/hooks.ts` and mirror the existing canvas hooks:

- `useWorkflow2(workflowId, onLoad)`: calls `client.workflows[':id'].$get({ param: { id } })`. On success: `onLoad(flatToTree(workflow, steps, edges))`.
- `useSave2(workflowId)`:
  1. Run `validateTree(tree)`. If errors, abort.
  2. `{ steps, edges } = treeToFlat(tree)`.
  3. POST to `client.workflows.$post(...)` (new) or PUT to `client.workflows[':id'].$put(...)` (existing) with payload:
     ```ts
     {
       name: tree.name,
       trigger_type: tree.trigger.triggerType,
       trigger_event: tree.trigger.event,
       steps,
       edges,
     }
     ```
  4. On create success, navigate to `/canvas2/${data.workflow.id}`.
- `usePublish2(workflowId)`: identical to `usePublishWorkflow` (`apps/client/pages/canvas/hooks.ts:59-76`), reusing the same `['workflow', id]` cache key so create→publish flows share state.

`useUserColumns2` and `useEventNames2` are direct copies of `useUserColumns` / `useEventNames` from `apps/client/pages/canvas/hooks.ts`. Existing canvas is not touched.

Seed tree for `/canvas2`:
```ts
{
  name: 'Untitled Workflow',
  trigger: { triggerType: 'system', event: 'user_created' },
  root: [{ id: uuid(), kind: 'exit', config: {} }],
  status: 'draft',
}
```

### Routing diff — `apps/client/App.tsx`

```diff
 import { NewWorkflowPage, EditWorkflowPage } from './pages/workflow';
+import { NewCanvas2Page, EditCanvas2Page } from './pages/canvas2';
@@
           <Route path="/workflow" element={<NewWorkflowPage />} />
           <Route path="/workflow/:id" element={<EditWorkflowPage />} />
+          <Route path="/canvas2" element={<NewCanvas2Page />} />
+          <Route path="/canvas2/:id" element={<EditCanvas2Page />} />
```

The `<Layout>` wrapper is provided by the parent route element (`apps/client/App.tsx:18`).

## Critical files

**Modified**
- `apps/client/App.tsx` — add the two new routes (4-line diff above).

**New**
- `apps/client/pages/canvas2/index.ts`
- `apps/client/pages/canvas2/new-canvas2.tsx`
- `apps/client/pages/canvas2/edit-canvas2.tsx`
- `apps/client/pages/canvas2/canvas2.tsx`
- `apps/client/pages/canvas2/types.ts`
- `apps/client/pages/canvas2/tree.ts`
- `apps/client/pages/canvas2/serialize.ts`
- `apps/client/pages/canvas2/deserialize.ts`
- `apps/client/pages/canvas2/validation.ts`
- `apps/client/pages/canvas2/hooks.ts`
- `apps/client/pages/canvas2/chain.tsx`
- `apps/client/pages/canvas2/tree-node.tsx`
- `apps/client/pages/canvas2/step-card.tsx`
- `apps/client/pages/canvas2/branch-block.tsx`
- `apps/client/pages/canvas2/trigger-card.tsx`
- `apps/client/pages/canvas2/connector.tsx`
- `apps/client/pages/canvas2/step-picker-modal.tsx`
- `apps/client/pages/canvas2/step-config-drawer.tsx`
- `apps/client/pages/canvas2/config-forms.tsx` (duplicated from existing canvas)

**Read-only references (existing patterns to mirror, do not modify)**
- `apps/client/pages/canvas/canvas.tsx`
- `apps/client/pages/canvas/hooks.ts:33-156` (load/save/publish pattern)
- `apps/client/pages/canvas/config-panel.tsx:60-328` (form components to duplicate)
- `apps/client/pages/canvas/utils.ts:34-77` (default configs, `getNodeId()` UUID helper)
- `apps/server/services/workflow/workflow.ts:1-70` (server contract)
- `apps/server/db/schema.ts:76-119` (config schemas, step/edge tables)

## Backend

**No changes.** The existing API at `POST /workflows`, `PUT /workflows/:id`, `GET /workflows/:id`, `PATCH /workflows/:id/publish` already accepts the flat steps+edges shape `treeToFlat` produces, and `updateWorkflow` (`apps/server/services/workflow/workflow.ts:56-70`) deletes-and-re-inserts on every save which makes save-from-tree trivial.

## Verification

1. **Pure-function unit tests** for the round-trip: `flatToTree(treeToFlat(t)) === t` for representative trees:
   - linear (Trigger → Wait → Send → Exit)
   - one branch with both sides rejoining
   - one branch with one side ending in Exit
   - nested branch (branch-inside-branch on the True path)
   - Run via `sst shell -- bun test`.
2. **Manual end-to-end**:
   - `bun dev` → open `/canvas2`. Confirm Trigger + Exit visible and connected.
   - Hover the connector → "+" appears → click → modal opens (Trigger absent, Exit hidden because Exit already exists downstream).
   - Insert Wait, Send, Filter; click each and edit config in the drawer.
   - Insert a Branch: confirm True/False columns appear empty (just a connector each), both rejoining the next step.
   - Click the "+" inside the True column and add a Filter; confirm it sits on the True path only and the False path stays empty.
   - Insert another Branch inside the True column; confirm rejoin is to the *outer* branch's successor.
   - Replace the rejoin in one sub-chain by inserting an Exit there; confirm the merger SVG now has only one inbound side.
   - Edit Trigger inline: change between system/custom and pick an event.
   - Save → reload → confirm the same tree appears (deserialize round-trip).
   - Publish → confirm status flips to `active`.
3. **Validation**: try to save a tree with a non-exit-terminated path; confirm Save is disabled and the error message points at the offending chain.
4. **Existing `/workflow` route is still untouched and functional.**
