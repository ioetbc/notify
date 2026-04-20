# Customer Integration API Design

## Overview

These are the APIs that customers integrate into their apps to register users and track events. The integration is minimal by design — customers fire events, we handle everything else.

---

## Authentication

All requests require an API key passed in the `Authorization` header:

```
Authorization: Bearer nfy_live_abc123...
```

**Key format:**
- Live keys: `nfy_live_<32 random chars>`
- Test keys: `nfy_test_<32 random chars>`

Test keys work identically but don't send real push notifications — useful for development.

**Key storage:** The `api_key` column on the `customer` table (already exists).

---

## Endpoints

### 1. Register User

Registers an end user with their push token. Called when:
- User grants notification permissions for the first time
- Push token refreshes (Expo tokens can change)

```
POST /v1/users
```

**Request:**
```json
{
  "external_id": "user_abc123",
  "push_token": "ExponentPushToken[xxxxxxxxxxxxxx]",
  "platform": "ios",
  "attributes": {
    "plan": "free",
    "signup_source": "organic"
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `external_id` | string | Yes | Customer's internal user ID |
| `push_token` | string | Yes | Expo push token from device |
| `platform` | string | No | `ios` or `android` (auto-detected from token if omitted) |
| `attributes` | object | No | Custom user attributes for segmentation |

**Response (201 Created):**
```json
{
  "id": "usr_7f3b2a1e-4c5d-6e7f-8a9b-0c1d2e3f4a5b",
  "external_id": "user_abc123",
  "push_token": "ExponentPushToken[xxxxxxxxxxxxxx]",
  "platform": "ios",
  "created_at": "2024-01-15T10:30:00Z"
}
```

**Response (200 OK) — if user already exists:**
```json
{
  "id": "usr_7f3b2a1e-4c5d-6e7f-8a9b-0c1d2e3f4a5b",
  "external_id": "user_abc123",
  "push_token": "ExponentPushToken[xxxxxxxxxxxxxx]",
  "platform": "ios",
  "updated_at": "2024-01-15T12:45:00Z"
}
```

**Behavior:**
- If `external_id` exists for this customer, update the push token and attributes
- If `external_id` is new, create a new user record
- Attributes are merged (not replaced) on update

---

### 2. Update User Attributes

Updates attributes for an existing user without requiring the push token.

```
PATCH /v1/users/:external_id
```

**Request:**
```json
{
  "attributes": {
    "plan": "pro",
    "lifetime_value": 299.00
  }
}
```

**Response (200 OK):**
```json
{
  "id": "usr_7f3b2a1e-4c5d-6e7f-8a9b-0c1d2e3f4a5b",
  "external_id": "user_abc123",
  "attributes": {
    "plan": "pro",
    "signup_source": "organic",
    "lifetime_value": 299.00
  },
  "updated_at": "2024-01-15T14:00:00Z"
}
```

---

### 3. Track Event

Records an event for a user. This is the primary trigger mechanism for workflows.

```
POST /v1/events
```

**Request:**
```json
{
  "external_id": "user_abc123",
  "event": "purchase_completed",
  "properties": {
    "plan": "pro",
    "amount": 49.00,
    "currency": "USD"
  },
  "timestamp": "2024-01-15T10:30:00Z"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `external_id` | string | Yes | Customer's internal user ID |
| `event` | string | Yes | Event name (e.g., `purchase_completed`) |
| `properties` | object | No | Event-specific data |
| `timestamp` | string | No | ISO 8601 timestamp (defaults to now) |

**Response (202 Accepted):**
```json
{
  "id": "evt_9a8b7c6d-5e4f-3a2b-1c0d-9e8f7a6b5c4d",
  "event": "purchase_completed",
  "external_id": "user_abc123",
  "received_at": "2024-01-15T10:30:01Z",
  "workflows_triggered": 2
}
```

**Behavior:**
- Event is logged to the `event` table
- System finds all active workflows where `trigger_event` matches
- Creates `workflow_enrollment` records for matching workflows
- Returns 202 immediately (processing is async)

**Reserved event names:**
- `$user_created` — auto-fired when a new user is registered
- `$token_updated` — auto-fired when push token changes

---

### 4. Batch Events

Track multiple events in a single request (max 100 per batch).

```
POST /v1/events/batch
```

**Request:**
```json
{
  "events": [
    {
      "external_id": "user_abc123",
      "event": "page_viewed",
      "properties": { "page": "/settings" }
    },
    {
      "external_id": "user_def456",
      "event": "purchase_completed",
      "properties": { "amount": 29.00 }
    }
  ]
}
```

**Response (202 Accepted):**
```json
{
  "accepted": 2,
  "failed": 0,
  "errors": []
}
```

---

### 5. Delete User (GDPR)

Permanently deletes a user and all associated data.

```
DELETE /v1/users/:external_id
```

**Response (204 No Content)**

---

## Error Responses

All errors follow a consistent format:

```json
{
  "error": {
    "code": "invalid_push_token",
    "message": "The push token provided is not a valid Expo push token",
    "param": "push_token"
  }
}
```

**Error codes:**

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `invalid_api_key` | 401 | API key missing or invalid |
| `invalid_push_token` | 400 | Push token format invalid |
| `user_not_found` | 404 | User with external_id doesn't exist |
| `invalid_event_name` | 400 | Event name contains invalid characters |
| `rate_limit_exceeded` | 429 | Too many requests |
| `internal_error` | 500 | Something went wrong on our end |

---

## Rate Limits

| Endpoint | Limit |
|----------|-------|
| `POST /v1/users` | 100 req/sec per customer |
| `PATCH /v1/users/:id` | 100 req/sec per customer |
| `POST /v1/events` | 1,000 req/sec per customer |
| `POST /v1/events/batch` | 100 req/sec per customer |

Rate limit headers included in all responses:
```
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 987
X-RateLimit-Reset: 1705312800
```

---

## Database Schema Changes Required

### New: `event` table

```sql
CREATE TABLE event (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES customer(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    event_name TEXT NOT NULL,
    properties JSONB,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_event_user_id ON event(user_id);
CREATE INDEX idx_event_customer_event ON event(customer_id, event_name);
CREATE INDEX idx_event_timestamp ON event(timestamp);
```

### Update: `user` table

```sql
ALTER TABLE "user" ADD COLUMN push_token TEXT;
ALTER TABLE "user" ADD COLUMN platform TEXT CHECK (platform IN ('ios', 'android'));
ALTER TABLE "user" ADD COLUMN token_updated_at TIMESTAMPTZ;
```

### Update: `trigger_event` enum

Currently hardcoded to: `contact_added`, `contact_updated`, `event_received`

Should be dynamic — customers define their own event names. Options:
1. Remove enum, use TEXT for `workflow.trigger_event`
2. Store custom events in a `customer_event` table

**Recommendation:** Use TEXT, validate format only (alphanumeric + underscores).

---

## SDK Examples

### React Native / Expo

```javascript
import * as Notifications from 'expo-notifications';

// On app startup
async function registerForPushNotifications() {
  const { status } = await Notifications.requestPermissionsAsync();
  if (status !== 'granted') return;

  const token = (await Notifications.getExpoPushTokenAsync()).data;

  await fetch('https://api.notify.dev/v1/users', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer nfy_live_xxx',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      external_id: currentUser.id,
      push_token: token,
    }),
  });
}

// Track events
async function trackEvent(event, properties = {}) {
  await fetch('https://api.notify.dev/v1/events', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer nfy_live_xxx',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      external_id: currentUser.id,
      event,
      properties,
    }),
  });
}

// Usage
trackEvent('purchase_completed', { plan: 'pro', amount: 49.00 });
```

### Node.js (Backend)

```javascript
const notify = require('@notify/node')('nfy_live_xxx');

// Track server-side events
await notify.events.track({
  externalId: 'user_abc123',
  event: 'subscription_cancelled',
  properties: {
    reason: 'too_expensive',
    mrr_lost: 49.00,
  },
});
```

---

## Implementation Priority

1. **Migration** — Add `event` table, update `user` table
2. **Auth middleware** — Validate API keys, attach customer to request
3. **POST /v1/users** — User registration with push tokens
4. **POST /v1/events** — Event tracking (without workflow triggering first)
5. **Workflow triggering** — Connect events to workflow enrollment
