# PostHog Integration — Parallel Implementation Plans

Source RFC: [`docs/rfc-posthog-integration.md`](../rfc-posthog-integration.md). Read it first.

The v1 work is split into one prerequisite chunk and four parallel chunks. Each plan is scoped to a distinct set of files so agents can work simultaneously without touching the same code.

## Execution order

```
                ┌──────────────────────────┐
                │ 0. schema-and-repository │   (must land first, ~1 agent)
                └─────────────┬────────────┘
                              │
        ┌─────────────────────┼─────────────────────┬──────────────────────┐
        ▼                     ▼                     ▼                      ▼
 ┌────────────────┐  ┌──────────────────┐  ┌──────────────────┐  ┌────────────────────┐
 │ A. posthog-    │  │ B. connect-flow  │  │ C. inbound-      │  │ D. client-ui       │
 │    client      │  │    api           │  │    webhook       │  │                    │
 └────────────────┘  └──────────────────┘  └──────────────────┘  └────────────────────┘
        ▲                     │                     │                      │
        └─────────────────────┘                     │                      │
                              (B imports A)         │                      │
                                                    └──────────────────────┘
                                                       (D consumes B & C contracts only)
```

- **Chunk 0** is the only blocker. It adds the `customer_integration` table and repository module; everything else depends on those exports being available.
- **Chunks A, B, C, D** can run in parallel after Chunk 0 lands. They have explicit file ownership and contract-only dependencies between each other.
- Out-of-scope for v1: idempotency, DLQ tooling, key rotation, cohorts, feature flags, historical backfill, OAuth. See the RFC's v1.5 / v2 backlog.

## Plans

| # | Plan | Layer | Owns |
|---|------|-------|------|
| 0 | [schema-and-repository.md](./schema-and-repository.md) | DB | `apps/server/db/schema.ts`, `apps/server/drizzle/*`, `apps/server/repository/integration/` |
| A | [posthog-client.md](./posthog-client.md) | Backend (pure) | `apps/server/services/posthog/` |
| B | [connect-flow-api.md](./connect-flow-api.md) | Backend | `apps/server/services/integration/`, `apps/server/functions/public/integration.ts` |
| C | [inbound-webhook.md](./inbound-webhook.md) | Backend | `apps/server/functions/posthog-webhook/`, HMAC verify utility |
| D | [client-ui.md](./client-ui.md) | Frontend | `apps/client/src/pages/integrations/`, related components |

## Shared contracts (do not modify outside Chunk 0)

- The `customer_integration` table shape and the Zod schema for its `config` JSON field, both defined in `apps/server/db/schema.ts`.
- The `IntegrationRepository` interface in `apps/server/repository/integration/`.

If you need a change to either, raise it in the RFC and update Chunk 0 first.

## Conventions

- Every chunk updates its own design doc before writing code (per project convention: docs before code).
- Every chunk lands behind a feature flag if exposed to customers; v1 is internal-only until all four chunks are merged.
- Tests run via `sst shell -- bun test`.
- Use `ts-pattern` for any branching on provider type or status enums.
