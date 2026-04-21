# Customer Integration API Design

## Overview

These are the APIs that customers integrate into their apps to update user attributes and track events. Events are the primary trigger mechanism for workflows.

---

## Endpoints

### 1. Update User Attributes

Updates attributes for an existing user. Attributes are used for segmentation and branch conditions in workflows.

```
PATCH /v1/users/:external_id
```

**Request:**
```json
{
  "attributes": {
    "plan": "pro",
    "lifetime_value": 299.00,
    "is_verified": true
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `attributes` | object | Yes | Key-value pairs to set on the user |

**Response (200 OK):**
```json
{
  "id": "usr_7f3b2a1e-4c5d-6e7f-8a9b-0c1d2e3f4a5b",
  "external_id": "user_abc123",
  "attributes": {
    "plan": "pro",
    "signup_source": "organic",
    "lifetime_value": 299.00,
    "is_verified": true
  },
  "updated_at": "2024-01-15T14:00:00Z"
}
```

**Behavior:**
- Attributes are merged (not replaced) — existing attributes not in the request are preserved
- Attribute values can be: string, number, or boolean
- Setting a value to `null` removes that attribute

---

### 2. Track Event

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
- System finds all active workflows where `trigger_event` matches the event name
- Creates `workflow_enrollment` records for matching workflows
- Returns 202 immediately (processing is async)

**Event name format:**
- Lowercase alphanumeric with underscores
- Examples: `purchase_completed`, `user_signed_up`, `item_added_to_cart`

---

## Error Responses

All errors follow a consistent format:

```json
{
  "error": {
    "code": "user_not_found",
    "message": "No user found with external_id 'user_abc123'"
  }
}
```

**Error codes:**

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `user_not_found` | 404 | User with external_id doesn't exist |
| `invalid_event_name` | 400 | Event name contains invalid characters |
| `invalid_request` | 400 | Request body is malformed |
| `internal_error` | 500 | Something went wrong on our end |

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

### New: `platform` enum

```sql
CREATE TYPE platform AS ENUM ('ios', 'android');
```

### Update: `user` table

```sql
ALTER TABLE "user" ADD COLUMN push_token TEXT;
ALTER TABLE "user" ADD COLUMN platform platform;
ALTER TABLE "user" ADD COLUMN token_updated_at TIMESTAMPTZ;
```

### Update: `workflow.trigger_event`

Currently uses enum `trigger_event` with hardcoded values: `contact_added`, `contact_updated`, `event_received`.

**Change:** Convert to TEXT to allow customer-defined event names.

```sql
-- Drop the enum constraint and use TEXT
ALTER TABLE workflow ALTER COLUMN trigger_event TYPE TEXT;
DROP TYPE trigger_event;
```

---

## Implementation Priority

1. **Migration** — Add `event` table, `platform` enum, update `user` table, convert `trigger_event` to TEXT
2. **PATCH /v1/users/:external_id** — Update user attributes
3. **POST /v1/events** — Event tracking + workflow enrollment triggering
