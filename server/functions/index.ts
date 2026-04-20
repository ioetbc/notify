import { Hono } from 'hono';
import { handle } from 'hono/aws-lambda';
import { neon } from '@neondatabase/serverless';
import { Resource } from 'sst';

const sql = neon(Resource.NeonDB.connectionString);
const app = new Hono();

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

    // Get all steps for this workflow, ordered
    const steps = await sql`
      SELECT
        s.id,
        s.step_type,
        s.step_order,
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
      ORDER BY s.step_order
    `;

    return c.json({ workflow, steps });
  })
  .get('/workflows', async (c) => {
    const workflows = await sql`SELECT * FROM workflow LIMIT 10`;
    return c.json({ workflows });
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
    const workflowId = c.req.param('id');
    const body = await c.req.json();

    const [workflow] = await sql`
      UPDATE workflow
      SET trigger_event = ${body.trigger_event}
      WHERE id = ${workflowId}
      RETURNING *
    `;

    if (!workflow) {
      return c.json({ error: 'Workflow not found' }, 404);
    }

    return c.json({ workflow });
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
