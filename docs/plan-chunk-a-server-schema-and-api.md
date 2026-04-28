# Chunk A: Server — Push Token Schema + API Endpoints

## Context

We're implementing E2E push notifications. This chunk adds the push_token storage and two new public API endpoints the Expo app needs. The other chunks (onSend wiring, Expo app) depend on this work.

**Parallelism:** Can run in parallel with Chunk C (Expo app). Chunk B depends on the `pushToken` table this chunk creates.

## Codebase orientation

- **Schema**: `apps/server/db/schema.ts` — Drizzle ORM, all tables defined here. Uses `pgTable`, `pgEnum`, `relations()`. Exports inferred types like `type User = typeof user.$inferSelect`.
- **DB module**: `apps/server/db/index.ts` — creates drizzle client from Neon, re-exports all schema. Other files import from `../../db`.
- **Repository layer**: `apps/server/repository/public/public.ts` — data access functions (e.g. `findUserByExternalId`, `createUser`, `updateUserAttributes`). Uses `db` imported from `../../db`. Re-exported via `apps/server/repository/public/index.ts`.
- **Service layer**: `apps/server/services/public/public.ts` — business logic, calls repository functions. Re-exported via `apps/server/services/public/index.ts`.
- **Schemas (validation)**: `apps/server/schemas/public/public.ts` — Zod schemas for request validation. Re-exported via `apps/server/schemas/public/index.ts`.
- **Routes**: `apps/server/functions/public/index.ts` — Hono app, uses `zValidator("json", schema)` middleware. Has `getCustomerId(c)` helper for `x-customer-id` header. Exports `PublicAppType` for type-safe client.
- **Migrations**: generated via `bunx drizzle-kit generate` from `apps/server/` dir. Output goes to `apps/server/drizzle/`. Journal at `apps/server/drizzle/meta/_journal.json`.

## Changes

### 1. Add `pushToken` table to schema

**File: `apps/server/db/schema.ts`**

Add after the `event` table definition (~line 168):

```ts
export const pushToken = pgTable(
  "push_token",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    token: text("token").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [unique().on(table.userId, table.token)]
);
```

Update `userRelations` (~line 176) to add `pushTokens: many(pushToken)`.

Add push token relations:

```ts
export const pushTokenRelations = relations(pushToken, ({ one }) => ({
  user: one(user, {
    fields: [pushToken.userId],
    references: [user.id],
  }),
}));
```

Add type exports:

```ts
export type PushToken = typeof pushToken.$inferSelect;
export type NewPushToken = typeof pushToken.$inferInsert;
```

### 2. Generate migration

```
cd apps/server && bunx drizzle-kit generate
```

This will create `apps/server/drizzle/0004_*.sql` automatically.

### 3. Add Zod schema for push token registration

**File: `apps/server/schemas/public/public.ts`**

Add:

```ts
export const registerPushTokenSchema = z.object({
  token: z.string().min(1),
});
```

### 4. Add repository function for push token upsert

**File: `apps/server/repository/public/public.ts`**

Add import of `pushToken` from `../../db` (it's already re-exported via db/index.ts).

Add function:

```ts
export async function upsertPushToken(userId: string, token: string) {
  const [row] = await db
    .insert(pushToken)
    .values({ userId, token })
    .onConflictDoNothing()
    .returning();

  // If conflict (already exists), fetch the existing row
  if (!row) {
    const existing = await db.query.pushToken.findFirst({
      where: and(eq(pushToken.userId, userId), eq(pushToken.token, token)),
    });
    return existing!;
  }

  return row;
}
```

Will need to add `pushToken` to the existing destructured import from `../../db`.

### 5. Add service functions

**File: `apps/server/services/public/public.ts`**

Add two functions:

```ts
export async function registerPushToken(
  customerId: string,
  externalId: string,
  token: string
) {
  const foundUser = await repository.findUserByExternalId(customerId, externalId);
  if (!foundUser) return null;

  const pushToken = await repository.upsertPushToken(foundUser.id, token);

  return {
    id: pushToken.id,
    user_id: pushToken.userId,
    token: pushToken.token,
    created_at: pushToken.createdAt!.toISOString(),
  };
}

export async function getUser(customerId: string, externalId: string) {
  const foundUser = await repository.findUserByExternalId(customerId, externalId);
  if (!foundUser) return null;

  return {
    id: foundUser.id,
    external_id: foundUser.externalId,
    phone: foundUser.phone,
    gender: foundUser.gender,
    attributes: foundUser.attributes,
    created_at: foundUser.createdAt!.toISOString(),
  };
}
```

### 6. Add route handlers

**File: `apps/server/functions/public/index.ts`**

Add import of `registerPushTokenSchema` to the schemas import.

Add two routes to the chain (before the closing `);` of the routes const):

```ts
.get("/v1/users/:external_id", async (c) => {
  const customerId = getCustomerId(c);
  const externalId = c.req.param("external_id");

  const result = await service.getUser(customerId, externalId);

  if (!result) {
    return c.json(
      {
        error: {
          code: "user_not_found",
          message: `No user found with external_id '${externalId}'`,
        },
      },
      404
    );
  }

  return c.json(result, 200);
})
.post(
  "/v1/users/:external_id/push-tokens",
  zValidator("json", registerPushTokenSchema),
  async (c) => {
    const customerId = getCustomerId(c);
    const externalId = c.req.param("external_id");
    const { token } = c.req.valid("json");

    const result = await service.registerPushToken(customerId, externalId, token);

    if (!result) {
      return c.json(
        {
          error: {
            code: "user_not_found",
            message: `No user found with external_id '${externalId}'`,
          },
        },
        404
      );
    }

    return c.json(result, 201);
  }
)
```

## Verification

1. `cd apps/server && bunx drizzle-kit generate` — migration file appears
2. `sst shell -- bun test` — existing tests still pass
3. Type check: `cd apps/server && bunx tsc --noEmit` (if tsconfig exists)
