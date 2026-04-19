# Homepage Implementation Plan

## Overview
Build a Notion/Loops-style homepage for a push notification business with sidebar navigation, accordion sections, and campaign/transactional management.

## Current State
- React 19 + Vite 6 + SST (AWS)
- No Tailwind CSS (needs v4 install)
- No React Router (needs install)
- Template app only - complete rebuild needed

---

## Implementation Steps

### Phase 1: Setup Dependencies & Configuration

**1.1 Install dependencies**
```bash
bun install react-router-dom tailwindcss @tailwindcss/vite
```

**1.2 Configure Tailwind v4**
- Update `vite.config.ts` to add Tailwind plugin
- Create `src/react-app/index.css` with Tailwind import
- Add custom colors from PRD (primary blue #2563EB, sidebar gray #F9FAFB, etc.)

**1.3 Update index.html**
- Change title to "Notify"

---

### Phase 2: Types & Data

**2.1 Create types** - `src/react-app/types/index.ts`
```typescript
interface Campaign { id, name, emoji, status, lastSentAt, sends, opens, ... }
interface Transactional { id, name, emoji, status, lastSentAt, sends, opens, ... }
interface Template { id, name, emoji, description, type }
```

**2.2 Create mock data** - `src/react-app/data/mockData.ts`
- Campaigns, Transactional, Campaign Templates, Transactional Templates
- Use data from PRD lines 325-430

**2.3 Create time formatter** - `src/react-app/utils/formatTime.ts`
- Implement relative time rules from PRD (< 7 days = "X days ago", etc.)

---

### Phase 3: Core Components

**3.1 Sidebar** - `src/react-app/components/Sidebar.tsx`
- 240px fixed width
- Logo/app name at top
- Navigation: Home, Templates, Campaigns, Transactional, Audience, Settings
- Active state highlighting
- Match Loops screenshot style (icons + labels)

**3.2 AccordionSection** - `src/react-app/components/AccordionSection.tsx`
- Chevron icon (rotates on expand/collapse)
- Section title + count badge
- localStorage persistence for expand state
- Children slot for rows

**3.3 CampaignRow** - `src/react-app/components/CampaignRow.tsx`
- Emoji + Name | Last sent | Sends | Opens | Status
- Hover state (#F9FAFB background)
- Click navigates to /campaigns/:id

**3.4 TransactionalRow** - `src/react-app/components/TransactionalRow.tsx`
- Same structure as CampaignRow
- Click navigates to /transactional/:id

**3.5 TemplateRow** - `src/react-app/components/TemplateRow.tsx`
- Emoji + Name + Description (no metrics columns)
- Click navigates to /campaigns/new?template=:id or /transactional/new?template=:id

**3.6 NewModal** - `src/react-app/components/NewModal.tsx`
- Centered modal with backdrop
- Title: "Choose a starting point"
- 3 cards: Campaign, Loop, Transactional
- Close on backdrop click or Escape key

**3.7 EmptyState** - `src/react-app/components/EmptyState.tsx`
- "No campaigns yet" message
- "Create your first one →" link

---

### Phase 4: Pages & Layout

**4.1 Layout** - `src/react-app/components/Layout.tsx`
- Sidebar + main content area with React Router Outlet
- Flex layout

**4.2 Home page** - `src/react-app/pages/Home.tsx`
- Page header with "Home" title + "New" button
- Column headers row (Last sent | Sends | Opens | Status)
- 4 AccordionSections: Campaigns, Transactional, Campaign Templates, Transactional Templates
- Wire up NewModal

**4.3 Placeholder pages** (minimal, for routing)
- `src/react-app/pages/CampaignDetail.tsx` - "Campaign: {id}"
- `src/react-app/pages/TransactionalDetail.tsx` - "Transactional: {id}"
- `src/react-app/pages/NewCampaign.tsx` - "New Campaign"
- `src/react-app/pages/NewTransactional.tsx` - "New Transactional"
- `src/react-app/pages/NewLoop.tsx` - "New Loop"

---

### Phase 5: Routing & App Setup

**5.1 Update App.tsx**
- Set up React Router with BrowserRouter
- Define routes:
  - `/` → Home
  - `/campaigns/:id` → CampaignDetail
  - `/campaigns/new` → NewCampaign
  - `/transactional/:id` → TransactionalDetail
  - `/transactional/new` → NewTransactional
  - `/loops/new` → NewLoop
- Wrap with Layout component

**5.2 Update main.tsx**
- Remove old CSS import, add new Tailwind CSS

---

## File Structure (Final)

```
src/react-app/
├── components/
│   ├── Sidebar.tsx
│   ├── Layout.tsx
│   ├── AccordionSection.tsx
│   ├── CampaignRow.tsx
│   ├── TransactionalRow.tsx
│   ├── TemplateRow.tsx
│   ├── NewModal.tsx
│   └── EmptyState.tsx
├── pages/
│   ├── Home.tsx
│   ├── CampaignDetail.tsx
│   ├── TransactionalDetail.tsx
│   ├── NewCampaign.tsx
│   ├── NewTransactional.tsx
│   └── NewLoop.tsx
├── data/
│   └── mockData.ts
├── types/
│   └── index.ts
├── utils/
│   └── formatTime.ts
├── App.tsx (refactored)
├── main.tsx (updated)
└── index.css (Tailwind)
```

---

## Key Design Decisions

1. **Tailwind v4** - Use `@tailwindcss/vite` plugin for zero-config setup
2. **No component library** - Build from scratch to match Loops style exactly
3. **localStorage** - For accordion expand/collapse persistence
4. **Mock data in .ts file** - Easier to type than .json
5. **Placeholder pages** - Minimal stubs for routing, not full implementations

---

## Visual Style Reference (from Loops screenshot)

- Clean white background (#FFFFFF)
- Subtle gray sidebar (#F9FAFB)
- Blue "New" button (#2563EB)
- 14px font size for most text
- Semibold section headers
- Hover states on rows
- Chevron icons for expand/collapse
- Count badges next to section titles
