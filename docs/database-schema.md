# Database Schema

## Overview
PostgreSQL database using **Neon** (serverless Postgres) with SST for infrastructure, raw SQL migrations. No ORM.

---

## Enums

```sql
CREATE TYPE step_type AS ENUM ('wait', 'branch', 'send');
CREATE TYPE trigger_event AS ENUM ('contact_added', 'contact_updated', 'event_received');
CREATE TYPE enrollment_status AS ENUM ('active', 'completed', 'exited');
CREATE TYPE branch_operator AS ENUM ('=', '!=', 'exists', 'not_exists');
CREATE TYPE gender AS ENUM ('male', 'female', 'other');
```

---

## Tables

### `customer`
```sql
CREATE TABLE customer (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    api_key TEXT UNIQUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### `user`
```sql
CREATE TABLE "user" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES customer(id) ON DELETE CASCADE,
    external_id TEXT NOT NULL,
    gender gender,
    plan TEXT,
    phone TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(customer_id, external_id)
);
```

### `workflow`
```sql
CREATE TABLE workflow (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES customer(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    trigger_event trigger_event NOT NULL,
    active BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### `step`
```sql
CREATE TABLE step (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id UUID NOT NULL REFERENCES workflow(id) ON DELETE CASCADE,
    step_type step_type NOT NULL,
    step_order INT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### `step_wait`
```sql
CREATE TABLE step_wait (
    step_id UUID PRIMARY KEY REFERENCES step(id) ON DELETE CASCADE,
    hours INT NOT NULL CHECK (hours > 0),
    next_step_id UUID REFERENCES step(id) ON DELETE SET NULL
);
```

### `step_branch`
```sql
CREATE TABLE step_branch (
    step_id UUID PRIMARY KEY REFERENCES step(id) ON DELETE CASCADE,
    user_column TEXT NOT NULL,
    operator branch_operator NOT NULL,
    compare_value TEXT,
    true_step_id UUID REFERENCES step(id) ON DELETE SET NULL,
    false_step_id UUID REFERENCES step(id) ON DELETE SET NULL
);
```

### `step_send`
```sql
CREATE TABLE step_send (
    step_id UUID PRIMARY KEY REFERENCES step(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    next_step_id UUID REFERENCES step(id) ON DELETE SET NULL
);
```

### `workflow_enrollment`
```sql
CREATE TABLE workflow_enrollment (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    workflow_id UUID NOT NULL REFERENCES workflow(id) ON DELETE CASCADE,
    current_step_id UUID REFERENCES step(id) ON DELETE SET NULL,
    status enrollment_status NOT NULL DEFAULT 'active',
    process_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, workflow_id)
);
```

---

## How It Works

1. API call with event → find active workflows with matching `trigger_event`
2. Create enrollment with `current_step_id` = first step
3. Worker picks up enrollments where `process_at < now() AND status = 'active'`
4. Execute step:
   - `wait`: set `process_at = now + hours`, advance to `next_step_id`
   - `branch`: check `user.{user_column}` against condition, follow `true_step_id` or `false_step_id`
   - `send`: dispatch notification, advance to `next_step_id`
5. When `next_step_id` is NULL → mark enrollment `completed`
