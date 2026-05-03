# RFC: Deepening the Event-Definition Module

## Problem

The PostHog integration writes to `event_definitions` from two service-layer paths with no shared owner of the `active` flag:

- **Ingest path** — `apps/server/services/public/public.ts:199-227` calls `upsertSeenPosthogEvent` in `apps/server/repository/event-definition/event-definition.ts` for every webhook event. Currently upserts with `active: false`.
- **Selection path** — `apps/server/services/integration/integration.ts:140-180` calls `setPosthogEventSelection`, which sets every row for the integration to `active=false` then upserts the user's picks to `active=true`.

The invariant "`active = user-selected`" is enforced only by convention. Because both paths share a primary key on `(integration_id, event_name)` and both can write `active`, a high-volume webhook can race a user-save and demote a freshly-selected row, or an upsert collision can clobber selection state. The repository is shallow: each function is a thin wrapper over a single SQL statement, but the rule that ties them together lives in nobody's file.

Tests reflect the friction. `integration-service.test.ts` mocks `setPosthogEventSelection`; `posthog-webhook-handler.test.ts` stubs `trackPosthogEvent` end-to-end. Neither exercises the dual-write boundary against a real DB. `event-definition-repository.test.ts` covers each function individually but not the interaction.

This makes the seam hard to navigate (you bounce between three files to understand the lifecycle of a single row) and hard to test (the bug class — ingest demoting a selected row — has no boundary test that would catch it).

## Proposed Interface

A single deepened module dispatches all event-definition operations through one entry point with a discriminated command union:

```ts
// repository/event-definition/event-definition.ts

import type { Db } from "../../db";

export type EventDefinitionCommand =
  | {
      kind: "recordSeen";
      customerId: string;
      integrationId: string;
      provider: "posthog";
      eventName: string;
      volume?: number | null;
    }
  | {
      kind: "replaceSelection";
      customerId: string;
      integrationId: string;
      provider: "posthog";
      events: ReadonlyArray<{ name: string; volume?: number | null }>;
    }
  | {
      kind: "listForIntegration";
      integrationId: string;
    }
  | {
      kind: "listActiveNames";
      customerId: string;
    };

export type EventDefinitionResult =
  | { kind: "recordSeen"; id: string; active: boolean }
  | { kind: "replaceSelection"; activated: string[] }
  | {
      kind: "listForIntegration";
      rows: ReadonlyArray<{
        name: string;
        active: boolean;
        volume: number | null;
      }>;
    }
  | { kind: "listActiveNames"; names: string[] };

export interface EventDefinitionRepo {
  run<C extends EventDefinitionCommand>(
    cmd: C,
  ): Promise<Extract<EventDefinitionResult, { kind: C["kind"] }>>;
}

export function createEventDefinitionRepo(db: Db): EventDefinitionRepo;
```

### Usage

Ingest, in `services/public/public.ts`:

```ts
const def = await deps.eventDefinitions.run({
  kind: "recordSeen",
  customerId,
  integrationId,
  provider: "posthog",
  eventName,
});
```

Selection, in `services/integration/integration.ts`:

```ts
await deps.eventDefinitions.run({
  kind: "replaceSelection",
  customerId: input.customerId,
  integrationId: context.row.id,
  provider: "posthog",
  events: input.events,
});
```

Trigger evaluation:

```ts
const { names } = await deps.eventDefinitions.run({
  kind: "listActiveNames",
  customerId,
});
```

UI list merge:

```ts
const { rows } = await deps.eventDefinitions.run({
  kind: "listForIntegration",
  integrationId,
});
```

### Hidden complexity

- **`recordSeen` never writes `active`.** Implemented as `INSERT ... ON CONFLICT (integration_id, event_name) DO UPDATE SET last_seen_at = now(), volume = coalesce(EXCLUDED.volume, event_definitions.volume)`. The conflict-target update clause omits `active` entirely, and on insert the column default (`false`) applies. High-volume webhook traffic cannot demote a selected row.
- **`replaceSelection` is one transaction.** `UPDATE active = false WHERE integration_id = $1 AND event_name <> ALL($2)` followed by `INSERT ... ON CONFLICT DO UPDATE SET active = true, volume = EXCLUDED.volume`. No observer ever sees an interval where a still-selected row is briefly inactive.
- **Exhaustive dispatch.** The `run` impl uses `ts-pattern` to match on `cmd.kind`, satisfying the project preference for exhaustive matching.
- **Provider tag is part of the command.** When a second provider (Segment, Stripe) lands, the union grows; existing call sites are unaffected because the discriminator is required at construction.

## Dependency Strategy

**Local-substitutable.** `createEventDefinitionRepo(db)` closes over a Drizzle `Db` handle and returns the `EventDefinitionRepo` interface. Production wires the real DB; tests pass a PGLite (or equivalent local stand-in) instance via the existing `createTestDb` harness. No mocking — the deepened module is exercised against the same Postgres-compatible substrate it uses in production. The factory is wired once into `IntegrationDeps` and into the public-service deps used by the webhook handler.

## Testing Strategy

**New boundary tests** (against PGLite, in `apps/server/__tests__/event-definition-repo.test.ts`):

- `recordSeen` for a new `(integrationId, eventName)` inserts with `active = false`.
- `recordSeen` for an existing row updates `last_seen_at` and `volume` but **does not** modify `active`. Seed a row with `active = true`, call `recordSeen`, assert `active` is still `true`.
- Concurrent `recordSeen` calls for the same key converge to a single row (idempotency).
- `replaceSelection` with a non-empty list activates exactly the supplied names and deactivates everything else for the integration, atomically.
- `replaceSelection` with an empty list deactivates all rows for the integration.
- `replaceSelection` interleaved with `recordSeen` (ingest racing user save): the post-condition reflects the selection's intent — selected rows stay `active = true` regardless of ingest order.
- `listActiveNames` returns only `active = true` rows scoped to the customer.
- `listForIntegration` returns all rows with their current `active` and `volume`.

**Old tests to delete or replace:**

- `apps/server/__tests__/event-definition-repository.test.ts` — the per-function unit tests are superseded by boundary tests above. Delete after migration.
- The `setPosthogEventSelection` mock in `apps/server/__tests__/integration-service.test.ts` — replace with a real `EventDefinitionRepo` against PGLite, or a hand-rolled in-memory implementation of the `EventDefinitionRepo` interface that preserves the same invariants (active-write only on `replaceSelection`).
- The `trackPosthogEvent` stub in `apps/server/__tests__/posthog-webhook-handler.test.ts` no longer needs to mock event-definition writes; it can let them run through the real repo.

**Test environment needs:** the PGLite (or local Postgres) harness already in place for `event-definition-repository.test.ts`. No new infrastructure.

## Implementation Recommendations

**Responsibilities the module should own:**

- All reads and writes against `event_definitions`.
- The invariant that only `replaceSelection` writes the `active` column.
- The atomicity of selection replacement.
- The idempotency of `recordSeen`.
- The mapping from a typed command to the underlying SQL.

**Implementation details the module should hide:**

- SQL statements, conflict-target clauses, and the column-level write discipline that enforces the `active`-writer rule.
- Transaction boundaries for `replaceSelection`.
- The shape of partial updates on conflict (which columns get coalesced, which are left untouched).
- The default value of `active` on insert.

**The interface contract the module should expose:**

- A single `run(cmd)` method whose return type is derived from the command's `kind`.
- A factory `createEventDefinitionRepo(db)` that closes over the database handle.
- A discriminated `EventDefinitionCommand` union and a matching `EventDefinitionResult` union — both exhaustive, both extended via new variants when new operations are added.

**Caller migration:**

1. Add `createEventDefinitionRepo` and the command/result unions to `repository/event-definition/event-definition.ts`. Keep the existing `upsertSeenPosthogEvent` / `setPosthogEventSelection` / `listEventSelectionByIntegration` / `listActiveEventNames` functions in place during migration.
2. Wire `eventDefinitions: EventDefinitionRepo` into `IntegrationDeps` (`apps/server/services/integration/integration.ts:59-75`) and into the deps object used by `services/public/public.ts`. Construct it once in `functions/public/integration.ts` (next to `makeDeps`) and in `functions/posthog-webhook/handler.ts`.
3. Replace the call site in `services/public/public.ts:199-227` with `deps.eventDefinitions.run({ kind: "recordSeen", ... })`. Drop the row-id log line, or replace it with `def.id` from the typed result.
4. Replace the call sites in `services/integration/integration.ts` (`saveEventSelection`, `listEvents`, and any active-name reader) with the corresponding `run({ kind: ... })` calls.
5. Write the new boundary tests against PGLite. Delete the superseded per-function tests once the new suite is green.
6. Remove `upsertSeenPosthogEvent`, `setPosthogEventSelection`, `listEventSelectionByIntegration`, and `listActiveEventNames` from the repo file. Their bodies move into the `run` dispatcher.

**Future provider work:** when a second provider lands, extend the `provider` union and add provider-specific branches inside `run` only if the SQL diverges. The call-site shape does not change — callers always construct a command with a `provider` discriminator.
