# Chunk B — Connect Flow API

The HTTP layer the customer's browser hits to connect their PostHog account, list/select events, reconcile PostHog filters, and disconnect.

## Depends on

- **Chunk 0** for `customerIntegration` table and `IntegrationRepository`.
- **Chunk A** for the PostHog client.

## Owns these files

- `apps/server/services/integration/index.ts`
- `apps/server/services/integration/integration.ts` — service-layer functions that orchestrate repo + posthog client
- `apps/server/functions/public/integration.ts` — Hono routes mounted under the existing public function
- `apps/server/__tests__/integration-service.test.ts`
- `apps/server/__tests__/integration-routes.test.ts`

May add a small mount line in `apps/server/functions/public/index.ts` to wire the new routes — that is the only existing-file edit allowed.

## Does NOT touch

- `db/schema.ts` (Chunk 0 owns it).
- `services/posthog/` (Chunk A owns it; only imports).
- The webhook endpoint or worker (Chunk C owns those).
- Any frontend file.

## Routes (under `/api/integrations/posthog`)

All routes require an authenticated customer (use the existing auth middleware on the public function — check how `services/public/public.ts` does it).

| Method | Path | Body / Query | Returns |
|---|---|---|---|
| `GET` | `/` | — | `{ id, provider, project_id, connected_at }` or `404` |
| `POST` | `/connect` | `{ personal_api_key, project_id, region: "us" \| "eu" }` | `{ integration_id }` |
| `GET` | `/events` | `?days=30&limit=50&include_autocaptured=false` | `Array<{ name, volume, active }>` |
| `POST` | `/events/selection` | `{ events: Array<{ name, volume? }> }` | `{ event_names }` |
| `DELETE` | `/` | — | `204` |

### `GET /` flow

1. Look up the integration by `(customerId, "posthog")`. 404 with `{ error: { code: "integration_not_found" } }` if missing.
2. Return a summary — never the encrypted key, secret, or hog function id.

### `POST /connect` flow

1. Validate body with Zod. `region` defaults to `"us"` when omitted; resolves to `https://us.posthog.com` or `https://eu.posthog.com` for the PostHog client `baseUrl`.
2. Reject if an integration already exists for this `(customer, posthog)` pair (return 409).
3. Generate a 32-byte hex `webhook_secret` via `crypto.randomBytes`.
4. Insert the integration row with `hog_function_id: null`, the encoded `personal_api_key` and `webhook_secret`, and the chosen `region` (Chunk 0 stores keys base64-encoded for now).
5. Return `{ integration_id }`.

Connect deliberately does not create a hog function. The function is created on the first non-empty event selection so it never exists with an ambiguous empty filter.

### `GET /events`

1. Look up the integration. 404 if missing.
2. Decode the personal API key.
3. Call `posthog.listRecentEvents({ days, limit, excludePrefixed: !include_autocaptured })`.
4. Merge in stored event definitions so each returned event has `active`.
5. Return the array.

### `POST /events/selection`

1. Look up the integration. 404 if missing.
2. Persist the selected event names in `customer_event_definition`, marking previously selected events inactive when omitted.
3. If this is the first non-empty selection, create the hog function with those event names.
4. If the hog function already exists, update its filters. When the selection is empty, use a sentinel event name rather than an empty filter list so PostHog cannot interpret the filter as "forward everything."
5. Return `{ event_names }`.

### `DELETE /`

1. Look up the integration. 404 if missing.
2. **Do not** delete the hog function from PostHog. Leave it; the customer can delete it manually if they want. Document this trade-off — we'd rather strand a no-op function than risk deleting the wrong one due to a stale id.
3. `repo.delete(id)`.
4. Return 204.

## Error contracts

- `PosthogAuthError` from the client → 502 with body `{ code: "posthog_auth_failed" }`. Frontend prompts re-paste of the key.
- `PosthogTransientError` → 503 with `Retry-After`. Frontend shows a generic "PostHog unavailable, try again."
- Any other unexpected error → 500.

## Tests

Service-level (mock the repo and the client):

- Connect inserts a row without creating a hog function.
- Connect rejects when an integration already exists.
- Event selection creates the hog function on first non-empty selection.
- Event selection updates filters and marks omitted events inactive when the hog function exists.
- Disconnect deletes the row but does not call the client.

Route-level (in-process Hono, real DB, stubbed PostHog client):

- Auth required (401 without API key).
- Happy-path round trip.
- 409 on duplicate connect.
- 502 on PostHog auth failure during connect.

## Acceptance

- New routes are reachable through the existing public function deployment.
- `sst shell -- bun test` passes the new test files.
- No changes to files outside the "Owns" list, except the single mount line in `functions/public/index.ts`.
