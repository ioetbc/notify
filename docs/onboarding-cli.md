# Notify Onboarding CLI — Design

Status: Draft
Author: wcole
Date: 2026-05-02

## Context

Per `north-star.md`, integration today requires customer devs to wire up Expo push token registration, call `POST /users/register`, and fire events to `POST /events`. The PostHog integration (`rfc-posthog-integration.md`) collapses event firing into PostHog's existing instrumentation, but still leaves the customer to (a) connect their PostHog project from the dashboard and (b) hand-wire identity so `distinct_id` aligns with Notify's `user_id`.

The CLI's job is to be a single guided command that handles the PostHog connection end-to-end: provisioning the hog function on the customer's behalf, picking trigger events from their actual PostHog event definitions, and printing the exact app-side snippets the developer needs to paste in.

The CLI shares its backend endpoints with the dashboard's Settings → Integrations → PostHog flow. One source of truth on the server, two UIs (CLI + dashboard) on top.

## Goal

A single command that takes a developer from "I have an Expo app and a PostHog account" to "Notify is connected, my PostHog events are forwarding, my draft workflows exist, and I have the exact snippets to paste into my app."

## Command

`npx notify connect posthog` (also `bunx` / `pnpm dlx` equivalents).

The verb-noun shape leaves room for `connect mixpanel`, `connect segment`, etc. later. We deliberately avoid `notify init` because the CLI is no longer a generic setup tool — it's a provider connector.

## Scope decisions (v1)

- **PostHog-only.** Customers without PostHog use the events API fallback documented elsewhere; they don't run this CLI.
- **No codegen.** The CLI does not write or patch any files in the customer's project. Output is a printed checklist of snippets to paste.
- **PostHog cloud only** (US or EU). Self-hosted is v2.
- **Expo only.** Bare React Native is out of scope; the push-token flow assumes `expo-notifications`.
- **Paste-based auth** for the Notify API key. Device-code login is v1.5.
- **No verify step** in v1. A future `npx notify doctor` command will check that the manual paste-in steps are wired correctly.

## Interactive flow

1. **Project context** — soft check that this looks like an Expo project (read nearest `package.json`, look for `expo` dep). If a workspace root is detected (`pnpm-workspace.yaml`, bun workspaces, `package.json#workspaces`), prompt the developer to pick which workspace they're configuring. The detected workspace path is used purely to tailor the printed instructions (e.g. `App.tsx` vs `app/_layout.tsx` paths). A non-Expo project warns but does not block.
2. **Already configured?** — if a previous run is detected (local marker file in the workspace), enter a reconfigure flow rather than starting fresh. The developer can re-pick events or swap PostHog credentials without redoing the whole flow.
3. **Notify auth** — paste the Notify API key from the dashboard. CLI stores it in `~/.notify/config` for subsequent runs.
4. **PostHog host** — select prompt: US cloud (`us.posthog.com`) or EU cloud (`eu.posthog.com`).
5. **PostHog credentials** — paste personal API key (`hog_function:write` scope) and project ID. Documented as "create a service-account user in PostHog, generate a personal API key, paste it here," matching the RFC's connect-flow copy.
6. **Connect** — CLI calls `POST /integrations/posthog/connect` on Notify backend with `{ notifyApiKey, posthogApiKey, posthogProjectId, posthogHost }`. Backend stores the encrypted integration row and fetches the customer's recent custom-event list (filtered to non-`$`-prefixed events, sorted by 30-day volume) via PostHog's `event_definitions` API. **No hog function is created at this step.**
7. **Pick events** — CLI renders a multi-select checkbox prompt of the returned events, with a "show all events" toggle for autocaptured (`$pageview` etc.) and the long tail.
8. **Provision** — CLI calls `POST /integrations/posthog/events/selection` with the selected event names. Backend:
   1. Persists the selected event definitions.
   2. Provisions the hog function on the first non-empty selection, with the filter list pre-populated to the selected event names and the webhook secret passed as a hog function input.
   3. Stores `hog_function_id` on the integration row.
9. **Done screen** — prints:
   - The two app-side snippets the developer must paste in (see [Manual snippets](#manual-snippets) below).
   - The env vars to add (`EXPO_PUBLIC_NOTIFY_API_KEY`, plus any PostHog vars they don't already have).
   - A link to the dashboard with the draft workflows queued up for design in the canvas.

The customer never sees, copies, or handles the webhook secret.

## Endpoint split (shared with dashboard)

The dashboard's existing connect flow is rewritten to call the same two endpoints. This is a change to `rfc-posthog-integration.md` — see the addendum at the bottom of that doc.

- `POST /integrations/posthog/connect` — store credentials. **No hog function side effect.**
- `GET /integrations/posthog/events` — return recent events and active selection.
- `POST /integrations/posthog/events/selection` — persist selection and provision/update hog function filters.

The split exists because the hog function's job is to forward a *filtered* set of events; creating it before the customer has picked any events means it could be created with an empty filter. Deferring provisioning until after the picker keeps the hog function correct from the moment it exists.

## Manual snippets

The CLI's done screen prints these for the developer to paste:

1. **Wrap the app:**
   ```tsx
   import { NotifyProvider } from '@notify/expo';
   // wrap your root layout:
   <NotifyProvider>{children}</NotifyProvider>
   ```
2. **Register the user (lazy identity wiring):**
   ```ts
   import { notify } from '@notify/expo';
   import PostHog from 'posthog-react-native';

   notify.register({ getUserId: () => PostHog.getDistinctId() });
   ```
3. **Env vars to add to `.env` and `.env.example`:**
   ```
   EXPO_PUBLIC_NOTIFY_API_KEY=...
   ```

Lazy `getUserId` (a callback) instead of an eager value sidesteps PostHog's async initialization race. The Notify SDK calls it when it actually needs the ID.

## Identity contract enforcement

The PostHog RFC's identity contract (line 60: "customers must pass their PostHog `distinct_id` as the `user_id` argument when calling `POST /users/register`") is currently *documented, not enforced*. The CLI's printed snippet for `notify.register` wires `getUserId: () => PostHog.getDistinctId()` directly, which is the simplest correct implementation. This shifts enforcement from "the docs say so" to "the CLI's recommended snippet does it for you." Customers who deviate are still on their own, but the default path is correct.

## Hard dependency

`@notify/expo` does not exist yet. The CLI's printed snippets reference it. The SDK package is a prerequisite for shipping the CLI publicly, but the CLI's design is independent of the SDK's internals — only the public API surface (`NotifyProvider`, `notify.register({ getUserId })`) needs to be stable before launch.

## Distribution

- New `packages/cli/` workspace.
- Published as `@notify/cli` (or similar) so `npx notify ...` resolves.
- Sets up the workspace shape for the upcoming `@notify/expo` SDK package alongside it.

## Non-goals (v1)

- Native iOS/Android (Swift/Kotlin) — Expo only.
- Bare React Native projects.
- PostHog self-hosted instances.
- Migrating from OneSignal/Pushbase.
- Managing APNs/FCM credentials (Expo handles this).
- Auth/user-identity wiring beyond the printed snippet — Better Auth integration is parked.
- Codegen / file patching — entirely out of scope.
- Test-push verify on the developer's device — deferred to a future `notify doctor` command.
- Device-code login — paste-only for v1.

## Open questions (defer)

- Markers for "already configured" — local file in workspace vs server-side check. Probably both.
- Reconfigure flow ergonomics — swap credentials vs re-pick events vs full redo.
- Whether `~/.notify/config` should also be writeable by the dashboard for cross-surface session sharing.

## Inspiration

- `stripe login` — paste-key auth pattern.
- `npx convex dev`, `npx prisma init` — interactive flow + done-screen ergonomics.
- PostHog's own dashboard-side hog function provisioning — we share its endpoints.
