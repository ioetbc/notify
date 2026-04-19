# Database Schema

## Overview
PostgreSQL database using **Neon** (serverless Postgres) with SST for infrastructure, raw SQL migrations. No ORM.

## Why Neon?
- Serverless with scale-to-zero (great for dev/staging)
- Built-in connection pooling (no RDS Proxy needed)
- No VPC configuration required
- Generous free tier (0.5 GB storage, 190 compute hours)
- Works directly over HTTPS - perfect for Lambda/Edge

---

## Multi-tenancy Model
- `customer_id` on all tables for B2B isolation
- Each customer is a business using the platform

---

## Tables

### 1. `customers`
Businesses using the platform.

```sql
CREATE TABLE customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    api_key TEXT UNIQUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 2. `users`
End users who receive notifications.

```sql
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES customers(id),
    external_id TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(customer_id, external_id)
);
```

### 3. `push_tokens`
Device tokens for push notifications.

```sql
CREATE TABLE push_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, token)
);
```

### 4. `journeys`
A journey is a simple rule: trigger event + delay + message.

```sql
CREATE TABLE journeys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES customers(id),
    name TEXT NOT NULL,
    trigger_event TEXT NOT NULL,      -- "user_created", "cart_abandoned"
    delay_hours INT DEFAULT 0,        -- wait this long before sending
    notification_title TEXT NOT NULL,
    notification_body TEXT NOT NULL,
    active BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 5. `journey_enrollments`
Tracks users scheduled to receive journey notifications.

```sql
CREATE TABLE journey_enrollments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    journey_id UUID NOT NULL REFERENCES journeys(id),
    send_at TIMESTAMPTZ NOT NULL,     -- when to send the notification
    sent BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_enrollments_pending ON journey_enrollments(send_at)
    WHERE sent = false;
```

### 6. `notifications`
Log of sent notifications.

```sql
CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    enrollment_id UUID REFERENCES journey_enrollments(id),
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    sent_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## How It Works

1. User triggers event (e.g. `"user_created"`)
2. System finds active journeys with matching `trigger_event`
3. Creates enrollment with `send_at = now() + delay_hours`
4. Background job picks up enrollments where `send_at < now() AND sent = false`
5. Sends notification, marks `sent = true`

---

## Neon Connection Strings

Neon provides two endpoints:
- **Direct**: `postgres://user:pass@ep-xxx.region.aws.neon.tech/dbname` (for migrations, admin)
- **Pooled**: `postgres://user:pass@ep-xxx.region.aws.neon.tech/dbname?pgbouncer=true` (for Lambda, serverless)

Use the pooled endpoint for Lambda functions.
