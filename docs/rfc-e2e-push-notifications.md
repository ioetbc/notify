# RFC: E2E Push Notification Delivery

## Goal

Send a real push notification to a physical device, end-to-end. This proves out the full pipeline: Expo app registers a push token, user update triggers workflow enrollment, the walker processes the enrollment, and Expo's Push API delivers the notification.

## E2E Sequence

1. Open the Expo demo app on a physical device
2. App requests notification permissions, gets an `ExponentPushToken[...]`
3. App calls `POST /v1/users` to register the user (or already registered from a previous launch)
4. App calls `POST /v1/users/:external_id/push-tokens` to store the push token
5. App shows a settings screen with the user's details fetched from `GET /v1/users/:external_id`
6. User changes their name on the settings screen -> app calls `PATCH /v1/users/:external_id` with new attributes
7. The PATCH triggers enrollment into any active workflow with `user_updated` trigger
8. Manually call `POST /enrollments/process` on the admin API (simulating the future cron)
9. The walker hits the Send step, `onSend` looks up push tokens from the DB and calls Expo's Push API
10. Notification appears on the device

## Changes Required

### 1. New `push_token` table + migration

```
push_token
  id            uuid PK
  user_id       uuid FK -> user (cascade delete)
  token         text NOT NULL
  created_at    timestamptz
```

- Unique constraint on `(user_id, token)` so the same device doesn't create duplicates
- A user can have multiple tokens (multiple devices)
- Relations: user has many push_tokens, push_token belongs to user

### 2. New public API endpoint: register push token

`POST /v1/users/:external_id/push-tokens`

```json
{ "token": "ExponentPushToken[xxxxxx]" }
```

- Looks up user by `external_id` + `x-customer-id`
- Upserts into `push_token` table (if token already exists for this user, no-op)
- Returns 201 with the push token record

### 3. New public API endpoint: get user

`GET /v1/users/:external_id`

- Returns user details (id, external_id, phone, gender, attributes)
- The Expo app needs this to display the settings screen

### 4. Wire `onSend` to Expo Push API

In `server/functions/admin/index.ts`, replace the no-op `onSend` with a real handler:

```ts
onSend: async ({ userId, config }) => {
  // 1. Query push_token table for all tokens belonging to userId
  // 2. Build Expo push messages: { to, title, body }
  // 3. Send via expo-server-sdk-node
}
```

Uses `expo-server-sdk` package. No batching needed for the demo — we'll send one message per token.

### 5. Bare-bones Expo app

Location: `/really-simple-app` at the project root.

The app already exists. built by running this: `bun create expo --template default@sdk-55` I have not changed anything. Bare expo - react native app.

- **Home/Settings screen**: Fetches user details from `GET /v1/users/:external_id`, shows name/attributes, has a text input to change name. Calls `PATCH /v1/users/:external_id` on save.
- On mount: requests notification permissions, gets push token, calls `POST /v1/users/:external_id/push-tokens`.

Hardcoded values for the demo:
- `X-Customer-Id` header (the seeded test customer)
- `external_id` (a known test user)
- Public API base URL (the deployed Lambda)

### 6. New dependency

Add `expo-server-sdk` to `server/package.json`.

## What This Does NOT Include

- Expo receipt polling (checking delivery status)
- Token invalidation (removing stale tokens)
- Batching sends
- Authentication / API key validation
- Deep links in notifications

## Pre-requisites

- An active workflow in the DB with `trigger_event: "user_updated"` and a Send step
- A seeded test customer
- Physical device with Expo Go or a dev build
