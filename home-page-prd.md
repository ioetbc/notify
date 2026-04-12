# Home Page PRD

## Overview

The Home page is the primary portal customers see when they load the application. It provides a high-level overview of all campaigns, transactional notifications, and templates in a Notion-style accordion interface. This is the navigation hub from which users access the Journey Canvas to build or edit workflows.

---

## Goals

1. Give users immediate visibility into all their notification workflows at a glance
2. Surface key metrics (sends, opens) without requiring users to drill into each item
3. Provide fast access to create new campaigns, transactional notifications, or start from templates
4. Match the design quality of Notion/Linear — clean, minimal, elegant

---

## User Stories

1. **As a marketer**, I want to see all my campaigns and their performance metrics so I can quickly identify which need attention
2. **As a product manager**, I want to see my transactional notifications in one place so I can manage password resets, order confirmations, etc.
3. **As a new user**, I want to start from a template so I don't have to build from scratch
4. **As a power user**, I want to quickly create a new workflow without navigating through multiple screens

---

## Page Structure

### Layout

```
┌─────────────────────────────────────────────────────────────────┐
│ Sidebar (240px)  │  Main Content Area                          │
│                  │                                              │
│ ┌─────────────┐  │  ┌─────────────────────────────────────────┐│
│ │ Logo        │  │  │ Home                        [New Button]││
│ └─────────────┘  │  └─────────────────────────────────────────┘│
│                  │                                              │
│ Navigation:      │  ┌─────────────────────────────────────────┐│
│ • Home           │  │ Column Headers:                         ││
│ • Templates      │  │ Last sent | Sends | Opens | Status      ││
│ • Campaigns      │  └─────────────────────────────────────────┘│
│ • Transactional  │                                              │
│ • Audience       │  ┌─────────────────────────────────────────┐│
│ • Settings       │  │ ▼ Campaigns (3)                         ││
│                  │  │   📧 Welcome Series      2d ago  1.2k ...││
│                  │  │   📣 Product Launch      1 week  890  ...││
│                  │  └─────────────────────────────────────────┘│
│                  │                                              │
│                  │  ┌─────────────────────────────────────────┐│
│                  │  │ ▼ Transactional (2)                     ││
│                  │  │   🔑 Password Reset      March 31  45  ...││
│                  │  └─────────────────────────────────────────┘│
│                  │                                              │
│                  │  ┌─────────────────────────────────────────┐│
│                  │  │ ▼ Campaign Templates (4)                ││
│                  │  │   ✏️ Blank campaign - Start from scratch ││
│                  │  └─────────────────────────────────────────┘│
│                  │                                              │
│                  │  ┌─────────────────────────────────────────┐│
│                  │  │ ▼ Transactional Templates (3)           ││
│                  │  │   🔐 Password reset - Send users a link ││
│                  │  └─────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

---

## Components

### 1. Sidebar

**Width:** 240px fixed

**Contents:**
- Logo/App name at top
- Navigation items with icons:
  - Home (active state highlighted)
  - Templates
  - Campaigns
  - Transactional
  - Audience
  - Settings

**Behavior:**
- Current page is highlighted
- Click navigates to respective page
- Sidebar is always visible (no collapse for v1)

---

### 2. Page Header

**Contents:**
- Page title: "Home"
- Global "New" button (blue, primary style, top-right)

**New Button Behavior:**
- Opens a centered modal with title "Choose a starting point"
- Modal contains 3 cards in a horizontal row:

| Card | Title | Subtitle | Description |
|------|-------|----------|-------------|
| 1 | Campaign | Sent once manually | Updates, announcements, surveys, and promotions |
| 2 | Loop | Triggered by an event | Onboarding, retention, reengagement, and churn |
| 3 | Transactional | Sent once automatically | Password reset, receipts, and order confirmation |

- Each card has a "+" icon centered above the title
- Clicking a card navigates to `/campaigns/new`, `/loops/new`, or `/transactional/new`
- Modal has an X close button in top-right corner

---

### 3. Column Headers

**Columns (for Campaigns and Transactional sections):**

| Column | Width | Alignment | Description |
|--------|-------|-----------|-------------|
| Name | flex (takes remaining space) | left | Emoji + item name |
| Last sent | 100px | left | Relative timestamp |
| Sends | 80px | right | Absolute count |
| Opens | 80px | right | Absolute count |
| Status | 80px | right | Plain text |

**Note:** Template sections do NOT show these column headers — they only show name + description.

---

### 4. Accordion Sections

**Sections (in order):**
1. Campaigns
2. Transactional
3. Campaign Templates
4. Transactional Templates

**Section Header:**
- Chevron icon (▼ expanded, ▶ collapsed)
- Section name in bold
- Count badge showing number of items (e.g., "Campaigns 3")

**Behavior:**
- Click header to expand/collapse
- All sections expanded by default
- Expansion state persists in localStorage

---

### 5. Row Items

#### Campaign / Transactional Rows

| Element | Description |
|---------|-------------|
| Emoji | Contextual emoji for the item type |
| Name | Item name, bold, primary text color |
| Last sent | Relative time (see formatting rules below) |
| Sends | Absolute number |
| Opens | Absolute number |
| Status | Plain text: Draft, Active, Paused, or Archived |

**Click behavior:** Navigate to `/campaigns/:id` or `/transactional/:id`

#### Template Rows

| Element | Description |
|---------|-------------|
| Emoji | Contextual emoji for the template |
| Name | Template name, bold |
| Description | Brief description, secondary text color |

**Click behavior:** Navigate to `/campaigns/new?template=:id` or `/transactional/new?template=:id`

---

### 6. Empty States

When a section has zero items:

**Campaigns / Transactional:**
```
No campaigns yet
Create your first one →
```
The "Create your first one →" is a clickable link that opens the New modal.

**Templates:**
Templates should always have items (system-provided), so no empty state needed.

---

## Data Model

### Campaign

```typescript
interface Campaign {
  id: string;
  name: string;
  emoji: string;
  status: 'draft' | 'active' | 'paused' | 'archived';
  lastSentAt: Date | null;
  sends: number;
  opens: number;
  createdAt: Date;
  updatedAt: Date;
}
```

### Transactional

```typescript
interface Transactional {
  id: string;
  name: string;
  emoji: string;
  status: 'draft' | 'active' | 'paused' | 'archived';
  lastSentAt: Date | null;
  sends: number;
  opens: number;
  createdAt: Date;
  updatedAt: Date;
}
```

### Template

```typescript
interface Template {
  id: string;
  name: string;
  emoji: string;
  description: string;
  type: 'campaign' | 'transactional';
}
```

---

## Time Formatting Rules

The "Last sent" column displays relative time with these rules:

| Condition | Display Format | Example |
|-----------|----------------|---------|
| Never sent | `-` | - |
| < 7 days ago | `X days ago` | 2 days ago |
| 7-13 days ago | `1 week` | 1 week |
| 14-20 days ago | `2 weeks` | 2 weeks |
| 21-27 days ago | `3 weeks` | 3 weeks |
| 28+ days, same year | `Month Day` | March 31 |
| Different year | `Month Day, Year` | March 31, 2024 |

---

## Visual Design Specifications

### Colors

| Element | Color | Notes |
|---------|-------|-------|
| Background | `#FFFFFF` | Main content area |
| Sidebar background | `#F9FAFB` | Subtle gray |
| Primary text | `#111827` | Near black |
| Secondary text | `#6B7280` | Gray for descriptions, metadata |
| Border/dividers | `#E5E7EB` | Light gray |
| New button | `#2563EB` | Blue primary |
| New button hover | `#1D4ED8` | Darker blue |
| Active nav item | `#EFF6FF` | Light blue background |

### Typography

| Element | Font Weight | Size | Color |
|---------|-------------|------|-------|
| Page title | 600 (semibold) | 24px | Primary |
| Section header | 600 (semibold) | 14px | Primary |
| Count badge | 400 (normal) | 14px | Secondary |
| Row name | 500 (medium) | 14px | Primary |
| Row metadata | 400 (normal) | 14px | Secondary |
| Template description | 400 (normal) | 14px | Secondary |

### Spacing

| Element | Value |
|---------|-------|
| Sidebar width | 240px |
| Content padding | 24px |
| Section gap | 8px |
| Row height | 44px |
| Row horizontal padding | 12px |

### Interactions

| Interaction | Behavior |
|-------------|----------|
| Row hover | Background changes to `#F9FAFB` |
| Row click | Navigate to detail route |
| Section header click | Toggle expand/collapse |
| Modal backdrop click | Close modal |
| Escape key | Close modal |

---

## Routing

| Route | Description |
|-------|-------------|
| `/` | Home page (this PRD) |
| `/campaigns/:id` | Campaign canvas editor |
| `/campaigns/new` | New campaign canvas |
| `/campaigns/new?template=:id` | New campaign from template |
| `/transactional/:id` | Transactional canvas editor |
| `/transactional/new` | New transactional canvas |
| `/transactional/new?template=:id` | New transactional from template |
| `/loops/:id` | Loop canvas editor |
| `/loops/new` | New loop canvas |

---

## Mock Data

For development, use this mock data structure:

```json
{
  "campaigns": [
    {
      "id": "camp_1",
      "name": "Welcome Series",
      "emoji": "👋",
      "status": "active",
      "lastSentAt": "2024-03-29T10:00:00Z",
      "sends": 1234,
      "opens": 567
    },
    {
      "id": "camp_2",
      "name": "Product Launch Announcement",
      "emoji": "🚀",
      "status": "draft",
      "lastSentAt": null,
      "sends": 0,
      "opens": 0
    },
    {
      "id": "camp_3",
      "name": "Summer Sale Promotion",
      "emoji": "☀️",
      "status": "paused",
      "lastSentAt": "2024-03-15T14:30:00Z",
      "sends": 8901,
      "opens": 2345
    }
  ],
  "transactional": [
    {
      "id": "trans_1",
      "name": "Password Reset",
      "emoji": "🔑",
      "status": "active",
      "lastSentAt": "2024-03-31T09:15:00Z",
      "sends": 456,
      "opens": 234
    },
    {
      "id": "trans_2",
      "name": "Order Confirmation",
      "emoji": "📦",
      "status": "active",
      "lastSentAt": "2024-03-30T16:45:00Z",
      "sends": 2341,
      "opens": 1890
    }
  ],
  "campaignTemplates": [
    {
      "id": "ct_1",
      "name": "Blank campaign",
      "emoji": "✏️",
      "description": "Create a new campaign from scratch",
      "type": "campaign"
    },
    {
      "id": "ct_2",
      "name": "New feature announcement",
      "emoji": "📣",
      "description": "Announce a new key feature to your users",
      "type": "campaign"
    },
    {
      "id": "ct_3",
      "name": "Product update",
      "emoji": "📦",
      "description": "Announce your latest product update",
      "type": "campaign"
    },
    {
      "id": "ct_4",
      "name": "Survey request",
      "emoji": "📋",
      "description": "Ask users for feedback with a survey",
      "type": "campaign"
    }
  ],
  "transactionalTemplates": [
    {
      "id": "tt_1",
      "name": "Blank transactional",
      "emoji": "✏️",
      "description": "Start from scratch",
      "type": "transactional"
    },
    {
      "id": "tt_2",
      "name": "Password reset",
      "emoji": "🔐",
      "description": "Send users a link to reset their password",
      "type": "transactional"
    },
    {
      "id": "tt_3",
      "name": "Account verification",
      "emoji": "✅",
      "description": "Verify a user's email address",
      "type": "transactional"
    }
  ]
}
```

---

## Technical Requirements

### Dependencies

- React 19
- TypeScript
- Tailwind CSS
- React Router (for navigation)

### File Structure

```
src/
├── react-app/
│   ├── components/
│   │   ├── Sidebar.tsx
│   │   ├── AccordionSection.tsx
│   │   ├── CampaignRow.tsx
│   │   ├── TransactionalRow.tsx
│   │   ├── TemplateRow.tsx
│   │   ├── NewModal.tsx
│   │   └── EmptyState.tsx
│   ├── pages/
│   │   └── Home.tsx
│   ├── data/
│   │   └── mockData.json
│   ├── utils/
│   │   └── formatTime.ts
│   ├── types/
│   │   └── index.ts
│   ├── App.tsx
│   └── main.tsx
```

### State Management

- Local component state for accordion expand/collapse
- localStorage for persisting accordion state
- Props drilling for v1 (no global state needed yet)

### Performance

- No virtualization needed (expecting < 100 items total)
- Lazy load templates section if needed

---

## Out of Scope for v1

- Search/filter functionality
- Sorting by columns
- Bulk actions (select multiple, archive all)
- Drag-and-drop reordering
- Pagination (assume manageable number of items)
- Real-time updates
- Keyboard navigation between rows

---

## Success Criteria

The Home page is complete when a user can:

1. See all their campaigns with metrics at a glance
2. See all their transactional notifications with metrics
3. Expand/collapse sections and have that state persist
4. Click the "New" button and select from Campaign, Loop, or Transactional
5. Click a campaign row and navigate to `/campaigns/:id`
6. Click a transactional row and navigate to `/transactional/:id`
7. Click a template and navigate to create a new item from that template
8. See appropriate empty states when sections have no items
9. Experience a polished, Notion-quality interface

---

## Open Questions

1. Should the sidebar collapse on smaller screens, or is 1024px+ the minimum supported width?
2. Do we need a "Recently viewed" section at the top for quick access?
3. Should clicking a paused/archived item show a banner prompting to reactivate?
4. Do templates need a "preview" before using them?
