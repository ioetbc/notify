-- Migration 003: Dynamic user attributes

CREATE TYPE attribute_type AS ENUM ('text', 'boolean', 'number');

CREATE TABLE attribute_definition (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES customer(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    data_type attribute_type NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(customer_id, name)
);

CREATE TABLE user_attribute (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    attribute_definition_id UUID NOT NULL REFERENCES attribute_definition(id) ON DELETE CASCADE,
    value_text TEXT,
    value_boolean BOOLEAN,
    value_number NUMERIC,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, attribute_definition_id),
    -- Ensure exactly one value column is populated based on type
    CONSTRAINT single_value CHECK (
        (value_text IS NOT NULL AND value_boolean IS NULL AND value_number IS NULL) OR
        (value_text IS NULL AND value_boolean IS NOT NULL AND value_number IS NULL) OR
        (value_text IS NULL AND value_boolean IS NULL AND value_number IS NOT NULL)
    )
);

-- Remove plan column from user table
ALTER TABLE "user" DROP COLUMN plan;

-- Update step_branch to support dynamic attributes
-- Make user_column nullable, add attribute_definition_id
ALTER TABLE step_branch
    ALTER COLUMN user_column DROP NOT NULL,
    ADD COLUMN attribute_definition_id UUID REFERENCES attribute_definition(id) ON DELETE CASCADE;

-- Ensure exactly one of user_column OR attribute_definition_id is set
ALTER TABLE step_branch ADD CONSTRAINT branch_target_check CHECK (
    (user_column IS NOT NULL AND attribute_definition_id IS NULL) OR
    (user_column IS NULL AND attribute_definition_id IS NOT NULL)
);
