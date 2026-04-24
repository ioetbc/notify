# Exit Node (Implemented)

## Problem

When a workflow branches, the "no" path sometimes has no action — the user just shouldn't receive anything. Today the only option is to leave that branch dangling with no connected step. This looks unfinished on the canvas and relies on the walker implicitly completing the enrollment when it runs out of edges, which makes it indistinguishable from a user who actually finished the full workflow.

## Solution

Add an `exit` step type. It's a terminal node that explicitly ends a branch early. When the walker hits it, the enrollment is marked `exited` — distinct from `completed`, which means the user reached the natural end and received all their notifications.

## Schema changes

- Add `exit` to `stepTypeEnum` in `server/db/schema.ts`
- Add `ExitConfig` type — empty object `{}`
- DB migration to add the new enum value

## Walker changes

`server/services/enrollment/enrollment.ts`

Add `exit` to the `walkStep` exhaustive match. When hit, return `{ action: "exit" }`. No config to read, no edges to follow.

## Canvas UI changes

`client/pages/canvas/`

- Add `ExitNode` component — minimal node with a label like "Exit workflow". No config panel needed.
- Add `exit` to the node type palette so users can drag it onto the canvas
- No outgoing handle — this is always a terminal node
- One incoming handle

## What this does NOT change

- The `exited` enrollment status is reused — no new status needed
- Failed filter/branch conditions still produce `exited` the same way
- No distinction yet between "exited via exit node" vs "exited via failed condition" — if we need that later, add an `exit_reason` column to `workflow_enrollment`
