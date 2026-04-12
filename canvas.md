# Journey Canvas PRD

## Overview

The journey canvas is the core product surface where customers visually build notification workflows. It is an infinite canvas where users drag and drop nodes, connect them with edges, and configure each step to create automated push notification journeys.

This document defines the requirements for the v1 canvas implementation using xyflow (React Flow).

---

## Goals

1. Deliver a canvas that feels as polished as Shopify Flow or Linear — not like a legacy enterprise tool
2. Allow non-technical users (marketers, product managers) to build journeys without developer help
3. Produce a serializable journey definition that the backend execution engine can process
4. Keep the v1 scope tight — ship a working vertical slice before adding advanced features

---

## Node Types

### 1. Trigger Node

The entry point for every journey. Listens for a specific event to enroll users.

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `event_name` | string | Yes | The event that triggers this journey (e.g., `user_signed_up`) |

**Constraints:**
- Every journey must have exactly one Trigger node
- Trigger node cannot have incoming edges
- Trigger node must have exactly one outgoing edge

**UI:**
- Dropdown or searchable input to select from known events
- Option to type a custom event name

---

### 2. Wait Node

Pauses the journey for a specified duration before continuing to the next step.

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `duration` | number | Yes | The wait duration value |
| `unit` | enum | Yes | `minutes`, `hours`, `days` |

**Constraints:**
- Must have exactly one incoming edge
- Must have exactly one outgoing edge
- Minimum wait: 1 minute
- Maximum wait: 30 days

**UI:**
- Number input for duration
- Dropdown for unit selection
- Display formatted duration on node face (e.g., "Wait 2 days")

---

### 3. Condition Node (If/Else)

Branches the journey based on whether a condition is met.

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `condition_type` | enum | Yes | `event_occurred`, `user_property` |
| `event_name` | string | Conditional | Required if `condition_type` is `event_occurred` |
| `property_key` | string | Conditional | Required if `condition_type` is `user_property` |
| `operator` | enum | Conditional | `equals`, `not_equals`, `greater_than`, `less_than`, `contains` |
| `property_value` | string | Conditional | The value to compare against |

**Constraints:**
- Must have exactly one incoming edge
- Must have exactly two outgoing edges: one for `true` (YES), one for `false` (NO)

**UI:**
- Dropdown to select condition type
- Dynamic form fields based on condition type
- Clear visual distinction between YES and NO output handles
- Display condition summary on node face (e.g., "Has purchase_completed?")

---

### 4. Send Notification Node

Delivers a push notification to the user's device.

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `title` | string | Yes | Notification title (max 50 chars) |
| `body` | string | Yes | Notification body (max 150 chars) |
| `deep_link` | string | No | Optional URL or deep link path |

**Constraints:**
- Must have exactly one incoming edge
- May have zero or one outgoing edge (can be a terminal node)

**UI:**
- Text inputs for title and body with character counters
- Optional deep link input
- Preview of how the notification will appear on device
- Display title on node face

---

## Canvas Interactions

### Pan and Zoom

- Pan: Click and drag on empty canvas space, or use two-finger scroll
- Zoom: Scroll wheel, pinch gesture, or zoom controls in toolbar
- Zoom range: 25% to 200%
- Fit to view: Button to auto-fit all nodes in viewport

### Node Selection

- Single click: Select node, open configuration panel
- Click empty space: Deselect all
- Delete key: Remove selected node(s) and connected edges

### Adding Nodes

- Drag from node palette (sidebar) onto canvas
- Nodes snap to a grid (optional, can be toggled)

### Connecting Nodes

- Drag from output handle to input handle to create edge
- Visual feedback during drag (ghost edge)
- Invalid connections should be visually rejected (e.g., connecting Trigger input)

### Moving Nodes

- Drag selected node(s) to reposition
- Multi-select with shift+click or drag selection box

---

## Edge Behavior

- Edges represent the flow direction from one node to the next
- Animated edge style to indicate flow direction
- Condition nodes have labeled edges: "Yes" and "No"
- Edges cannot create cycles (journeys are directed acyclic graphs)
- Deleting a node removes all connected edges

---

## UI Components

### 1. Canvas Area

- Infinite canvas powered by xyflow
- Background: Subtle dot grid pattern
- Minimap in bottom-right corner (collapsible)

### 2. Node Palette (Left Sidebar)

- Draggable node type cards:
  - Trigger (icon + label)
  - Wait (icon + label)
  - Condition (icon + label)
  - Send Notification (icon + label)
- Collapsed state for more canvas space

### 3. Configuration Panel (Right Sidebar)

- Opens when a node is selected
- Displays form fields for selected node type
- Save/update happens automatically (or with explicit save button)
- Shows validation errors inline

### 4. Top Toolbar

- Journey name (editable inline)
- Save button
- Zoom controls (zoom in, zoom out, fit to view)
- Undo/Redo (stretch goal for v1)

### 5. Validation Feedback

- Visual indicators on nodes with missing required fields (red border or icon)
- Global validation summary before saving/publishing
- Prevent saving invalid journeys

---

## Journey Serialization Format

The canvas must serialize to and deserialize from this JSON structure:

```json
{
  "id": "journey_123",
  "name": "Onboarding Flow",
  "status": "draft",
  "nodes": [
    {
      "id": "node_1",
      "type": "trigger",
      "position": { "x": 100, "y": 100 },
      "data": {
        "event_name": "user_signed_up"
      }
    },
    {
      "id": "node_2",
      "type": "wait",
      "position": { "x": 100, "y": 250 },
      "data": {
        "duration": 2,
        "unit": "days"
      }
    },
    {
      "id": "node_3",
      "type": "condition",
      "position": { "x": 100, "y": 400 },
      "data": {
        "condition_type": "event_occurred",
        "event_name": "purchase_completed"
      }
    },
    {
      "id": "node_4",
      "type": "send_notification",
      "position": { "x": 0, "y": 550 },
      "data": {
        "title": "Welcome to Pro!",
        "body": "Thanks for upgrading. Here's how to get started.",
        "deep_link": "/onboarding"
      }
    },
    {
      "id": "node_5",
      "type": "send_notification",
      "position": { "x": 200, "y": 550 },
      "data": {
        "title": "You're missing out",
        "body": "Complete your purchase and get 10% off.",
        "deep_link": "/pricing"
      }
    }
  ],
  "edges": [
    {
      "id": "edge_1",
      "source": "node_1",
      "target": "node_2"
    },
    {
      "id": "edge_2",
      "source": "node_2",
      "target": "node_3"
    },
    {
      "id": "edge_3",
      "source": "node_3",
      "sourceHandle": "yes",
      "target": "node_4"
    },
    {
      "id": "edge_4",
      "source": "node_3",
      "sourceHandle": "no",
      "target": "node_5"
    }
  ]
}
```

---

## Validation Rules

Before a journey can be published (made active), it must pass these validations:

1. **Exactly one Trigger node** — No more, no less
2. **Trigger has no incoming edges** — It is the entry point
3. **All nodes are connected** — No orphan nodes
4. **No cycles** — The graph must be a DAG
5. **All required fields populated** — Each node type's required properties must be set
6. **At least one Send Notification node** — A journey must actually send something
7. **Condition nodes have both branches connected** — YES and NO paths must lead somewhere

---

## Technical Requirements

### Dependencies

- `@xyflow/react` — Core canvas library
- State management: React Context or Zustand for canvas state
- TypeScript for type safety on node data structures

### Performance

- Canvas should handle up to 50 nodes without lag
- Lazy render nodes outside viewport (xyflow handles this)

### Persistence

- Auto-save draft to localStorage as fallback
- Save to backend API on explicit save action
- Load journey from backend on canvas mount

### Responsiveness

- Minimum supported width: 1024px
- Canvas is not designed for mobile (tablet minimum)

---

## Out of Scope for v1

- Undo/redo history (stretch goal)
- Copy/paste nodes
- Journey templates
- Collaborative editing (multiplayer)
- Version history
- A/B test branching
- Analytics nodes
- Webhook nodes
- Journey scheduling (start/end dates)

---

## Milestones

### Milestone 1: Static Canvas

- [ ] xyflow canvas renders with pan/zoom
- [ ] Background grid pattern
- [ ] Four node types render with distinct visual styles
- [ ] Nodes can be dragged to reposition

### Milestone 2: Node Palette + Drag to Add

- [ ] Left sidebar with draggable node cards
- [ ] Drag node from palette onto canvas to add
- [ ] Delete node with keyboard or context menu

### Milestone 3: Edge Connections

- [ ] Drag from output handle to input handle to connect
- [ ] Condition node has YES/NO labeled handles
- [ ] Edge validation (prevent invalid connections)
- [ ] Animated edges showing flow direction

### Milestone 4: Configuration Panel

- [ ] Right sidebar opens on node selection
- [ ] Form fields for each node type
- [ ] Validation errors shown inline
- [ ] Node face updates to reflect configuration

### Milestone 5: Serialization + Persistence

- [ ] Export canvas state to JSON schema
- [ ] Import/load journey from JSON
- [ ] Save journey to backend API
- [ ] Load journey on canvas mount

### Milestone 6: Polish

- [ ] Minimap
- [ ] Zoom controls in toolbar
- [ ] Fit-to-view button
- [ ] Global validation before publish
- [ ] Empty state when no nodes exist

---

## Success Criteria

The canvas is complete when a user can:

1. Open a blank canvas
2. Drag a Trigger node onto the canvas and configure it with an event name
3. Add a Wait node and connect it to the Trigger
4. Add a Condition node and connect it to the Wait
5. Add two Send Notification nodes and connect them to the Condition's YES and NO branches
6. Configure all nodes with valid data
7. Save the journey
8. Reload the page and see the journey exactly as they left it
9. The exported JSON matches the defined schema and can be consumed by the backend execution engine
