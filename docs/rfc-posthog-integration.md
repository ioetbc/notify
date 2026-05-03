# RFC — PostHog Integration

Status: Draft
Author: wcole
Date: 2026-05-02

## Motivation

Today, customers fire events at Notify's `/events` endpoint to drive journeys. This requires them to instrument every meaningful action twice: once for their analytics tool (typically PostHog) and once for Notify.

Most of our target customers (SMB consumer apps on Expo / React Native) already use PostHog. Integrating directly with PostHog removes the duplicate instrumentation step, makes onboarding dramatically faster, and unlocks a future where audience definitions (cohorts) and feature flags drive notification logic without any extra customer work.

PostHog becomes the **first-class** event source. The direct `/events` API stays available as a second-class fallback for customers without PostHog or with constraints that prevent the integration.

## Scope

### v1 (this RFC)

Events-only integration. PostHog events trigger Notify journeys. Customer connects their PostHog project, picks which events to use, and Notify provisions the wiring on PostHog's side automatically.

### v1.5 (operational hardening, post-launch)

- Inbound webhook idempotency (dedupe on `posthog_event_uuid`)
- DLQ ownership: alerting, replay tooling
- Personal API key rotation: detect 401s, prompt reconnect

### v2 (next major)

- Cohort-based triggers and conditions — the headline v2 feature
- Feature flags as canvas conditions
- "Enroll historical users" backfill button per workflow
- OAuth replacing personal API key paste
- Derive `distinct_id` automatically via PostHog's `/persons` API — let customers configure "look up the PostHog person whose property `X` equals the `user_id` we sent at register time, then use that person's `distinct_id` going forward." Lifts the [identity contract](#identity-contract) constraint for customers who can't align IDs at registration time.

## Non-goals

- Writing anything to the customer's PostHog account. Notify is read-only against PostHog's data and only writes to the hog function it provisions on the customer's behalf.
- Bridging PostHog's identity graph. The customer is responsible for ensuring `distinct_id` and Notify `user_id` align (see [Identity contract](#identity-contract)).
- Polling PostHog for events. Programmatic webhook provisioning makes polling unnecessary.
- Cohorts, feature flags, and historical backfill in v1.

## Connect flow

The flow is split across backend endpoints so the same wiring is shared by the dashboard and the `npx notify connect posthog` CLI (see `onboarding-cli.md`). One source of truth on the server, two UIs on top.

### Endpoints

- `POST /integrations/posthog/connect` — stores credentials. **No hog function side effect at this step.**
- `GET /integrations/posthog/events` — returns recent events plus current active selection.
- `POST /integrations/posthog/events/selection` — persists selected events and provisions or updates the hog function filters.

### Steps

1. Customer enters the connect flow (dashboard: Settings → Integrations → PostHog → Connect; CLI: `npx notify connect posthog`).
2. UI collects PostHog host (US or EU cloud — self-hosted is parked to v2), a PostHog **personal API key** with `hog_function:write` scope, and the PostHog project ID. Documented as: "create a service-account user in PostHog, generate a personal API key, paste it here."
3. UI calls `POST /integrations/posthog/connect`. Notify:
   1. Stores the integration row (encrypted personal API key, project ID, host).
   2. Generates and stores a webhook secret for later hog function provisioning.
4. UI fetches recent events and presents the **event picker** — multi-select of returned events, with a "show all events" toggle for autocaptured (`$pageview` etc.) and the long tail.
5. UI calls `POST /integrations/posthog/events/selection` with selected event names. Notify:
   1. Persists the selected event definitions.
   2. Creates the destination-type hog function on the first non-empty selection. The function is templated to compute `HMAC-SHA256(webhook_secret, raw_body)` and POST every matching event to `https://api.notify.com/webhooks/posthog/:customerId` with header `X-Notify-Signature: <hmac>`.
   3. Updates the hog function filters on subsequent saves. An empty selection uses a sentinel event filter rather than an empty filter list.
   4. Stores the returned `hog_function_id` on the integration row.
6. Starter workflow creation is deferred until template selection is implemented separately.

Splitting `connect` from event selection avoids creating a hog function with an empty filter list, which could forward everything depending on PostHog's interpretation.

The customer never sees, copies, or handles the webhook secret.

## Identity contract

Notify's existing schema separates `user.id` (internal UUID) from `user.externalId` (whatever the customer's auth system calls them), unique per `(customerId, externalId)`. PostHog's `distinct_id` maps to `externalId`.

**The contract:** customers must pass their PostHog `distinct_id` as the `user_id` argument when calling `POST /users/register`. This is documented, not enforced. Customers who can't meet it fall back to the direct events API.

This deliberately avoids reasoning about PostHog's identify graph, anonymous→identified merges, or person-property lookups. Those are PostHog's hardest problems and not ones we want to own.

## Data model

New table:

```
customer_integration
  id              uuid PK
  customer_id     uuid FK → customer
  provider        enum('posthog')         -- additional providers later (Mixpanel, Segment, etc.)
  config          jsonb                   -- provider-specific blob (see below)
  connected_at    timestamptz
  unique(customer_id, provider)
```

For `provider = 'posthog'`, `config` contains:

```json
{
  "personal_api_key_encrypted": "...",
  "project_id": "12345",
  "hog_function_id": "...",
  "webhook_secret_encrypted": "..."
}
```

Encryption details TBD during implementation; minimum bar is "not stored in plaintext, key not in repo."

No changes to `event`, `user`, `workflow`, or any existing table in v1.

## Webhook contract

**Inbound endpoint:** `POST /webhooks/posthog/:customerId`

**Headers:**
- `X-Notify-Signature: <hex hmac-sha256>`
- `Content-Type: application/json`

**Body:** PostHog's standard event payload (`event`, `distinct_id`, `properties`, `timestamp`, `uuid`).

**Verification:**
1. Look up `customer_integration` by `:customerId` and `provider = 'posthog'`. 404 if missing.
2. Compute `HMAC-SHA256(webhook_secret, raw_request_body)` using the **raw bytes** of the request body — before any JSON parsing or middleware reserialization. SST/Hono lambdas need the raw-body buffer captured before middleware touches it.
3. Constant-time compare against `X-Notify-Signature`. 401 on mismatch.
4. On match, enqueue an event-ingest job to SQS keyed by `(customerId, distinct_id, event_name)`. The downstream consumer is the same path that handles direct-API events: look up the user by `(customerId, externalId=distinct_id)`, persist to `event`, fan out to active workflow enrollments.

**Filter scoping:** the hog function only forwards events whose name appears in at least one active workflow's trigger. When a workflow is published, paused, archived, or its trigger event changes, the hog function's filter list is reconciled. Stale filters (events no longer referenced by any active workflow) are tolerated and ignored on our side via the workflow `status` enum; a weekly GC removes them from the hog function.

## Failure handling

- **PostHog unavailable for outbound reads** (event list at connect time, future cohort/property reads): SQS-backed condition evaluations retry 3 times with backoff, then move to DLQ. v1 surfaces this as an error in the run log; alerting and replay tooling are v1.5.
- **PostHog hog function retry behavior:** PostHog retries failed deliveries automatically. Without idempotency (deferred to v1.5), a retried webhook can double-enroll a user. Acceptable risk for v1 because (a) the hog function only retries on 5xx from our endpoint, which should be rare, and (b) most workflows have a single-step welcome before any wait, so a duplicate is at worst a duplicate notification, not a runaway journey.
- **Customer rotates their PostHog personal API key:** the hog function keeps delivering inbound events (auth is per-function), but our outbound reads start 401ing. v1 logs this; v1.5 adds detect-and-prompt-reconnect.

## Event Picker UX

After connecting, the customer sees a list of their PostHog events with checkboxes:

- Default view: custom events (no `$` prefix) seen in the last 30 days, sorted by volume, top 10 highlighted.
- "Show all events" toggle reveals autocaptured events (`$pageview`, `$autocapture`, etc.) and the long tail.
- Ticking an event marks it active for Notify ingestion and reconciles the PostHog hog function filter list.

This is the primary onboarding moment for the integration. It demonstrates immediate value: "you connected, here are the events Notify can listen to from PostHog."

## Open questions

- Encryption-at-rest implementation for the personal API key and webhook secret. Defer to implementation review.
- Starter workflow templates are deferred. Candidate set: welcome series, abandoned-checkout, churn-risk, re-engagement, trial-ending, milestone celebration.
- Rate-limiting inbound webhooks. Probably unnecessary at our scale; revisit if we see bursts.

## Appendix — settled questions and rejected alternatives

- **Polling vs. webhooks:** rejected polling. Programmatic hog function provisioning means we get low-latency push without making the customer touch PostHog's settings UI.
- **Project API key vs. personal API key:** rejected project API key. PostHog's `hog_function:write` scope requires a personal API key; project keys are for ingestion only.
- **OAuth for v1:** rejected. Personal API key paste ships in days; OAuth is a v2 polish.
- **Auto-creating cohorts in the customer's PostHog:** rejected outright. Read-only access only, no exceptions.
- **Auto-replay of historical events on connect:** rejected. Would carpet-bomb existing users with welcome notifications. Backfill becomes an explicit per-workflow action in v2.
- **Events API as a peer to PostHog:** rejected. PostHog is first-class, events API is the fallback.
- **Bridging identity via PostHog person properties:** rejected. Customer aligns `distinct_id` with `user_id` at registration time, or falls back to events API.
