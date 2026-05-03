# Chunk D — Client UI

The settings page where the customer pastes their PostHog key, chooses which PostHog events Notify should listen to, and disconnects.

## Depends on

- The HTTP **contracts** from [Chunk B](./connect-flow-api.md) — but not its implementation. While Chunk B is in flight, mock the responses against the documented contract; swap to the real API once it's deployed.
- Does not depend on Chunk 0, A, or C directly.

## Owns these files

This repo's client lives at `apps/client/` (no `src/`). Adapted paths:

- `apps/client/components/integrations/integrations.tsx` — settings page component
- `apps/client/components/integrations/connect-form.tsx`
- `apps/client/components/integrations/event-picker.tsx`
- `apps/client/components/integrations/connected-state.tsx`
- `apps/client/components/integrations/index.ts` — component barrel
- `apps/client/pages/integrations/index.ts` — route barrel
- `apps/client/lib/api/integrations.ts` — typed wrapper around the `/api/integrations/posthog/*` routes
- Routing entry in `apps/client/App.tsx` and a navigation link from `apps/client/pages/home/home.tsx` — these are the "Integrations" entry-point edits.

## Does NOT touch

- The canvas, workflow editor, or any unrelated page.
- Any backend file.
- The shared design-system components beyond consumption.

## Pages and states

### `IntegrationsPage` (top-level)

State machine, modeled with `ts-pattern`:

- `loading` — initial fetch of "do I have an integration?"
- `disconnected` — show `<ConnectForm />`
- `connecting` — form submitted, waiting on `POST /connect`
- `connected` — show `<ConnectedState />` with disconnect button and re-trigger event picker
- `error` — typed errors from the API (auth_failed, transient, unknown)

### `ConnectForm`

Two inputs (`personal_api_key`, `project_id`) and a submit button. Includes a help link ("how to create a personal API key in PostHog") that points to docs (placeholder URL ok in v1, mark as TODO).

On submit, call `POST /api/integrations/posthog/connect`. On success, transition to `connected` and immediately fetch events. On `posthog_auth_failed`, show inline error under the API key field; do not clear the field (let the customer fix the typo).

### `EventPicker`

Renders the result of `GET /events`. Each event row:

- Event name (monospace)
- 30-day volume (right-aligned)
- Checkbox

Sort by volume descending. Top 10 are visible by default; the rest are behind a "Show more" expander. A "Show all events (including autocaptured)" toggle re-fetches with `?include_autocaptured=true`.

A primary button at the bottom: **"Save N events"** (count updates with checkbox state). Clicking it calls `POST /api/integrations/posthog/events/selection`, persists the active event definitions, and reconciles the PostHog hog function filters.

### `ConnectedState`

Shows:
- Project ID (read-only)
- "Last connected" relative timestamp
- Disconnect button (with confirmation modal — destructive action)
- "Manage events" button that re-opens `<EventPicker />`

Disconnect calls `DELETE /` and transitions back to `disconnected`.

## Empty / edge states

- Fewer than 5 custom events in the last 30 days → show a "no events yet — make sure you've sent events to PostHog" message above the picker, plus the "Show all events" toggle pre-enabled.
- `GET /events` returns 502 (`posthog_auth_failed`) → inline error with a "Reconnect" CTA that drops back to `<ConnectForm />`.
- Network error on either endpoint → toast and stay on the current state.

## Styling

Match the existing design system in `apps/client/src/components/`. No new design primitives. If a component doesn't exist (e.g. a checkbox list), reuse what the canvas already uses for similar UI rather than inventing a new pattern.

## Tests

Component tests with Vitest + Testing Library. Cover:

- `ConnectForm` calls the API on submit and surfaces auth errors inline.
- `EventPicker` renders the volume-sorted list and updates the button count when checkboxes toggle.
- `ConnectedState` disconnect flow shows the modal, calls `DELETE /`, and returns to disconnected.

> **v1 note:** the client app does not yet have Vitest or `@testing-library/react` installed (see root `package.json`). Component tests are deferred until the test rig is set up — tracked as TODO in this chunk's PR. Manual smoke-test against the mocked API is the v1 verification.

## API client / mocking

While Chunk B is in flight, the typed wrapper at `lib/api/integrations.ts` honours an opt-in mock: when `VITE_INTEGRATIONS_MOCK=true` (or no API host is configured), it resolves against an in-memory implementation that matches the documented contract. This lets the UI ship and be exercised end-to-end before the backend deploys. Flip the env var off to hit the real routes once they exist.

## Acceptance

- Page is reachable from the main app navigation.
- All three flows (connect, view events, disconnect) work end-to-end against the real Chunk B API once it's deployed.
- `bun tsc --noEmit` passes.
- No changes to files outside the "Owns" list, beyond the single navigation entry addition.
