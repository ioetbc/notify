# RFC: Deepen the PostHog client + integration service into a single seam

Status: Draft
Author: architecture review of PR #1 (`posthog-integration`)
Related: `docs/rfc-posthog-integration.md`, `docs/rfc-event-definition-deepening.md`

## Problem

PostHog-shaped knowledge is smeared across three layers, and each layer re-decides the same things.

- **`apps/server/services/posthog/client.ts`** — exposes ~5 thin per-API-call wrappers (`createHogFunction`, `updateHogFunctionFilters`, `deleteHogFunction`, `validateApiKey`, `listEventDefinitions`) plus three typed errors (`PosthogAuthError`, `PosthogTransientError`, `PosthogApiError`). The interface is nearly as wide as the implementation — each method is roughly one fetch + one classifier.
- **`apps/server/services/integration/integration.ts`** — composes those calls into `connect`, `saveEventSelection`, `disconnect`. Owns: encryption, region→baseUrl mapping, hog-template provisioning sequencing, the disabled-sentinel filter trick (`DISABLED_HOG_FUNCTION_EVENT`), and re-catches/re-throws the client's typed errors. ~290 LOC.
- **`apps/server/functions/public/integration.ts`** — `mapPosthogError()` does `instanceof` again to translate domain errors → HTTP status. `handleIntegrationAction` + `respondWithMappedError` + `IntegrationAlreadyExistsError` form a fourth quartet of glue.

Concrete pain:
- Every PostHog API or error-shape change ripples three layers and breaks multiple test mocks.
- `integration-routes.test.ts`, `integration-service.test.ts`, and `posthog-client.test.ts` each independently mock the same client surface to assert orchestration, not behaviour. None of them test "what happens when PostHog auth fails during `saveEventSelection`" as one outcome — they test which mock got called.
- The disabled-sentinel + create-vs-patch logic lives in the integration service, but it's PostHog-shaped knowledge that other providers won't share.
- `hog-template.ts` (Hog source + inputs schema) is imported transitively via the client; there's no single owner of "what does our hog function do."

## Proposed Interface

A two-layer seam:

1. **Outer facade** — `PosthogIntegrationPort`, shaped to the route handlers' verbs. Hides everything PostHog-specific.
2. **Inner port** — `PosthogPort`, a thin RPC surface used only by the facade. Has an HTTP production adapter and an in-memory test adapter.

Routes call only the facade. Service-layer orchestration moves *into* the facade (it's PostHog-shaped, not generic). Errors are surfaced as a single tagged `PosthogIntegrationError` consumed via ts-pattern `match` — no `Result` monad, no `instanceof` ladder.

```ts
// services/integration/posthog/facade.ts
export type PosthogIntegrationPort = {
  connect(input: ConnectInput): Promise<{ integrationId: string }>;
  saveEvents(input: SaveEventsInput): Promise<{ eventNames: string[] }>;
  listEvents(input: ListEventsInput): Promise<MergedEvent[]>;
  disconnect(input: { customerId: string }): Promise<boolean>;
  getSummary(input: { customerId: string }): Promise<IntegrationSummary | null>;
};

export class PosthogIntegrationError extends Error {
  constructor(public readonly detail: PosthogFault) { super(detail.kind); }
}

export type PosthogFault =
  | { kind: "auth_failed" }
  | { kind: "transient"; retryAfterSec: number | null }
  | { kind: "already_exists" }
  | { kind: "not_found" }
  | { kind: "upstream"; status: number; body: unknown };
```

```ts
// services/posthog/port.ts — inner RPC port, only the facade depends on it.
export type PosthogPort = {
  listRecentEvents(creds: PosthogCreds, opts: ListOpts): Promise<EventVolume[]>;
  reconcileDestination(
    creds: PosthogCreds,
    currentHogFunctionId: string | null,
    desired: DesiredFunctionState,
  ): Promise<{ hogFunctionId: string | null }>;
  verifyCredentials(creds: PosthogCreds): Promise<void>;
};

export type DesiredFunctionState =
  | { kind: "absent" }
  | { kind: "present"; webhookUrl: string; eventNames: string[]; customerId: string };
```

### Usage at the route layer

```ts
// functions/public/integration.ts (after)
const integrations = makePosthogIntegration(deps);

app.post("/connect", zValidator("json", connectBody), (c) =>
  reply(c, () => integrations.connect({ customerId: cid(c), ...c.req.valid("json") }), 201),
);

app.get("/events", zValidator("query", eventsQuery), (c) =>
  reply(c, () => integrations.listEvents({ customerId: cid(c), ...c.req.valid("query") }), 200),
);

app.post("/events/selection", zValidator("json", selectionBody), (c) =>
  reply(c, () => integrations.saveEvents({ customerId: cid(c), ...c.req.valid("json") }), 200),
);

app.delete("/", (c) =>
  reply(c, () => integrations.disconnect({ customerId: cid(c) }), 204),
);
```

`reply()` runs the action and pattern-matches `PosthogIntegrationError.detail` to HTTP status using ts-pattern's exhaustive `match`. Replaces today's `handleIntegrationAction` + `mapPosthogError` + `respondWithMappedError` + `integrationNotFound` quartet.

### What complexity moves behind the seam

- Row lookup, key decode, region→baseUrl map (`getPosthogIntegrationContext`).
- `syncHogFunctionFilters` — disabled-sentinel branch, create-on-first-save vs patch-existing.
- Hog template (`HOG_DESTINATION_SOURCE`, `HOG_INPUTS_SCHEMA`) — adapter-private; service no longer transitively imports it.
- Filter shape + HogQL string — adapter-private.
- Error normalisation — facade catches `PosthogAuthError` / `PosthogTransientError` / `PosthogApiError` / `IntegrationAlreadyExistsError` once and throws `PosthogIntegrationError` with a tagged `detail`.
- Event merge (`mergeStoredEventSelection`) and unique-name de-dup.

## Dependency Strategy

**Category: Ports & Adapters around a true-external service (PostHog SaaS).**

```
Routes
  └─► PosthogIntegrationPort (facade)         services/integration/posthog/
        ├─ owns: encryption, region map, sentinel, sync orchestration, error mapping
        └─► PosthogPort (RPC port)             services/posthog/
              ├─ httpPosthogAdapter            (production — current client.ts collapsed
              │                                 into 3 methods; zod-parses responses;
              │                                 classifies into typed errors)
              └─ inMemoryPosthogAdapter        (tests — Map<projectId, hogFn>; scriptable
                                                event catalogue; `simulate: "auth"|"transient"`
                                                flag for fault injection)
```

Wiring: `IntegrationDeps.posthog: PosthogClient` becomes `IntegrationDeps.posthog: PosthogPort`. The facade `makePosthogIntegration(deps)` consumes the port, repos, db, encryption codec, and `webhookBaseUrl`.

Webhook handler (`functions/posthog-webhook/handler.ts`) intentionally does **not** depend on the facade — it's the inbound side and only needs a repo lookup + `trackPosthogEvent`. Putting it through the facade would force the facade to grow an asymmetric inbound API.

## Testing Strategy

**New boundary tests (against the facade, in-memory adapter injected):**

- `connect` succeeds → integration row exists, hog function provisioned with template.
- `connect` with bad credentials → throws `PosthogIntegrationError({ kind: "auth_failed" })`; no row written.
- `connect` when one already exists → `{ kind: "already_exists" }`.
- `saveEvents` first time → creates hog function with the requested filters.
- `saveEvents` subsequent time → patches filters, no second create.
- `saveEvents` with empty list → applies the disabled-sentinel filter (assert via in-memory adapter state, not via mocked method calls).
- `saveEvents` during transient PostHog outage → `{ kind: "transient" }`; row + selection unchanged.
- `listEvents` merges stored selection with PostHog catalogue, dedupes by name.
- `disconnect` removes hog function and integration row; idempotent on second call.

**Adapter-level tests (much smaller surface):**

- `httpPosthogAdapter`: status code → typed error classification (401 → auth, 5xx → transient, 4xx → upstream), happy-path zod parse.

**Old tests to delete or rewrite:**

- `apps/server/__tests__/posthog-client.test.ts` — shrinks to ~50 LOC of adapter-level HTTP fixtures; the orchestration assertions move to the facade test.
- `apps/server/__tests__/integration-service.test.ts` — replaced by facade boundary tests; the per-method mocks of the PostHog client go away.
- `apps/server/__tests__/integration-routes.test.ts` — drops `instanceof` mock setup; keeps validator/auth tests only.

**Test environment needs:** none beyond the in-memory adapter (already in-process). PGLite covers the repo side per existing convention. Tests run via `sst shell -- bun test`.

## Implementation Recommendations

Durable architectural guidance, not coupled to current paths:

**The facade owns:**
- Translating customer-shaped intent (connect / saveEvents / listEvents / disconnect / getSummary) into PostHog-shaped operations.
- Persistence of the integration row and event-definition writes.
- Encryption + region resolution at the boundary between stored config and outbound calls.
- The disabled-sentinel and create-vs-patch decisions for the hog function.
- Mapping all underlying faults into a single `PosthogIntegrationError` discriminated by `detail.kind`.

**The facade hides:**
- That PostHog has a hog-function concept at all.
- The hog template source and inputs schema.
- The sentinel event name.
- HTTP transport, retries, and zod response parsing.
- Specific PostHog error class hierarchy.

**The facade exposes:**
- The five verbs above and one error class with a tagged `detail`.
- Nothing else. No PostHog types in its public surface beyond `region: "us" | "eu"` on connect input.

**The inner port (`PosthogPort`) owns:**
- One method per *intent* against PostHog (`reconcileDestination`, `listRecentEvents`, `verifyCredentials`), not one per HTTP endpoint.
- Adapter-level error classification.

**Caller migration:**
- Route handlers replace `try { … } catch (e) { mapPosthogError(e); … }` with `reply(c, () => integrations.<verb>(input), <status>)`.
- `IntegrationDeps` consumers stop importing `PosthogAuthError` etc.; they import `PosthogIntegrationError` if they need to introspect a fault, otherwise let it propagate.
- The webhook handler is unchanged.

**Escape hatch for non-route callers:**
- A future GC job, key-rotation worker, or admin tool that needs raw PostHog access goes around the facade and consumes `PosthogPort` directly. This is explicit, not a leak — those callers don't want HTTP-shaped error mapping.

**What is intentionally out of scope:**
- A generic `AnalyticsProviderPort` covering Segment/Mixpanel. Premature without a second concrete provider; revisit when v2 multi-provider work is committed. The shape above leaves room: a `ProviderPort` superinterface can be extracted from `PosthogIntegrationPort` later, grounded in two real callers rather than one.
- Identity-mismatch detection and webhook identity contract enforcement — covered separately by the existing `rfc-posthog-integration.md` v1.5/v2 plans.
- Event-definition repo/service deepening — covered by `rfc-event-definition-deepening.md`.
