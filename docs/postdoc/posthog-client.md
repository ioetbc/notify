# Chunk A — PostHog HTTP Client

Pure module that wraps PostHog's REST API. No DB access, no SQS, no Hono routes. Other chunks import from here.

## Goal

A typed, well-tested client for the four PostHog endpoints v1 needs:

1. `createHogFunction(args)` — provisions a destination-type hog function that POSTs to a given URL.
2. `updateHogFunctionFilters(id, eventNames)` — replaces the filter list on an existing hog function.
3. `deleteHogFunction(id)` — removes the provisioned hog function during disconnect.
4. `listRecentEvents(args)` — returns the customer's recent custom events (for the template picker), with 30-day volume.

## Owns these files

- `apps/server/services/posthog/index.ts` — barrel
- `apps/server/services/posthog/client.ts` — the three functions above
- `apps/server/services/posthog/hog-template.ts` — the Hog source code string that the hog function runs
- `apps/server/services/posthog/types.ts` — Zod schemas for request and response shapes
- `apps/server/__tests__/posthog-client.test.ts` — tests against a stubbed `fetch`

## Does NOT touch

- `db/schema.ts`, `repository/`, any `functions/`, the canvas/client, or any other service.
- Does **not** read/write the `customer_integration` table. The caller passes the personal API key and project ID as arguments.

## API shape

```ts
type PosthogClientConfig = {
  baseUrl: string;          // default "https://us.posthog.com" — caller-overridable
  personalApiKey: string;
  projectId: string;
};

createHogFunction(cfg: PosthogClientConfig, args: {
  webhookUrl: string;
  eventNames: string[];     // initial filter set
  customerId: string;       // for naming the function ("Notify — <customerId>")
}): Promise<{ hogFunctionId: string }>;

updateHogFunctionFilters(cfg: PosthogClientConfig, args: {
  hogFunctionId: string;
  eventNames: string[];
}): Promise<void>;

deleteHogFunction(cfg: PosthogClientConfig, args: {
  hogFunctionId: string;
}): Promise<void>;

listRecentEvents(cfg: PosthogClientConfig, args: {
  days: number;             // default 30
  excludePrefixed: boolean; // default true (skips $ events)
  limit: number;            // default 50
}): Promise<Array<{ name: string; volume: number }>>;
```

## Hog template

Define the Hog source as a string constant in `hog-template.ts`. It must:

- Read `inputs.webhook_url`.
- POST to `inputs.webhook_url` with headers:
  - `Content-Type: application/json`

## Endpoints used

- `POST /api/projects/:project_id/hog_functions/` — create
- `PATCH /api/projects/:project_id/hog_functions/:id/` — update filters
- `DELETE /api/projects/:project_id/hog_functions/:id/` — delete
- `POST /api/projects/:project_id/query/` (HogQL) — recent event list

Auth: `Authorization: Bearer <personalApiKey>` on every request.

## Error handling

- 401 → throw a typed `PosthogAuthError` so callers can prompt re-connect later.
- 4xx other → throw `PosthogClientError` with status and parsed body.
- 5xx and network errors → throw `PosthogTransientError`. Callers decide whether to retry.

No retry logic in the client itself — keep it dumb. SQS handles retries at a higher layer.

## Tests

Stub `globalThis.fetch`. Cover:

- `createHogFunction` posts the right body shape and parses the returned id.
- `updateHogFunctionFilters` PATCHes only the filters field.
- `deleteHogFunction` calls the hog function delete endpoint.
- `listRecentEvents` constructs the HogQL query correctly and parses the response.
- Each error class is thrown for the matching status range.

Tests run via `sst shell -- bun test`.

## Acceptance

- Module is importable and has zero references to DB, SQS, Hono, or the customer integration table.
- `bun tsc --noEmit` passes.
- All tests pass.
- Hog template string is verified to compile in PostHog (manual smoke test against a real project before Chunk B/C call it).
