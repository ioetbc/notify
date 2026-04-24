# Public API

Base URL: `https://nvrt6uv3caioemxhcqxtczzjni0ptvsj.lambda-url.eu-north-1.on.aws`

All requests require the `X-Customer-Id` header.

---

## POST /v1/users

Create a new user.

### Request

| Field         | Type     | Required | Description                              |
|---------------|----------|----------|------------------------------------------|
| external_id   | string   | yes      | Your unique identifier for the user      |
| phone         | string   | no       | Phone number                             |
| gender        | string   | no       | One of: `male`, `female`, `other`        |
| attributes    | object   | no       | Key-value pairs (string, number, or boolean values) |

### Response

- **201** — User created
- **409** — User with that `external_id` already exists

### Example

```bash
curl -X POST https://nvrt6uv3caioemxhcqxtczzjni0ptvsj.lambda-url.eu-north-1.on.aws/v1/users \
  -H "Content-Type: application/json" \
  -H "X-Customer-Id: 00000000-0000-0000-0000-000000000001" \
  -d '{
    "external_id": "user_123",
    "phone": "+447700900000",
    "gender": "male",
    "attributes": {
      "plan": "pro",
      "signup_source": "organic",
      "is_active": true
    }
  }'
```

---

## PATCH /v1/users/:external_id

Update attributes on an existing user. Attributes are shallow-merged with existing values.

### Request

| Field      | Type   | Required | Description                              |
|------------|--------|----------|------------------------------------------|
| attributes | object | yes      | Key-value pairs (string, number, or boolean values) |

### Response

- **200** — Attributes updated
- **404** — No user found with that `external_id`

### Example

```bash
curl -X PATCH https://nvrt6uv3caioemxhcqxtczzjni0ptvsj.lambda-url.eu-north-1.on.aws/v1/users/user_001 \
  -H "Content-Type: application/json" \
  -H "X-Customer-Id: 00000000-0000-0000-0000-000000000001" \
  -d '{
    "attributes": {
      "plan": "enterprise",
      "lifetime_value": 599.00
    }
  }'
```

---

## POST /v1/events

Track an event for a user. Automatically enrolls the user in any active workflows triggered by the event.

### Request

| Field       | Type   | Required | Description                                                     |
|-------------|--------|----------|-----------------------------------------------------------------|
| external_id | string | yes      | The user's external ID                                          |
| event       | string | yes      | Event name (lowercase alphanumeric and underscores only)        |
| properties  | object | no       | Arbitrary event properties                                      |
| timestamp   | string | no       | ISO 8601 datetime; defaults to now                              |

### Response

- **202** — Event accepted
- **404** — No user found with that `external_id`

### Example

```bash
curl -X POST https://nvrt6uv3caioemxhcqxtczzjni0ptvsj.lambda-url.eu-north-1.on.aws/v1/events \
  -H "Content-Type: application/json" \
  -H "X-Customer-Id: 00000000-0000-0000-0000-000000000001" \
  -d '{
    "external_id": "user_123",
    "event": "purchase_completed",
    "properties": {
      "amount": 49.99,
      "currency": "GBP"
    }
  }'
```
