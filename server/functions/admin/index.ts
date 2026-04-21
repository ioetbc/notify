import { Hono } from 'hono';
import { handle } from 'hono/aws-lambda';
import { neon } from '@neondatabase/serverless';
import { Resource } from 'sst';

const sql = neon(Resource.NeonDB.connectionString);
const app = new Hono();

// Types for workflow canvas
interface CanvasStep {
  id: string;
  type: 'wait' | 'branch' | 'send';
  config: {
    hours?: number;
    user_column?: string;
    operator?: string;
    compare_value?: string;
    title?: string;
    body?: string;
  };
}

interface CanvasEdge {
  source: string;
  target: string;
  sourceHandle?: string;
}

app
  .get('/', (c) => {
    return c.text('Hello Hono!');
  })
  .get('/version', async (c) => {
    const result = await sql`SELECT * FROM customer`;
    return c.json({ version: result });
  })
  .get('/workflows/:id', async (c) => {
    const workflowId = c.req.param('id');

    // Get workflow
    const [workflow] = await sql`
      SELECT * FROM workflow WHERE id = ${workflowId}
    `;

    if (!workflow) {
      return c.json({ error: 'Workflow not found' }, 404);
    }

    // Get all steps for this workflow
    const steps = await sql`
      SELECT
        s.id,
        s.step_type,
        sw.hours as wait_hours,
        sw.next_step_id as wait_next_step_id,
        sb.user_column as branch_user_column,
        sb.operator as branch_operator,
        sb.compare_value as branch_compare_value,
        sb.true_step_id as branch_true_step_id,
        sb.false_step_id as branch_false_step_id,
        ss.title as send_title,
        ss.body as send_body,
        ss.next_step_id as send_next_step_id
      FROM step s
      LEFT JOIN step_wait sw ON sw.step_id = s.id
      LEFT JOIN step_branch sb ON sb.step_id = s.id
      LEFT JOIN step_send ss ON ss.step_id = s.id
      WHERE s.workflow_id = ${workflowId}
    `;

    return c.json({ workflow, steps });
  })
  .get('/workflows', async (c) => {
    const workflows = await sql`SELECT * FROM workflow ORDER BY created_at DESC LIMIT 10`;
    return c.json({ workflows });
  })
  .post('/workflows', async (c) => {
    try {
      const body = await c.req.json<{
        name: string;
        trigger_event: string;
        customer_id?: string;
        steps: CanvasStep[];
        edges: CanvasEdge[];
      }>();

      // Get or create a default customer for dev
      let customerId = body.customer_id;
      if (!customerId) {
        const [existingCustomer] = await sql`SELECT id FROM customer LIMIT 1`;
        if (existingCustomer) {
          customerId = existingCustomer.id;
        } else {
          const [newCustomer] = await sql`
            INSERT INTO customer (email, name)
            VALUES ('dev@example.com', 'Dev Customer')
            RETURNING id
          `;
          customerId = newCustomer.id;
        }
      }

      // Create workflow (active by default)
      const [workflow] = await sql`
        INSERT INTO workflow (customer_id, name, trigger_event, active)
        VALUES (${customerId}, ${body.name}, ${body.trigger_event}, true)
        RETURNING *
      `;

      // Map canvas IDs to DB UUIDs
      const idMap = new Map<string, string>();

      // Insert all steps first (without next_step references)
      for (const step of body.steps) {
        const [dbStep] = await sql`
          INSERT INTO step (workflow_id, step_type)
          VALUES (${workflow.id}, ${step.type})
          RETURNING id
        `;
        idMap.set(step.id, dbStep.id);

        // Insert step-specific config
        if (step.type === 'wait') {
          await sql`
            INSERT INTO step_wait (step_id, hours)
            VALUES (${dbStep.id}, ${step.config.hours || 24})
          `;
        } else if (step.type === 'branch') {
          // user_column must be non-empty string or we use a placeholder
          const userColumn = step.config.user_column || 'unconfigured';
          await sql`
            INSERT INTO step_branch (step_id, user_column, operator, compare_value)
            VALUES (${dbStep.id}, ${userColumn}, ${step.config.operator || '='}, ${step.config.compare_value || null})
          `;
        } else if (step.type === 'send') {
          await sql`
            INSERT INTO step_send (step_id, title, body)
            VALUES (${dbStep.id}, ${step.config.title || 'Notification'}, ${step.config.body || ''})
          `;
        }
      }

      // Now update step references based on edges
      for (const edge of body.edges) {
        const sourceDbId = idMap.get(edge.source);
        const targetDbId = idMap.get(edge.target);

        if (!sourceDbId || !targetDbId) continue;

        // Find the source step type
        const sourceStep = body.steps.find((s) => s.id === edge.source);
        if (!sourceStep) continue;

        if (sourceStep.type === 'wait') {
          await sql`
            UPDATE step_wait SET next_step_id = ${targetDbId} WHERE step_id = ${sourceDbId}
          `;
        } else if (sourceStep.type === 'send') {
          await sql`
            UPDATE step_send SET next_step_id = ${targetDbId} WHERE step_id = ${sourceDbId}
          `;
        } else if (sourceStep.type === 'branch') {
          if (edge.sourceHandle === 'yes') {
            await sql`
              UPDATE step_branch SET true_step_id = ${targetDbId} WHERE step_id = ${sourceDbId}
            `;
          } else if (edge.sourceHandle === 'no') {
            await sql`
              UPDATE step_branch SET false_step_id = ${targetDbId} WHERE step_id = ${sourceDbId}
            `;
          }
        }
      }

      return c.json({ workflow, idMap: Object.fromEntries(idMap) });
    } catch (err) {
      console.error('POST /workflows error:', err);
      return c.json({ error: err instanceof Error ? err.message : 'Unknown error' }, 500);
    }
  })
  .get('/enums', async (c) => {
    // Fetch enum values from PostgreSQL
    const triggerEvents = await sql`
      SELECT enumlabel as value FROM pg_enum
      WHERE enumtypid = 'trigger_event'::regtype
      ORDER BY enumsortorder
    `;
    const stepTypes = await sql`
      SELECT enumlabel as value FROM pg_enum
      WHERE enumtypid = 'step_type'::regtype
      ORDER BY enumsortorder
    `;
    const branchOperators = await sql`
      SELECT enumlabel as value FROM pg_enum
      WHERE enumtypid = 'branch_operator'::regtype
      ORDER BY enumsortorder
    `;

    return c.json({
      trigger_event: triggerEvents.map((r) => r.value),
      step_type: stepTypes.map((r) => r.value),
      branch_operator: branchOperators.map((r) => r.value),
    });
  })
  .put('/workflows/:id', async (c) => {
    try {
      const workflowId = c.req.param('id');
      const body = await c.req.json<{
        name: string;
        trigger_event: string;
        steps: CanvasStep[];
        edges: CanvasEdge[];
      }>();

      // Update workflow
      const [workflow] = await sql`
        UPDATE workflow
        SET name = ${body.name}, trigger_event = ${body.trigger_event}
        WHERE id = ${workflowId}
        RETURNING *
      `;

      if (!workflow) {
        return c.json({ error: 'Workflow not found' }, 404);
      }

      // Delete existing steps (cascades to step_* tables)
      await sql`DELETE FROM step WHERE workflow_id = ${workflowId}`;

      // Map canvas IDs to DB UUIDs
      const idMap = new Map<string, string>();

      // Insert all steps first
      for (const step of body.steps) {
        const [dbStep] = await sql`
          INSERT INTO step (workflow_id, step_type)
          VALUES (${workflowId}, ${step.type})
          RETURNING id
        `;
        idMap.set(step.id, dbStep.id);

        if (step.type === 'wait') {
          await sql`
            INSERT INTO step_wait (step_id, hours)
            VALUES (${dbStep.id}, ${step.config.hours || 24})
          `;
        } else if (step.type === 'branch') {
          const userColumn = step.config.user_column || 'unconfigured';
          await sql`
            INSERT INTO step_branch (step_id, user_column, operator, compare_value)
            VALUES (${dbStep.id}, ${userColumn}, ${step.config.operator || '='}, ${step.config.compare_value || null})
          `;
        } else if (step.type === 'send') {
          await sql`
            INSERT INTO step_send (step_id, title, body)
            VALUES (${dbStep.id}, ${step.config.title || 'Notification'}, ${step.config.body || ''})
          `;
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
          await sql`
            UPDATE step_wait SET next_step_id = ${targetDbId} WHERE step_id = ${sourceDbId}
          `;
        } else if (sourceStep.type === 'send') {
          await sql`
            UPDATE step_send SET next_step_id = ${targetDbId} WHERE step_id = ${sourceDbId}
          `;
        } else if (sourceStep.type === 'branch') {
          if (edge.sourceHandle === 'yes') {
            await sql`
              UPDATE step_branch SET true_step_id = ${targetDbId} WHERE step_id = ${sourceDbId}
            `;
          } else if (edge.sourceHandle === 'no') {
            await sql`
              UPDATE step_branch SET false_step_id = ${targetDbId} WHERE step_id = ${sourceDbId}
            `;
          }
        }
      }

      return c.json({ workflow, idMap: Object.fromEntries(idMap) });
    } catch (err) {
      console.error('PUT /workflows/:id error:', err);
      return c.json({ error: err instanceof Error ? err.message : 'Unknown error' }, 500);
    }
  })
  .delete('/workflows/:id', async (c) => {
    const workflowId = c.req.param('id');

    const [workflow] = await sql`
      DELETE FROM workflow WHERE id = ${workflowId} RETURNING *
    `;

    if (!workflow) {
      return c.json({ error: 'Workflow not found' }, 404);
    }

    return c.json({ success: true });
  })
  .get('/user-columns', async (c) => {
    // Fetch custom attribute definitions from the database
    // For now, fetch all (in production, you'd filter by customer_id)
    const attributes = await sql`
      SELECT
        id,
        name,
        data_type
      FROM attribute_definition
      ORDER BY name
    `;

    return c.json({
      columns: attributes,
    });
  })
  .put('/steps/:id', async (c) => {
    const stepId = c.req.param('id');
    const body = await c.req.json();

    // Get the step to know its type
    const [step] = await sql`SELECT * FROM step WHERE id = ${stepId}`;
    if (!step) {
      return c.json({ error: 'Step not found' }, 404);
    }

    // Update the appropriate step config table based on step type
    if (step.step_type === 'wait' && body.hours !== undefined) {
      await sql`
        UPDATE step_wait
        SET hours = ${body.hours}
        WHERE step_id = ${stepId}
      `;
    } else if (step.step_type === 'branch') {
      if (body.user_column !== undefined) {
        await sql`
          UPDATE step_branch
          SET user_column = ${body.user_column}
          WHERE step_id = ${stepId}
        `;
      }
      if (body.operator !== undefined) {
        await sql`
          UPDATE step_branch
          SET operator = ${body.operator}
          WHERE step_id = ${stepId}
        `;
      }
      if (body.compare_value !== undefined) {
        await sql`
          UPDATE step_branch
          SET compare_value = ${body.compare_value}
          WHERE step_id = ${stepId}
        `;
      }
    } else if (step.step_type === 'send') {
      if (body.title !== undefined) {
        await sql`
          UPDATE step_send
          SET title = ${body.title}
          WHERE step_id = ${stepId}
        `;
      }
      if (body.body !== undefined) {
        await sql`
          UPDATE step_send
          SET body = ${body.body}
          WHERE step_id = ${stepId}
        `;
      }
    }

    return c.json({ success: true });
  });

export const handler = handle(app);
