# PRD — PostHog Integration

## Problem Statement

Customers on our platform already use PostHog as their analytics backbone. Today, to drive a notification workflow off a meaningful product event (e.g. `purchase_completed`, `add_to_basket`), they have to make a *second* call to our `/v1/events` API from their backend whenever that event fires — duplicating instrumentation work they have already done in PostHog. Customers who do not have a backend team available, or who do not want to maintain two parallel event pipelines, cannot easily adopt the platform.

In addition, the trigger picker in the workflow builder currently reads candidate event names from the `user.attributes` JSONB column. That column stores user *properties*, not event names — so the picker surfaces the wrong vocabulary, and there is no per-customer concept of "the set of events this customer cares about."

## Solution

Customers connect their PostHog project once, on a Settings screen, by pasting a Personal Access Token, their Team ID, and choosing which field on a PostHog event identifies the user in their system. The platform fetches the customer's PostHog event definitions, presents them as a checkbox list, and the customer selects which events should be available as workflow triggers. Behind the scenes we create a single Hog function in PostHog that webhooks the selected events back to us; from that point on, those events flow into our `event` table just like events submitted via our direct ingest API, and they appear in the workflow builder's trigger picker. The customer can return to the same screen at any time to add or remove selected events, rotate their PAT, or disconnect — and disconnect cleanly tears down the Hog function in PostHog.

Alongside this we introduce a first-class `customer_event_definition` table that becomes the single source of truth for "which events exist for this customer." Both the PostHog ingest path and the existing direct `/v1/events` path upsert into it, and the workflow trigger references a definition by foreign key rather than by free-text event name.

## User Stories

1. As a customer, I want to connect my PostHog project to the platform by entering a Personal Access Token and Team ID, so that I do not have to instrument events twice.
2. As a customer, I want to choose which field on a PostHog event identifies the user in my system (defaulting to `distinct_id`), so that PostHog events resolve to the same end users I have already registered with the platform.
3. As a customer, I want the Settings screen to validate my PAT before saving, so that I find out about typos or revoked credentials immediately rather than discovering my workflows do not fire.
4. As a customer, I want to see all the event definitions PostHog already knows about as a checkbox list, so that I can pick triggers without having to remember exact event names.
5. As a customer, I want to enable a subset of PostHog events as workflow triggers, so that I am not flooding the platform with events I do not care about.
6. As a customer, I want to add or remove enabled events later, so that I can evolve my workflow vocabulary as my product changes.
7. As a customer, I want PostHog-sourced event definitions to appear in the workflow builder's trigger picker, so that I can build a workflow that fires when a PostHog event arrives.
8. As a customer, I want a workflow built off `posthog:purchase_completed` to fire only on PostHog-sourced events, not on identically-named events submitted via the direct ingest API, so that the two sources do not mix unexpectedly.
9. As a customer, I want PostHog events that arrive via webhook to enroll users into matching workflows immediately, so that workflow latency is comparable to direct ingest.
10. As a customer, I want events that arrive for a `distinct_id` I have never registered with the platform to be dropped and logged, so that my notification audience is well-defined and I can debug missing registrations.
11. As a customer, I want my PAT to be encrypted at rest, so that a database-only breach does not leak credentials that grant access to my analytics.
12. As a customer, I want the Settings screen to mask my PAT on return visits while still letting me rotate it, so that I do not accidentally leak credentials over my shoulder.
13. As a customer, I want to disconnect my PostHog integration in one click, so that I can sever the relationship without a support ticket.
14. As a customer, when I disconnect, I want the Hog function in my PostHog project to be deleted automatically, so that I am not left with dangling webhook destinations to clean up manually.
15. As a customer, when I disconnect, I want my workflows triggered by PostHog events to be paused (not deleted), so that I can reconnect later and resume without re-building the workflow.
16. As a customer, when I disconnect, I want my historical PostHog event data to remain in the platform by default, so that reconnecting later does not lose audit history.
17. As a customer, I want a separate, explicit "Purge PostHog data" button, so that I can do a hard wipe of historical events and definitions when I really mean to.
18. As a customer, I want users currently mid-flow in a PostHog-triggered workflow to finish their journey naturally on disconnect, so that disconnecting does not silently strand end users in a half-completed state.
19. As a customer, I want to change my identity mapping field after connecting, so that I can adapt if my PostHog instrumentation changes.
20. As a customer, I want changing my Team ID to require a clean disconnect-then-reconnect, so that the platform never ends up holding a Hog function in a project the integration no longer points at.
21. As a customer, I want only events I explicitly enabled to be webhook'd to the platform, so that I do not pay for ingest of events I do not use.
22. As an end user of a customer's app, I want to receive notifications driven by PostHog events without my PII being copied unnecessarily into yet another system, so that my data footprint is bounded.
23. As a workflow builder, I want the trigger picker to source candidate triggers from a per-customer event-definition list (not from `user.attributes`), so that the suggestions reflect actual events rather than user properties.
24. As an operator, I want both the PostHog ingest path and the direct `/v1/events` path to upsert into the same `customer_event_definition` table, so that the trigger picker stays coherent regardless of which path produced the event.
25. As an operator, I want the webhook endpoint to be authenticated by a per-integration secret token in a header, so that arbitrary internet traffic cannot inject events into a customer's workflow engine.
26. As an operator, I want the webhook handler to share its enrollment pipeline with the existing direct-ingest path, so that there is exactly one place to fix bugs in identity resolution, definition upsert, and enrollment.
27. As an operator, I want every PostHog-sourced row in `event` to carry a `source='posthog'` marker, so that I can distinguish, audit, and (if needed) purge by origin.
28. As an operator, I want existing workflows that today reference `triggerEvent` as text to be migrated to point at a `customer_event_definition` row, so that the new FK-based trigger model does not break in-flight workflows.

## Implementation Decisions

### Schema changes
- New table `posthog_integration` with one row per customer, holding the encrypted PAT, Team ID, identity-mapping field, the Hog function ID returned by PostHog, and a per-integration webhook secret.
- New table `customer_event_definition` with `(customer_id, name, source)` unique, a `source` enum (`customer_api | posthog`), `enabled_as_trigger` boolean, and `first_seen_at` / `last_seen_at` timestamps. This becomes the source of truth for "which events exist for this customer."
- `event` table gains a `source` enum column and an `event_definition_id` FK.
- `workflow.trigger_event` (text) is replaced by `workflow.trigger_event_definition_id` (FK to `customer_event_definition`). A migration backfills existing workflows by upserting a definition for each unique `(customer_id, trigger_event)` pair with `source='customer_api'` and pointing the workflow at it.
- The trigger picker in the workflow builder stops reading from `user.attributes` and instead reads from `customer_event_definition` filtered to `enabled_as_trigger = true`.

### Credentials
- Customers provide a Personal Access Token (not a Project API Key — Hog function management requires user-scoped auth) plus the numeric Team ID.
- The PAT is stored long-term so that disconnect can delete the Hog function in PostHog. It is encrypted at rest with AES-256-GCM, with the master key held in an SST Secret named `IntegrationEncryptionKey`. Encryption and decryption flow through a single repository chokepoint; the API never returns the plaintext PAT to the client.

### Identity mapping
- The integration row stores a configurable `identity_field` (default `distinct_id`). On webhook receipt, the resolver reads that field from the Hog payload (top-level `distinct_id` or `properties[<configured field>]`) and looks the user up by `(customer_id, external_id)`.
- Unmatched events are dropped and logged. No buffer-and-retry, no auto-create.

### Connection lifecycle
- `POST /integrations/posthog/preview` — body `{ pat, teamId }`. Validates the PAT against PostHog (`GET /api/users/@me/`), fetches `/api/projects/:teamId/event_definitions`, and returns the list. Persists nothing. Used by the "Load events" button on the Settings screen.
- `POST /integrations/posthog` — body `{ pat, teamId, identityField, enabledEventNames[] }`. Encrypts and stores the PAT, upserts the integration row, upserts all definitions returned from PostHog with `enabled_as_trigger` set per the input, generates a webhook secret, creates one Hog function in PostHog whose URL is `/ingest/posthog/:integrationId` and whose static header `X-Notify-Token` carries the secret, and whose filter matches the enabled event names. The same endpoint also handles edits idempotently — a missing PAT in the request body means "keep the existing one," and any other fields update in place.
- Changing the Team ID is rejected at the API layer: the customer must disconnect and reconnect, because a Hog function lives inside a specific PostHog project.
- `DELETE /integrations/posthog` — calls PostHog to delete the Hog function, deletes the integration row (and PAT), and pauses all workflows whose `trigger_event_definition_id` points at a row with `source='posthog'`. Historical events and definitions are retained.
- A separate "Purge PostHog data" action hard-deletes all rows in `event` and `customer_event_definition` with `source='posthog'` for the customer. This is destructive and gated behind a confirmation.

### Hog function shape
- One Hog function per customer (not per event). Its filter is the union of currently enabled event names. Toggling events on/off reconciles the filter via PATCH against the same Hog function. This minimises the number of objects we leave behind in a customer's PostHog account and keeps the webhook URL stable.

### Webhook ingest
- `POST /ingest/posthog/:integrationId`, authenticated via the `X-Notify-Token` header carrying the per-integration secret. The handler runs synchronously inline, mirroring the existing `/v1/events` flow: auth → identity-resolve → upsert `customer_event_definition` (no-op if already present) → insert `event` row (source `posthog`, `event_definition_id` set) → look up workflows by `trigger_event_definition_id` → enroll. Hog functions retry on non-2xx, so we get retry behaviour for free.
- No queue. If burst load ever requires async ingest, an SQS layer can be inserted in front of both the PostHog and direct-ingest paths together.

### Coherence with direct ingest
- The existing `POST /v1/events` path is updated to upsert into `customer_event_definition` with `source='customer_api'` and to populate `event.source` / `event.event_definition_id`. Without this, the trigger picker would only see PostHog-sourced events.

### Settings UI
- Single screen, lives under Settings (not as a top-level Integrations area). Two-stage form: PAT + Team ID + identity-field inputs, "Load events" button posts to the preview endpoint, response renders a checkbox list, "Save" commits everything to the save endpoint.
- On return visits, the same screen renders pre-filled: PAT masked, Team ID and identity field visible, current selections checked. Saving is idempotent — empty PAT means "keep existing," any other change applies. Disconnect and Purge are separate destructive buttons with confirmation.

### Modules
- A `posthog-client` module wraps every PostHog REST call we need (validate PAT, list event definitions, create / update / delete Hog function) behind a small interface with no PostHog SDK leakage to callers.
- A `crypto` module exposes `encrypt` / `decrypt` over the SST-Secret-backed AES key. It is the only place that knows about cipher mode, IV format, or key resolution.
- An `identity-resolver` module turns a Hog payload plus an integration row into a `userId` or null. All branching over identity-field configuration lives here.
- An `event-definition` upsert module is shared between both ingest paths so neither can forget to register a definition.
- A `posthog` orchestration service composes the above for connect / preview / save / disconnect / purge. The webhook handler is a thin Lambda-style entrypoint that delegates to the same enrollment service used by direct ingest.

### Out-of-scope decisions captured for clarity
- No backfill of historical events. Forward-only from connect time. The Settings screen documents this in copy.
- No CLI tool; the Settings UI is the only surface.
- No `user ↔ event_definition` join table; the `event` log already records every user-event pair.
- No pending-event buffer for register/event races; in practice the customer's app has the push token (and therefore the registered user) before any meaningful PostHog event fires.
- No KMS envelope encryption in v1; SST Secret + AES-256-GCM is the v1 chokepoint and can be swapped later without changing callers.

## Testing Decisions

A good test in this codebase exercises external behaviour at the module boundary — given inputs that match what real callers pass, asserts on outputs and persisted state — and never reaches into private helpers, mocks the database, or asserts on log lines. Tests run through `sst shell -- bun test` so they can talk to a real database, matching the existing pattern in `apps/server/__tests__`.

The following modules will have explicit test coverage:

- **`posthog-client`** — fetch-mocked unit tests for each PostHog API method (validate PAT, list event definitions, create / update / delete Hog function), including non-2xx error paths. Prior art: any service in `apps/server/services` that wraps an outbound HTTP call.
- **`crypto`** — round-trip encrypt/decrypt, tampered-ciphertext rejection, missing-key behaviour. Self-contained, no DB.
- **`identity-resolver`** — table-driven cases over identity-field permutations (`distinct_id`, custom property, missing field, unknown user). Pure function over a payload + integration row.
- **`event-definition` upsert** — concurrent upsert deduping, `last_seen_at` advancement, `enabled_as_trigger` not clobbered by a re-upsert from ingest.
- **`posthog` orchestration** — integration tests against a real database covering: connect happy path, preview-without-persistence, save-with-edits idempotency, team-id change rejected, disconnect cascades (Hog function deleted, PAT and integration row removed, PostHog-triggered workflows paused, events retained), purge cascades (events and definitions removed, workflows paused).
- **Webhook ingest handler** — end-to-end test that posts a sample Hog payload to `/ingest/posthog/:integrationId`, asserts an `event` row is created with the right `source` and `event_definition_id`, that a `workflow_enrollment` is created when a matching workflow exists, and that an unmatched-identity payload is dropped without error.

The existing direct-ingest tests should be extended to cover the new `event_definition_id` and `source` columns, ensuring both ingest paths produce equivalent rows for an event with the same name.

## Out of Scope

- Backfill of historical PostHog events into the `event` table. Forward-only ingest from connect time.
- A CLI tool for managing the integration. The Settings UI is the only customer-facing surface.
- Multiple PostHog projects per customer. One Team ID per customer in v1.
- Per-event Hog functions. We use a single Hog function per customer with a filter list.
- KMS envelope encryption. SST Secret + AES-256-GCM is the v1 chokepoint.
- Auto-creation of users for unmatched `distinct_id`s. Strict drop + log.
- A pending-event buffer for register/event races.
- A `user ↔ event_definition` join table. The `event` log is sufficient for "which users have done X."
- Other event sources (Segment, Mixpanel, RudderStack). The architecture (definition table, source enum, identity resolver) is set up to accommodate them, but only PostHog is implemented.
- Self-serve PAT rotation flows beyond "paste a new PAT and save." No reminder emails, no expiry detection.
- Per-end-user GDPR deletion of PostHog data. Existing platform-wide deletion paths apply unchanged.

## Further Notes

- The decision to namespace PostHog event names against direct-ingest names is achieved structurally via the `source` column on `customer_event_definition` and the FK-based workflow trigger, rather than via a textual prefix. This means the customer sees the bare event name in the UI but the engine never confuses sources.
- When implementing the Hog function filter PATCH, the unit of change is the full enabled-events array — the implementation should compute the new list from `customer_event_definition` rather than diffing client input, so a divergent UI cannot push the Hog function into an inconsistent state.
- The migration that replaces `workflow.trigger_event` with `workflow.trigger_event_definition_id` is the riskiest single piece of this work. It should be staged: add the new column nullable, backfill, switch readers, drop the old column. The backfill must run inside the same transaction as the column drop or behind a feature flag to avoid a window where workflows have no trigger.
- The Settings screen should display "last event received" and a running count once connected. This is a small ergonomic addition that makes "is it working?" answerable without engineer involvement, and falls naturally out of the `event.source` column.
