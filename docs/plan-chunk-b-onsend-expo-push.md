# Chunk B: Wire onSend to Expo Push API

## Context

We're implementing E2E push notifications. This chunk replaces the no-op `onSend` callback in the enrollment walker with a real implementation that sends push notifications via Expo's Push API.

**Parallelism:** Depends on Chunk A (needs the `pushToken` table in the schema). Should run after Chunk A, or merge after it.

## Codebase orientation

- **Admin API**: `apps/server/functions/admin/index.ts` — Hono app for admin endpoints. Creates an `EnrollmentWalker` instance with `onSend: async () => {}` (the no-op we're replacing). Imports `db` from `../../db`.
- **EnrollmentWalker**: `apps/server/services/enrollment/enrollment.ts` — the `onSend` callback receives `{ userId: string, enrollmentId: string, stepId: string, config: { title: string, body: string } }`.
- **Schema**: `apps/server/db/schema.ts` — after Chunk A runs, will export `pushToken` table. Import it from `../../db`.
- **DB module**: `apps/server/db/index.ts` — re-exports everything from schema. Uses Neon serverless PostgreSQL.
- **Package**: `apps/server/package.json` — needs `expo-server-sdk` added as dependency.

## Changes

### 1. Install expo-server-sdk

```
cd apps/server && bun add expo-server-sdk
```

### 2. Replace onSend in admin/index.ts

**File: `apps/server/functions/admin/index.ts`**

Current code (lines 1-11):
```ts
import { Hono } from "hono";
import { handle } from "hono/aws-lambda";
import { db, user, event } from "../../db";
import { eq, sql } from "drizzle-orm";
import { workflows } from "./workflows";
import { EnrollmentWalker } from "../../services/enrollment";

const walker = new EnrollmentWalker({
  db,
  onSend: async () => {},
});
```

Replace with:
```ts
import { Hono } from "hono";
import { handle } from "hono/aws-lambda";
import { db, user, event, pushToken } from "../../db";
import { eq, sql } from "drizzle-orm";
import { workflows } from "./workflows";
import { EnrollmentWalker } from "../../services/enrollment";
import Expo from "expo-server-sdk";

const expo = new Expo();

const walker = new EnrollmentWalker({
  db,
  onSend: async ({ userId, config }) => {
    const tokens = await db
      .select()
      .from(pushToken)
      .where(eq(pushToken.userId, userId));

    if (tokens.length === 0) return;

    const messages = tokens
      .filter((t) => Expo.isExpoPushToken(t.token))
      .map((t) => ({
        to: t.token,
        title: config.title,
        body: config.body,
      }));

    if (messages.length === 0) return;

    await expo.sendPushNotificationsAsync(messages);
  },
});
```

Key details:
- Filter tokens through `Expo.isExpoPushToken()` to skip invalid tokens
- No batching needed for demo — `sendPushNotificationsAsync` handles chunks internally
- No receipt polling (out of scope per RFC)

## Verification

1. `cd apps/server && bunx tsc --noEmit` — types check (requires Chunk A's schema changes)
2. `sst shell -- bun test` — existing tests still pass
3. End-to-end: after deploying, trigger an enrollment for a user with a push token, call `POST /enrollments/process`, verify notification arrives on device
