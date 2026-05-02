# Chunk C — Inbound Webhook

Receives PostHog events at `/webhooks/posthog/:customerId`, verifies HMAC, and enqueues the event onto the existing event-ingest path.

## Depends on

- **Chunk 0** for `customerIntegration` and `IntegrationRepository`.
- **No dependency on Chunk A or B** — runs entirely in parallel with them. The webhook only reads the integration row to fetch the secret.

## Owns these files

- `apps/server/functions/posthog-webhook/index.ts` — new Lambda entry point
- `apps/server/functions/posthog-webhook/handler.ts` — request handler logic
- `apps/server/services/posthog-webhook/verify.ts` — HMAC verification utility
- `apps/server/services/posthog-webhook/translate.ts` — maps PostHog event payload → internal event shape
- `sst.config.ts` — add a new function and route binding for the webhook (this is the only shared-file edit)
- `apps/server/__tests__/posthog-webhook-handler.test.ts`
- `apps/server/__tests__/posthog-webhook-verify.test.ts`

## Does NOT touch

- The connect-flow routes or service (Chunk B).
- The PostHog client (Chunk A).
- The worker / dispatcher / enrollment services. The webhook reuses the **existing** event-ingest entry point — find it by following `services/public/public.ts` for the `/events` POST handler and call the same downstream function.

## Endpoint shape

`POST /webhooks/posthog/:customerId`

Headers:
- `X-Notify-Signature: <hex hmac-sha256>`

Body: PostHog hog function payload. Expected fields used:
- `event` (string, required)
- `distinct_id` (string, required)
- `properties` (object, optional)
- `timestamp` (ISO 8601, optional — fall back to receive time)
- `uuid` (string, optional — store but do not dedupe in v1)

Other fields ignored.

## Handler flow

1. **Capture raw body** as bytes before any framework JSON parsing. Hono lambdas: use `c.req.raw.arrayBuffer()` and parse JSON manually after HMAC. If you parse first and re-stringify, signatures will mismatch — this is the classic footgun.
2. Look up integration by `(customerId, "posthog")`. 404 if missing.
3. Decode the webhook secret.
4. Compute `HMAC-SHA256(secret, rawBody)`. Constant-time compare against header. 401 on mismatch.
5. Parse the JSON. 400 on invalid shape (Zod-validate against `PosthogEventPayloadSchema`).
6. Translate to the internal event shape: `{ user_id: distinct_id, event: event, properties, timestamp }`.
7. Call the existing event-ingest function (the same one `/events` calls). Do not duplicate user-lookup or workflow-fanout logic — that is explicitly out of scope for this chunk.
8. Return 202 if accepted, 4xx for client errors. Never return 5xx for downstream failures the caller can't retry safely; let the existing ingest path's SQS handle that.

## Why no idempotency yet

Punted to v1.5 per the RFC. PostHog hog functions retry on 5xx, so dedupe matters in steady-state but is acceptable risk for v1 because most workflows have a single welcome step before any wait. The `posthog_event_uuid` from the payload should still be **logged** so v1.5 can backfill a dedupe table.

## SST configuration

Add to `sst.config.ts`:

- A new HTTP route on the existing public API for `POST /webhooks/posthog/:customerId`, OR a dedicated function — match the existing pattern in the file. Prefer mounting on the existing API to avoid a new domain/cert.
- The function needs DB read access (for the integration row).
- The function does **not** need direct SQS publish rights; it calls the existing ingest service which already has them.

## Tests

`verify.ts` (pure):
- Valid signature passes.
- One-byte-different signature fails.
- Constant-time comparison (no timing leak — assert via test that both branches take similar time, or just verify use of `crypto.timingSafeEqual`).

`handler.ts` (integration, real DB, stubbed downstream ingest):
- Happy path: matching signature → ingest called with translated payload → 202.
- Missing integration → 404.
- Bad signature → 401.
- Malformed body → 400 (and ingest not called).
- Missing `distinct_id` → 400.
- Unknown event name (no workflow listening) → 202 (ingest decides what to do).

## Acceptance

- Endpoint deploys via `sst deploy --stage <dev>` and is reachable.
- A manually crafted POST with the right HMAC reaches the existing event-ingest path and creates an `event` row.
- All tests pass via `sst shell -- bun test`.
- No changes to files outside the "Owns" list (except the `sst.config.ts` additions, which are scoped to the new function only).
