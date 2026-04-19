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
  });

export const handler = handle(app);
