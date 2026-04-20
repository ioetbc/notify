# Workflow Canvas PRD

## Overview

The workflow canvas is the core product surface where customers visually build notification workflows. It is an infinite canvas where users drag and drop step nodes, connect them, and configure each step to create automated push notification workflows.

This document defines the requirements for the v1 canvas implementation using xyflow (React Flow).

---

## Goals

1. Deliver a canvas that feels as polished as Shopify Flow or Linear — not like a legacy enterprise tool
2. Allow non-technical users (marketers, product managers) to build workflows without developer help
3. Produce a serializable workflow definition that the backend execution engine can process
4. Keep the v1 scope tight — ship a working vertical slice before adding advanced features

---

## Workflow Trigger

The trigger is a **workflow-level property**, not a canvas node. It determines when users are enrolled into the workflow.

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `trigger_event` | enum | Yes | `contact_added`, `contact_updated`, `event_received` |

**UI:**
- Configured in the workflow settings panel (top toolbar or modal)
- Dropdown to select trigger event type
- Visual indicator at the top of the canvas showing the active trigger

---

## Step Types

Steps are the building blocks placed on the canvas. The database uses a `step_type` enum: `wait`, `branch`, `send`.

### 1. Wait Step

Pauses the workflow for a specified duration before continuing to the next step.

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `hours` | number | Yes | Wait duration in hours (stored as integer) |
| `next_step_id` | UUID | No | The step to execute after the wait (null = end workflow) |

**Constraints:**
- Must have exactly one incoming connection
- May have zero or one outgoing connection (can be terminal)
- Minimum wait: 1 hour
- Maximum wait: 720 hours (30 days)

**UI:**
- Number input for hours, with helper conversion (e.g., "48 hours = 2 days")
- Display formatted duration on step face (e.g., "Wait 48h" or "Wait 2 days")

---

### 2. Branch Step (If/Else)

Branches the workflow based on a user property condition.

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `user_column` | string | Yes | The user property to check (e.g., `gender`, `plan`, `phone`) |
| `operator` | enum | Yes | `=`, `!=`, `exists`, `not_exists` |
| `compare_value` | string | Conditional | Required for `=` and `!=` operators |
| `true_step_id` | UUID | No | Step to execute if condition is true |
| `false_step_id` | UUID | No | Step to execute if condition is false |

**Constraints:**
- Must have exactly one incoming connection
- Must have exactly two outgoing connections: one for `true` (YES), one for `false` (NO)

**UI:**
- Dropdown to select user column (populated from user schema: `gender`, `plan`, `phone`, etc.)
- Dropdown for operator selection
- Text input for compare value (hidden when operator is `exists` or `not_exists`)
- Clear visual distinction between YES and NO output handles
- Display condition summary on step face (e.g., "plan = pro" or "phone exists")

---

### 3. Send Step

Delivers a push notification to the user's device.

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `title` | string | Yes | Notification title (max 50 chars) |
| `body` | string | Yes | Notification body (max 150 chars) |
| `next_step_id` | UUID | No | The step to execute after sending (null = end workflow) |

**Constraints:**
- Must have exactly one incoming connection
- May have zero or one outgoing connection (can be a terminal step)

**UI:**
- Text inputs for title and body with character counters
- Preview of how the notification will appear on device
- Display title on step face

---

## Canvas Interactions

### Pan and Zoom

- Pan: Click and drag on empty canvas space, or use two-finger scroll
- Zoom: Scroll wheel, pinch gesture, or zoom controls in toolbar
- Zoom range: 25% to 200%
- Fit to view: Button to auto-fit all steps in viewport

### Step Selection

- Single click: Select step, open configuration panel
- Click empty space: Deselect all
- Delete key: Remove selected step(s) and connected edges

### Adding Steps

- Drag from step palette (sidebar) onto canvas
- Steps snap to a grid (optional, can be toggled)

### Connecting Steps

- Drag from output handle to input handle to create connection
- Visual feedback during drag (ghost edge)
- Connections update the `next_step_id`, `true_step_id`, or `false_step_id` in the database

### Moving Steps

- Drag selected step(s) to reposition
- Multi-select with shift+click or drag selection box

---

## Connection Behavior

- Connections represent the flow direction from one step to the next
- Animated edge style to indicate flow direction
- Branch steps have labeled connections: "Yes" and "No"
- Connections cannot create cycles (workflows are directed acyclic graphs)
- Deleting a step removes all connected edges and nullifies references in other steps

---

## UI Components

### 1. Canvas Area

- Infinite canvas powered by xyflow
- Background: Subtle dot grid pattern
- Minimap in bottom-right corner (collapsible)
- Visual indicator at top showing workflow trigger event

### 2. Step Palette (Left Sidebar)

- Draggable step type cards:
  - Wait (icon + label)
  - Branch (icon + label)
  - Send (icon + label)
- Collapsed state for more canvas space
- Note: No Trigger in palette — trigger is a workflow-level setting

### 3. Configuration Panel (Right Sidebar)

- Opens when a step is selected
- Displays form fields for selected step type
- Save/update happens automatically (or with explicit save button)
- Shows validation errors inline

### 4. Top Toolbar

- Workflow name (editable inline)
- Trigger event selector (dropdown: `contact_added`, `contact_updated`, `event_received`)
- Active toggle (workflow on/off)
- Save button
- Zoom controls (zoom in, zoom out, fit to view)
- Undo/Redo (stretch goal for v1)

### 5. Validation Feedback

- Visual indicators on steps with missing required fields (red border or icon)
- Global validation summary before saving/activating
- Prevent activating invalid workflows

---

## Workflow Serialization Format

The canvas state maps to the database schema. The backend stores workflows across multiple tables:

### Database Tables (for reference)

- `workflow` — workflow metadata and trigger
- `step` — step metadata (id, workflow_id, step_type, step_order)
- `step_wait` — wait step config (hours, next_step_id)
- `step_branch` — branch step config (user_column, operator, compare_value, true_step_id, false_step_id)
- `step_send` — send step config (title, body, next_step_id)

### API Payload Format

When saving/loading, the canvas uses this JSON structure:

```json
{
  "id": "uuid-workflow-123",
  "name": "Onboarding Flow",
  "trigger_event": "contact_added",
  "active": false,
  "steps": [
    {
      "id": "uuid-step-1",
      "step_type": "wait",
      "step_order": 1,
      "position": { "x": 100, "y": 100 },
      "config": {
        "hours": 48,
        "next_step_id": "uuid-step-2"
      }
    },
    {
      "id": "uuid-step-2",
      "step_type": "branch",
      "step_order": 2,
      "position": { "x": 100, "y": 250 },
      "config": {
        "user_column": "plan",
        "operator": "=",
        "compare_value": "pro",
        "true_step_id": "uuid-step-3",
        "false_step_id": "uuid-step-4"
      }
    },
    {
      "id": "uuid-step-3",
      "step_type": "send",
      "step_order": 3,
      "position": { "x": 0, "y": 400 },
      "config": {
        "title": "Welcome to Pro!",
        "body": "Thanks for upgrading. Here's how to get started.",
        "next_step_id": null
      }
    },
    {
      "id": "uuid-step-4",
      "step_type": "send",
      "step_order": 4,
      "position": { "x": 200, "y": 400 },
      "config": {
        "title": "You're missing out",
        "body": "Upgrade to Pro and get 10% off.",
        "next_step_id": null
      }
    }
  ]
}
```

### Canvas ↔ Database Mapping

The canvas derives visual edges from the `next_step_id`, `true_step_id`, and `false_step_id` references:

| Step Type | Output Handle | Database Field |
|-----------|---------------|----------------|
| wait | default | `next_step_id` |
| send | default | `next_step_id` |
| branch | yes | `true_step_id` |
| branch | no | `false_step_id` |

When a user draws a connection in the UI, the canvas updates the appropriate `*_step_id` field. No separate edges table exists — connections are implicit in the step references.

### Position Storage

Step positions (`x`, `y`) are stored for canvas rendering but are not in the core database schema. Options:
1. Add `position_x`, `position_y` columns to `step` table
2. Store positions in a separate `step_position` table
3. Store as JSONB in a `canvas_metadata` column on `workflow`

---

## Validation Rules

Before a workflow can be activated, it must pass these validations:

1. **Trigger event set** — Workflow must have a `trigger_event` selected
2. **At least one step** — Workflow must have at least one step
3. **All steps reachable** — Every step must be reachable from the first step (step_order = 1)
4. **No orphan steps** — No disconnected steps floating on the canvas
5. **No cycles** — The graph must be a DAG (directed acyclic graph)
6. **All required fields populated** — Each step type's required properties must be set
7. **At least one Send step** — A workflow must actually send a notification
8. **Branch steps have both paths defined** — `true_step_id` and `false_step_id` must both point somewhere (or both be null for terminal branches)

---

## Technical Requirements

### Dependencies

- `@xyflow/react` — Core canvas library
- State management: React Context or Zustand for canvas state
- TypeScript for type safety on step data structures

### Performance

- Canvas should handle up to 50 steps without lag
- Lazy render steps outside viewport (xyflow handles this)

### Persistence

- Auto-save draft to localStorage as fallback
- Save to backend API on explicit save action
- Load workflow from backend on canvas mount
- Canvas must reconstruct visual edges from `*_step_id` references on load

### Responsiveness

- Minimum supported width: 1024px
- Canvas is not designed for mobile (tablet minimum)

### Database Alignment

The canvas must work with the existing database schema:
- `step_type` enum: `wait`, `branch`, `send`
- `trigger_event` enum: `contact_added`, `contact_updated`, `event_received`
- `branch_operator` enum: `=`, `!=`, `exists`, `not_exists`
- Navigation via foreign key references, not a separate edges table

---

## Out of Scope for v1

- Undo/redo history (stretch goal)
- Copy/paste steps
- Workflow templates
- Collaborative editing (multiplayer)
- Version history
- A/B test branching
- Analytics steps
- Webhook steps
- Workflow scheduling (start/end dates)
- Deep link support on Send step (deferred)

---

## Milestones

### Milestone 1: Static Canvas

- [ ] xyflow canvas renders with pan/zoom
- [ ] Background grid pattern
- [ ] Three step types render with distinct visual styles (wait, branch, send)
- [ ] Steps can be dragged to reposition

### Milestone 2: Step Palette + Drag to Add

- [ ] Left sidebar with draggable step cards
- [ ] Drag step from palette onto canvas to add
- [ ] Delete step with keyboard or context menu

### Milestone 3: Connections

- [ ] Drag from output handle to input handle to connect
- [ ] Branch step has YES/NO labeled handles
- [ ] Connection validation (prevent invalid connections)
- [ ] Animated edges showing flow direction

### Milestone 4: Configuration Panel

- [ ] Right sidebar opens on step selection
- [ ] Form fields for each step type
- [ ] Validation errors shown inline
- [ ] Step face updates to reflect configuration

### Milestone 5: Serialization + Persistence

- [ ] Export canvas state to JSON schema (with `*_step_id` references)
- [ ] Import/load workflow from JSON
- [ ] Save workflow to backend API
- [ ] Load workflow on canvas mount

### Milestone 6: Polish

- [ ] Minimap
- [ ] Zoom controls in toolbar
- [ ] Fit-to-view button
- [ ] Trigger event selector in toolbar
- [ ] Global validation before activation
- [ ] Empty state when no steps exist

---

## Success Criteria

The canvas is complete when a user can:

1. Open a blank canvas
2. Select a trigger event from the toolbar (contact_added, contact_updated, event_received)
3. Add a Wait step and configure it with hours
4. Add a Branch step and connect it to the Wait
5. Add two Send steps and connect them to the Branch's YES and NO outputs
6. Configure all steps with valid data
7. Save the workflow
8. Reload the page and see the workflow exactly as they left it
9. The exported JSON matches the database schema and can be consumed by the backend execution engine
