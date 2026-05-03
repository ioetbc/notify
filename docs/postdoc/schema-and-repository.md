# Chunk 0 — Schema and Repository

**Prerequisite for all other chunks.** Must land before A, B, C, D start.

## Goal

Add the `customer_integration` table, its Drizzle migration, the Zod config schema for PostHog, and a thin repository module the rest of the codebase will use to read/write integration rows.

## Owns these files (creates or modifies)

- `apps/server/db/schema.ts` — add `customerIntegration` table, `integrationProviderEnum`, `PosthogIntegrationConfigSchema`, exported types and relations
- `apps/server/drizzle/<next>_<name>.sql` — generated migration
- `apps/server/drizzle/meta/<next>_snapshot.json` — generated snapshot
- `apps/server/repository/integration/index.ts` — module barrel
- `apps/server/repository/integration/integration.ts` — repository functions
- `apps/server/__tests__/integration-repository.test.ts` — happy-path tests against a real DB (per project convention, no mocks)

## Does NOT touch

- Any existing table.
- Any function in `apps/server/functions/`.
- Any service outside `repository/integration/`.

## Schema additions to `db/schema.ts`

```ts
export const integrationProviderEnum = pgEnum("integration_provider", ["posthog"]);

export const PosthogIntegrationConfigSchema = z.object({
  personal_api_key_encrypted: z.string(),
  project_id: z.string(),
  hog_function_id: z.string().nullable(),    // null between row insert and hog function creation
  webhook_secret_encrypted: z.string(),
});

export type PosthogIntegrationConfig = z.infer<typeof PosthogIntegrationConfigSchema>;

export type IntegrationConfig = PosthogIntegrationConfig; // union when more providers land

export const customerIntegration = pgTable(
  "customer_integration",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customer.id, { onDelete: "cascade" }),
    provider: integrationProviderEnum("provider").notNull(),
    config: jsonb("config").$type<IntegrationConfig>().notNull(),
    connectedAt: timestamp("connected_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [unique().on(table.customerId, table.provider)]
);

export type CustomerIntegration = typeof customerIntegration.$inferSelect;
export type NewCustomerIntegration = typeof customerIntegration.$inferInsert;
```

Add a `customerRelations` entry for `integrations: many(customerIntegration)` and the inverse relation back to `customer`.

## Repository contract

`apps/server/repository/integration/integration.ts` exports:

```ts
findByCustomerAndProvider(customerId: string, provider: "posthog"): Promise<CustomerIntegration | null>
create(input: { customerId: string; provider: "posthog"; config: PosthogIntegrationConfig }): Promise<CustomerIntegration>
updateConfig(id: string, config: PosthogIntegrationConfig): Promise<CustomerIntegration>
deleteIntegration(id: string): Promise<void>   // `delete` is a reserved word, so the export is renamed
```

All functions take a Drizzle DB instance as the first argument (matching the existing repository style — check `apps/server/repository/public/public.ts` for the pattern). Do not import the DB singleton inside the repository.

## Encryption decision

Encryption-at-rest is out of scope for this chunk. Store the values as the column says (`*_encrypted`) but **for v1 implementation, write them as base64-encoded plaintext** with a `TODO(encryption):` comment. A follow-up chunk will swap the codec for real encryption (KMS or libsodium) without changing the schema.

This deliberate punt is documented here so reviewers don't flag it as a security oversight. Do **not** ship the integration to customers until real encryption is added.

## Migration

Run `bun drizzle-kit generate` (or whatever the project uses — check `apps/server/drizzle.config.ts`). Commit both the SQL and snapshot.

## Tests

- `create` round-trips a row.
- `findByCustomerAndProvider` returns null for a customer with no integration.
- `(customerId, provider)` uniqueness is enforced (second `create` for the same pair throws).
- `updateConfig` overwrites cleanly.
- `delete` removes the row.
- `customer` cascade delete also removes integration rows.

Tests run via `sst shell -- bun test` against the dev DB.

## Acceptance

- Migration applies cleanly on a fresh DB.
- `bun tsc --noEmit` passes.
- All new tests pass.
- No changes to existing tables or any file outside the "Owns" list.
