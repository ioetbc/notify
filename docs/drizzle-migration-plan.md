# Plan: Migrate from Raw SQL to Drizzle ORM

## Overview
Convert the codebase from using raw SQL via `@neondatabase/serverless` to using Drizzle ORM, a type-safe SQL toolkit with excellent TypeScript support.

## Why Drizzle over Kysely
- **Schema-as-code**: Define schema in TypeScript, generate migrations from it
- **Type-safe queries**: Full TypeScript IntelliSense without code generation step
- **Simpler mental model**: Schema definition drives everything
- **Excellent Neon/serverless support**: `drizzle-orm/neon-serverless` adapter
- **Lightweight**: ~7kb bundle size, no dependencies
- **SQL-like syntax**: Queries read like SQL, easier to learn

## Current State
- Raw SQL queries using `@neondatabase/serverless`
- 4 SQL migration files in `server/migrations/`
- ~30 queries in `server/functions/admin/index.ts`

## Files to Modify/Create

| File | Action |
|------|--------|
| `server/package.json` | Add `drizzle-orm`, `drizzle-kit` dependencies |
| `server/db/schema.ts` | Create - Define all tables, enums, and relations |
| `server/db/index.ts` | Create - Drizzle instance and connection |
| `server/drizzle.config.ts` | Create - Drizzle Kit configuration |
| `server/functions/admin/index.ts` | Modify - Convert all queries to Drizzle |
| `server/migrations/*.sql` | Keep for reference, Drizzle will manage migrations going forward |

---

## Implementation Steps

### Step 1: Install Dependencies

```bash
cd server && bun add drizzle-orm @neondatabase/serverless && bun add -D drizzle-kit
```

Note: We keep `@neondatabase/serverless` as the underlying driver - Drizzle wraps it.

### Step 2: Create Schema Definition

**`server/db/schema.ts`**:

```typescript
import { pgTable, uuid, varchar, text, boolean, integer, timestamp, pgEnum, unique, numeric, check } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// ============ ENUMS ============

export const stepTypeEnum = pgEnum('step_type', ['wait', 'branch', 'send']);
export const triggerEventEnum = pgEnum('trigger_event', ['contact_added', 'contact_updated', 'event_received']);
export const enrollmentStatusEnum = pgEnum('enrollment_status', ['active', 'completed', 'exited']);
export const branchOperatorEnum = pgEnum('branch_operator', ['=', '!=', 'exists', 'not_exists']);
export const genderEnum = pgEnum('gender', ['male', 'female', 'other']);
export const attributeTypeEnum = pgEnum('attribute_type', ['text', 'boolean', 'number']);

// ============ TABLES ============

export const customer = pgTable('customer', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 255 }).unique().notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  apiKey: text('api_key').unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const user = pgTable('user', {
  id: uuid('id').primaryKey().defaultRandom(),
  customerId: uuid('customer_id').notNull().references(() => customer.id, { onDelete: 'cascade' }),
  externalId: text('external_id').notNull(),
  gender: genderEnum('gender'),
  phone: text('phone'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  uniqueCustomerExternal: unique().on(table.customerId, table.externalId),
}));

export const workflow = pgTable('workflow', {
  id: uuid('id').primaryKey().defaultRandom(),
  customerId: uuid('customer_id').notNull().references(() => customer.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  triggerEvent: triggerEventEnum('trigger_event').notNull(),
  active: boolean('active').default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const step = pgTable('step', {
  id: uuid('id').primaryKey().defaultRandom(),
  workflowId: uuid('workflow_id').notNull().references(() => workflow.id, { onDelete: 'cascade' }),
  stepType: stepTypeEnum('step_type').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const stepWait = pgTable('step_wait', {
  stepId: uuid('step_id').primaryKey().references(() => step.id, { onDelete: 'cascade' }),
  hours: integer('hours').notNull(),
  nextStepId: uuid('next_step_id').references(() => step.id, { onDelete: 'set null' }),
});

export const stepBranch = pgTable('step_branch', {
  stepId: uuid('step_id').primaryKey().references(() => step.id, { onDelete: 'cascade' }),
  userColumn: text('user_column'),
  operator: branchOperatorEnum('operator').notNull(),
  compareValue: text('compare_value'),
  trueStepId: uuid('true_step_id').references(() => step.id, { onDelete: 'set null' }),
  falseStepId: uuid('false_step_id').references(() => step.id, { onDelete: 'set null' }),
  attributeDefinitionId: uuid('attribute_definition_id').references(() => attributeDefinition.id, { onDelete: 'cascade' }),
});

export const stepSend = pgTable('step_send', {
  stepId: uuid('step_id').primaryKey().references(() => step.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  body: text('body').notNull(),
  nextStepId: uuid('next_step_id').references(() => step.id, { onDelete: 'set null' }),
});

export const workflowEnrollment = pgTable('workflow_enrollment', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  workflowId: uuid('workflow_id').notNull().references(() => workflow.id, { onDelete: 'cascade' }),
  currentStepId: uuid('current_step_id').references(() => step.id, { onDelete: 'set null' }),
  status: enrollmentStatusEnum('status').notNull().default('active'),
  processAt: timestamp('process_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  uniqueUserWorkflow: unique().on(table.userId, table.workflowId),
}));

export const attributeDefinition = pgTable('attribute_definition', {
  id: uuid('id').primaryKey().defaultRandom(),
  customerId: uuid('customer_id').notNull().references(() => customer.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  dataType: attributeTypeEnum('data_type').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  uniqueCustomerName: unique().on(table.customerId, table.name),
}));

export const userAttribute = pgTable('user_attribute', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  attributeDefinitionId: uuid('attribute_definition_id').notNull().references(() => attributeDefinition.id, { onDelete: 'cascade' }),
  valueText: text('value_text'),
  valueBoolean: boolean('value_boolean'),
  valueNumber: numeric('value_number'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  uniqueUserAttribute: unique().on(table.userId, table.attributeDefinitionId),
}));

// ============ RELATIONS ============

export const customerRelations = relations(customer, ({ many }) => ({
  users: many(user),
  workflows: many(workflow),
  attributeDefinitions: many(attributeDefinition),
}));

export const workflowRelations = relations(workflow, ({ one, many }) => ({
  customer: one(customer, { fields: [workflow.customerId], references: [customer.id] }),
  steps: many(step),
  enrollments: many(workflowEnrollment),
}));

export const stepRelations = relations(step, ({ one }) => ({
  workflow: one(workflow, { fields: [step.workflowId], references: [workflow.id] }),
  waitConfig: one(stepWait, { fields: [step.id], references: [stepWait.stepId] }),
  branchConfig: one(stepBranch, { fields: [step.id], references: [stepBranch.stepId] }),
  sendConfig: one(stepSend, { fields: [step.id], references: [stepSend.stepId] }),
}));

// ============ TYPE EXPORTS ============

export type Customer = typeof customer.$inferSelect;
export type NewCustomer = typeof customer.$inferInsert;
export type Workflow = typeof workflow.$inferSelect;
export type NewWorkflow = typeof workflow.$inferInsert;
export type Step = typeof step.$inferSelect;
export type NewStep = typeof step.$inferInsert;
export type StepWait = typeof stepWait.$inferSelect;
export type StepBranch = typeof stepBranch.$inferSelect;
export type StepSend = typeof stepSend.$inferSelect;
```

### Step 3: Create Database Connection

**`server/db/index.ts`**:

```typescript
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { Resource } from 'sst';
import * as schema from './schema';

const sql = neon(Resource.NeonDB.connectionString);
export const db = drizzle(sql, { schema });

// Re-export schema for convenience
export * from './schema';
```

### Step 4: Create Drizzle Kit Config

**`server/drizzle.config.ts`**:

```typescript
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
```

Add scripts to `server/package.json`:

```json
{
  "scripts": {
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    "db:push": "drizzle-kit push",
    "db:studio": "drizzle-kit studio"
  }
}
```

---

## Query Conversion Reference

### Import Changes

```typescript
// Before
import { neon } from '@neondatabase/serverless';
import { Resource } from 'sst';
const sql = neon(Resource.NeonDB.connectionString);

// After
import { db, customer, workflow, step, stepWait, stepBranch, stepSend, attributeDefinition } from '../../db';
import { eq, desc, sql } from 'drizzle-orm';
```

### Query Patterns

| Operation | Raw SQL | Drizzle |
|-----------|---------|---------|
| SELECT all | `sql\`SELECT * FROM customer\`` | `db.select().from(customer)` |
| SELECT where | `sql\`SELECT * FROM workflow WHERE id = ${id}\`` | `db.select().from(workflow).where(eq(workflow.id, id))` |
| SELECT first | `const [row] = await sql\`...\`` | `const row = await db.query.workflow.findFirst({ where: eq(workflow.id, id) })` |
| INSERT returning | `sql\`INSERT INTO customer (...) RETURNING *\`` | `db.insert(customer).values({...}).returning()` |
| UPDATE returning | `sql\`UPDATE workflow SET ... RETURNING *\`` | `db.update(workflow).set({...}).where(eq(workflow.id, id)).returning()` |
| DELETE returning | `sql\`DELETE FROM workflow WHERE ... RETURNING *\`` | `db.delete(workflow).where(eq(workflow.id, id)).returning()` |
| Limit/Order | `sql\`SELECT * FROM workflow ORDER BY created_at DESC LIMIT 10\`` | `db.select().from(workflow).orderBy(desc(workflow.createdAt)).limit(10)` |

### Complex JOIN Example

```typescript
// Before
const steps = await sql`
  SELECT s.id, s.step_type, sw.hours as wait_hours, ...
  FROM step s
  LEFT JOIN step_wait sw ON sw.step_id = s.id
  LEFT JOIN step_branch sb ON sb.step_id = s.id
  LEFT JOIN step_send ss ON ss.step_id = s.id
  WHERE s.workflow_id = ${workflowId}
`;

// After (Option 1: Relational query - cleaner)
const steps = await db.query.step.findMany({
  where: eq(step.workflowId, workflowId),
  with: {
    waitConfig: true,
    branchConfig: true,
    sendConfig: true,
  },
});

// After (Option 2: Manual joins - more control)
const steps = await db
  .select({
    id: step.id,
    stepType: step.stepType,
    waitHours: stepWait.hours,
    waitNextStepId: stepWait.nextStepId,
    branchUserColumn: stepBranch.userColumn,
    branchOperator: stepBranch.operator,
    branchCompareValue: stepBranch.compareValue,
    branchTrueStepId: stepBranch.trueStepId,
    branchFalseStepId: stepBranch.falseStepId,
    sendTitle: stepSend.title,
    sendBody: stepSend.body,
    sendNextStepId: stepSend.nextStepId,
  })
  .from(step)
  .leftJoin(stepWait, eq(stepWait.stepId, step.id))
  .leftJoin(stepBranch, eq(stepBranch.stepId, step.id))
  .leftJoin(stepSend, eq(stepSend.stepId, step.id))
  .where(eq(step.workflowId, workflowId));
```

### Transactions

```typescript
// Before: No transactions (risk of partial writes)

// After
const result = await db.transaction(async (tx) => {
  const [newWorkflow] = await tx
    .insert(workflow)
    .values({ customerId, name, triggerEvent, active: true })
    .returning();

  const [newStep] = await tx
    .insert(step)
    .values({ workflowId: newWorkflow.id, stepType: 'wait' })
    .returning();

  return { workflow: newWorkflow, step: newStep };
});
```

### Raw SQL for Enums (pg_enum queries)

```typescript
// Before
const triggerEvents = await sql`
  SELECT enumlabel as value FROM pg_enum
  WHERE enumtypid = 'trigger_event'::regtype
  ORDER BY enumsortorder
`;

// After (Option 1: Use schema enum values directly - preferred)
import { triggerEventEnum, stepTypeEnum, branchOperatorEnum } from '../../db';

app.get('/enums', (c) => {
  return c.json({
    trigger_event: triggerEventEnum.enumValues,
    step_type: stepTypeEnum.enumValues,
    branch_operator: branchOperatorEnum.enumValues,
  });
});

// After (Option 2: Raw SQL if needed)
import { sql } from 'drizzle-orm';

const triggerEvents = await db.execute(
  sql`SELECT enumlabel as value FROM pg_enum WHERE enumtypid = 'trigger_event'::regtype ORDER BY enumsortorder`
);
```

---

## Route-by-Route Migration

### Route 1: GET `/version` (line 33-35)

```typescript
// Before
const result = await sql`SELECT * FROM customer`;

// After
const result = await db.select().from(customer);
```

### Route 2: GET `/workflows/:id` (line 37-71)

```typescript
// Before
const [workflow] = await sql`SELECT * FROM workflow WHERE id = ${workflowId}`;
const steps = await sql`SELECT ... FROM step s LEFT JOIN ... WHERE s.workflow_id = ${workflowId}`;

// After
const workflowResult = await db.query.workflow.findFirst({
  where: eq(workflow.id, workflowId),
});

if (!workflowResult) {
  return c.json({ error: 'Workflow not found' }, 404);
}

const steps = await db.query.step.findMany({
  where: eq(step.workflowId, workflowId),
  with: {
    waitConfig: true,
    branchConfig: true,
    sendConfig: true,
  },
});

return c.json({ workflow: workflowResult, steps });
```

### Route 3: GET `/workflows` (line 73-75)

```typescript
// Before
const workflows = await sql`SELECT * FROM workflow ORDER BY created_at DESC LIMIT 10`;

// After
const workflows = await db
  .select()
  .from(workflow)
  .orderBy(desc(workflow.createdAt))
  .limit(10);
```

### Route 4: POST `/workflows` (line 77-179) - Use Transaction

```typescript
// After
const result = await db.transaction(async (tx) => {
  // Get or create customer
  let customerId = body.customer_id;
  if (!customerId) {
    const existing = await tx.query.customer.findFirst();
    if (existing) {
      customerId = existing.id;
    } else {
      const [newCustomer] = await tx
        .insert(customer)
        .values({ email: 'dev@example.com', name: 'Dev Customer' })
        .returning();
      customerId = newCustomer.id;
    }
  }

  // Create workflow
  const [newWorkflow] = await tx
    .insert(workflow)
    .values({
      customerId,
      name: body.name,
      triggerEvent: body.trigger_event,
      active: true,
    })
    .returning();

  // Map canvas IDs to DB UUIDs
  const idMap = new Map<string, string>();

  // Insert all steps
  for (const canvasStep of body.steps) {
    const [dbStep] = await tx
      .insert(step)
      .values({ workflowId: newWorkflow.id, stepType: canvasStep.type })
      .returning();

    idMap.set(canvasStep.id, dbStep.id);

    // Insert step-specific config
    if (canvasStep.type === 'wait') {
      await tx.insert(stepWait).values({
        stepId: dbStep.id,
        hours: canvasStep.config.hours || 24,
      });
    } else if (canvasStep.type === 'branch') {
      await tx.insert(stepBranch).values({
        stepId: dbStep.id,
        userColumn: canvasStep.config.user_column || 'unconfigured',
        operator: canvasStep.config.operator || '=',
        compareValue: canvasStep.config.compare_value || null,
      });
    } else if (canvasStep.type === 'send') {
      await tx.insert(stepSend).values({
        stepId: dbStep.id,
        title: canvasStep.config.title || 'Notification',
        body: canvasStep.config.body || '',
      });
    }
  }

  // Update step references based on edges
  for (const edge of body.edges) {
    const sourceDbId = idMap.get(edge.source);
    const targetDbId = idMap.get(edge.target);
    if (!sourceDbId || !targetDbId) continue;

    const sourceStep = body.steps.find((s) => s.id === edge.source);
    if (!sourceStep) continue;

    if (sourceStep.type === 'wait') {
      await tx
        .update(stepWait)
        .set({ nextStepId: targetDbId })
        .where(eq(stepWait.stepId, sourceDbId));
    } else if (sourceStep.type === 'send') {
      await tx
        .update(stepSend)
        .set({ nextStepId: targetDbId })
        .where(eq(stepSend.stepId, sourceDbId));
    } else if (sourceStep.type === 'branch') {
      if (edge.sourceHandle === 'yes') {
        await tx
          .update(stepBranch)
          .set({ trueStepId: targetDbId })
          .where(eq(stepBranch.stepId, sourceDbId));
      } else if (edge.sourceHandle === 'no') {
        await tx
          .update(stepBranch)
          .set({ falseStepId: targetDbId })
          .where(eq(stepBranch.stepId, sourceDbId));
      }
    }
  }

  return { workflow: newWorkflow, idMap: Object.fromEntries(idMap) };
});

return c.json(result);
```

### Route 5: GET `/enums` (line 181-203)

```typescript
// After - Use enum values from schema directly
import { triggerEventEnum, stepTypeEnum, branchOperatorEnum } from '../../db';

app.get('/enums', (c) => {
  return c.json({
    trigger_event: triggerEventEnum.enumValues,
    step_type: stepTypeEnum.enumValues,
    branch_operator: branchOperatorEnum.enumValues,
  });
});
```

### Route 6: PUT `/workflows/:id` (line 205-296)

Same pattern as POST but starts with UPDATE + DELETE:

```typescript
const result = await db.transaction(async (tx) => {
  // Update workflow
  const [updatedWorkflow] = await tx
    .update(workflow)
    .set({ name: body.name, triggerEvent: body.trigger_event })
    .where(eq(workflow.id, workflowId))
    .returning();

  if (!updatedWorkflow) {
    throw new Error('Workflow not found');
  }

  // Delete existing steps (cascades to step_* tables)
  await tx.delete(step).where(eq(step.workflowId, workflowId));

  // ... same step insert logic as POST
});
```

### Route 7: DELETE `/workflows/:id` (line 298-309)

```typescript
// Before
const [deleted] = await sql`DELETE FROM workflow WHERE id = ${workflowId} RETURNING *`;

// After
const [deleted] = await db
  .delete(workflow)
  .where(eq(workflow.id, workflowId))
  .returning();

if (!deleted) {
  return c.json({ error: 'Workflow not found' }, 404);
}

return c.json({ success: true });
```

### Route 8: GET `/user-columns` (line 311-325)

```typescript
// Before
const attributes = await sql`SELECT id, name, data_type FROM attribute_definition ORDER BY name`;

// After
const attributes = await db
  .select({
    id: attributeDefinition.id,
    name: attributeDefinition.name,
    dataType: attributeDefinition.dataType,
  })
  .from(attributeDefinition)
  .orderBy(attributeDefinition.name);

return c.json({ columns: attributes });
```

### Route 9: PUT `/steps/:id` (line 327-383)

```typescript
// Before
const [existingStep] = await sql`SELECT * FROM step WHERE id = ${stepId}`;

// After
const existingStep = await db.query.step.findFirst({
  where: eq(step.id, stepId),
});

if (!existingStep) {
  return c.json({ error: 'Step not found' }, 404);
}

if (existingStep.stepType === 'wait' && body.hours !== undefined) {
  await db
    .update(stepWait)
    .set({ hours: body.hours })
    .where(eq(stepWait.stepId, stepId));
} else if (existingStep.stepType === 'branch') {
  const updates: Partial<StepBranch> = {};
  if (body.user_column !== undefined) updates.userColumn = body.user_column;
  if (body.operator !== undefined) updates.operator = body.operator;
  if (body.compare_value !== undefined) updates.compareValue = body.compare_value;

  if (Object.keys(updates).length > 0) {
    await db
      .update(stepBranch)
      .set(updates)
      .where(eq(stepBranch.stepId, stepId));
  }
} else if (existingStep.stepType === 'send') {
  const updates: Partial<StepSend> = {};
  if (body.title !== undefined) updates.title = body.title;
  if (body.body !== undefined) updates.body = body.body;

  if (Object.keys(updates).length > 0) {
    await db
      .update(stepSend)
      .set(updates)
      .where(eq(stepSend.stepId, stepId));
  }
}

return c.json({ success: true });
```

---

## Migration Strategy

### Option A: Schema Push (Recommended for existing database)

Since you already have an existing database with data:

1. Define the schema in `server/db/schema.ts` to match existing tables
2. Use `drizzle-kit push` to verify schema matches (it won't modify if already matching)
3. Convert queries incrementally

```bash
DATABASE_URL="your-neon-url" bun db:push
```

### Option B: Generate Migrations from Schema

For a fresh database or if you want Drizzle to manage migrations:

```bash
# Generate SQL migrations from schema
DATABASE_URL="your-neon-url" bun db:generate

# Apply migrations
DATABASE_URL="your-neon-url" bun db:migrate
```

---

## Implementation Checklist

- [ ] Install dependencies (`drizzle-orm`, `drizzle-kit`)
- [ ] Create `server/db/schema.ts` with all tables and enums
- [ ] Create `server/db/index.ts` with Drizzle instance
- [ ] Create `server/drizzle.config.ts`
- [ ] Add npm scripts for db:generate, db:push, db:studio
- [ ] Verify schema matches existing DB with `db:push`
- [ ] Convert `admin/index.ts` queries:
  - [ ] GET `/version`
  - [ ] GET `/workflows/:id`
  - [ ] GET `/workflows`
  - [ ] POST `/workflows`
  - [ ] GET `/enums`
  - [ ] PUT `/workflows/:id`
  - [ ] DELETE `/workflows/:id`
  - [ ] GET `/user-columns`
  - [ ] PUT `/steps/:id`
- [ ] Test all endpoints
- [ ] Remove old SQL migrations (optional, keep for reference)

---

## Serverless Considerations

- Drizzle with `neon-http` adapter is stateless - no connection pooling needed
- Each request creates a new HTTP connection to Neon (ideal for serverless)
- If you need WebSocket connections for transactions, use `neon-serverless` adapter instead:

```typescript
import { Pool } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';

const pool = new Pool({ connectionString: Resource.NeonDB.connectionString });
export const db = drizzle(pool, { schema });
```

---

## Benefits After Migration

1. **Type safety**: All queries fully typed, catch errors at compile time
2. **No code generation**: Types derived from schema, no build step needed
3. **Schema as source of truth**: One place defines tables, types, and relations
4. **Transaction support**: Wrap related operations safely
5. **Drizzle Studio**: Visual DB browser with `bun db:studio`
6. **Migration management**: Generate/apply migrations from schema changes
