-- Migration 002: Core workflow schema (MVP)

CREATE TYPE step_type AS ENUM ('wait', 'branch', 'send');
CREATE TYPE trigger_event AS ENUM ('contact_added', 'contact_updated', 'event_received');
CREATE TYPE enrollment_status AS ENUM ('active', 'completed', 'exited');
CREATE TYPE branch_operator AS ENUM ('=', '!=', 'exists', 'not_exists');
CREATE TYPE gender AS ENUM ('male', 'female', 'other');

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

CREATE TABLE workflow (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES customer(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    trigger_event trigger_event NOT NULL,
    active BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE step (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id UUID NOT NULL REFERENCES workflow(id) ON DELETE CASCADE,
    step_type step_type NOT NULL,
    step_order INT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE step_wait (
    step_id UUID PRIMARY KEY REFERENCES step(id) ON DELETE CASCADE,
    hours INT NOT NULL CHECK (hours > 0),
    next_step_id UUID REFERENCES step(id) ON DELETE SET NULL
);

CREATE TABLE step_branch (
    step_id UUID PRIMARY KEY REFERENCES step(id) ON DELETE CASCADE,
    user_column TEXT NOT NULL,
    operator branch_operator NOT NULL,
    compare_value TEXT,
    true_step_id UUID REFERENCES step(id) ON DELETE SET NULL,
    false_step_id UUID REFERENCES step(id) ON DELETE SET NULL
);

CREATE TABLE step_send (
    step_id UUID PRIMARY KEY REFERENCES step(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    next_step_id UUID REFERENCES step(id) ON DELETE SET NULL
);

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
