import postgres from 'postgres';
import { Resource } from 'sst';

const sql = postgres(Resource.NeonDB.connectionString);

async function seed() {
  // Create a test customer
  const [customer] = await sql`
    INSERT INTO customer (email, name, api_key)
    VALUES ('test@example.com', 'Test Company', 'test_api_key_123')
    RETURNING id
  `;
  console.log('Created customer:', customer.id);

  // Create some users
  const [user1] = await sql`
    INSERT INTO "user" (customer_id, external_id, gender, plan, phone)
    VALUES (${customer.id}, 'user_001', 'male', 'free', '+1234567890')
    RETURNING id
  `;
  const [user2] = await sql`
    INSERT INTO "user" (customer_id, external_id, gender, plan, phone)
    VALUES (${customer.id}, 'user_002', 'female', 'pro', '+0987654321')
    RETURNING id
  `;
  const [user3] = await sql`
    INSERT INTO "user" (customer_id, external_id, gender, plan)
    VALUES (${customer.id}, 'user_003', 'male', 'free')
    RETURNING id
  `;
  console.log('Created users:', user1.id, user2.id, user3.id);

  // Create a workflow: "Upgrade Prompt"
  // Trigger: contact_added -> Wait 24h -> Branch (plan != pro) -> Send notification
  const [workflow] = await sql`
    INSERT INTO workflow (customer_id, name, trigger_event, active)
    VALUES (${customer.id}, 'Upgrade Prompt', 'contact_added', true)
    RETURNING id
  `;
  console.log('Created workflow:', workflow.id);

  // Create steps
  const [stepWait] = await sql`
    INSERT INTO step (workflow_id, step_type, step_order)
    VALUES (${workflow.id}, 'wait', 1)
    RETURNING id
  `;
  const [stepBranch] = await sql`
    INSERT INTO step (workflow_id, step_type, step_order)
    VALUES (${workflow.id}, 'branch', 2)
    RETURNING id
  `;
  const [stepSend] = await sql`
    INSERT INTO step (workflow_id, step_type, step_order)
    VALUES (${workflow.id}, 'send', 3)
    RETURNING id
  `;
  console.log('Created steps:', stepWait.id, stepBranch.id, stepSend.id);

  // Configure wait step: 24 hours, then go to branch
  await sql`
    INSERT INTO step_wait (step_id, hours, next_step_id)
    VALUES (${stepWait.id}, 24, ${stepBranch.id})
  `;

  // Configure branch step: if plan != 'pro', go to send; otherwise exit
  await sql`
    INSERT INTO step_branch (step_id, user_column, operator, compare_value, true_step_id, false_step_id)
    VALUES (${stepBranch.id}, 'plan', '!=', 'pro', ${stepSend.id}, NULL)
  `;

  // Configure send step: notification content, no next step (end)
  await sql`
    INSERT INTO step_send (step_id, title, body, next_step_id)
    VALUES (${stepSend.id}, 'Upgrade to Pro!', 'Get 50% off your first month of Pro. Limited time offer!', NULL)
  `;
  console.log('Configured step details');

  // Create an enrollment for user1 (free plan, should get notification)
  await sql`
    INSERT INTO workflow_enrollment (user_id, workflow_id, current_step_id, status, process_at)
    VALUES (${user1.id}, ${workflow.id}, ${stepWait.id}, 'active', NOW())
  `;
  console.log('Created enrollment for user1 (free plan)');

  console.log('Seed complete!');
  await sql.end();
}

seed().catch(console.error);
