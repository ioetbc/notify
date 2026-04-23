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
| `attributes` | object | Yes | Key-value pairs to set on the user. Values must be `string`, `number`, or `boolean`. |

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
- Attributes are merged (not replaced) -- existing attributes not in the request are preserved
- Attributes are stored as a JSONB column on the `user` table
- Values validated as `string | number | boolean` via Zod
- Returns 404 if user with `external_id` doesn't exist

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
| `properties` | object | No | Event-specific data (stored as JSONB) |
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
- System finds all active workflows where `trigger_event` matches the event name (simple string match)
- Creates `workflow_enrollment` records for matching workflows (skips if user already enrolled via unique constraint)
- Returns 202 immediately
- Returns 404 if user with `external_id` doesn't exist

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

## Authentication

MVP stub: all requests must include an `X-Customer-Id` header with the customer UUID. The frontend sends this automatically via a hardcoded constant (`00000000-0000-0000-0000-000000000001`). Will be replaced with API key-based auth (`customer.api_key` column exists).

---

## Schema Changes Required

### New: `event` table

Stores every event received per user.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `customer_id` | UUID | FK to `customer` |
| `user_id` | UUID | FK to `user` |
| `event_name` | TEXT | Event name (e.g., `purchase_completed`) |
| `properties` | JSONB | Event-specific data |
| `timestamp` | TIMESTAMPTZ | When the event occurred |
| `created_at` | TIMESTAMPTZ | When we received it |

### Change: `workflow.trigger_event`

Convert from `trigger_event` enum (`contact_added`, `contact_updated`, `event_received`) to `TEXT` to support customer-defined event names like `purchase_completed`.
