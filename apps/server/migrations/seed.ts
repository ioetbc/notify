import postgres from 'postgres';
import { Resource } from 'sst';

const sql = postgres(Resource.NeonDB.connectionString);

async function seed() {
  // Create a test customer with a stable ID
  const CUSTOMER_ID = '00000000-0000-0000-0000-000000000001';
  const [customer] = await sql`
    INSERT INTO customer (id, email, name, api_key)
    VALUES (${CUSTOMER_ID}, 'test@example.com', 'Test Company', 'test_api_key_123')
    RETURNING id
  `;
  console.log('Created customer:', customer.id);

  // Create a user
  const [user] = await sql`
    INSERT INTO "user" (customer_id, external_id, gender, phone)
    VALUES (${customer.id}, 'user_001', 'male', '+1234567890')
    RETURNING id
  `;
  console.log('Created user:', user.id);

  // Create attribute definitions
  // const [attrPlan] = await sql`
  //   INSERT INTO attribute_definition (customer_id, name, data_type)
  //   VALUES (${customer.id}, 'plan', 'text')
  //   RETURNING id
  // `;
  // const [attrHasInsurance] = await sql`
  //   INSERT INTO attribute_definition (customer_id, name, data_type)
  //   VALUES (${customer.id}, 'has_insurance', 'boolean')
  //   RETURNING id
  // `;
  // const [attrLoyaltyPoints] = await sql`
  //   INSERT INTO attribute_definition (customer_id, name, data_type)
  //   VALUES (${customer.id}, 'loyalty_points', 'number')
  //   RETURNING id
  // `;

  // console.log('Created attribute definitions:', attrPlan.id, attrHasInsurance.id, attrLoyaltyPoints.id);

  // Create user attributes
  // await sql`
  //   INSERT INTO user_attribute (user_id, attribute_definition_id, text_value)
  //   VALUES (${user.id}, ${attrPlan.id}, 'free')
  // `;
  // await sql`
  //   INSERT INTO user_attribute (user_id, attribute_definition_id, boolean_value)
  //   VALUES (${user.id}, ${attrHasInsurance.id}, false)
  // `;
  // await sql`
  //   INSERT INTO user_attribute (user_id, attribute_definition_id, number_value)
  //   VALUES (${user.id}, ${attrLoyaltyPoints.id}, 150)
  // `;

  // console.log('Created user attributes');

  // // Create a workflow: "Upgrade Prompt"
  // // Trigger: contact_added -> Wait 24h -> Branch (plan != pro) -> Send notification
  // const [workflow] = await sql`
  //   INSERT INTO workflow (customer_id, name, trigger_event, active)
  //   VALUES (${customer.id}, 'Upgrade Prompt', 'contact_added', true)
  //   RETURNING id
  // `;
  // console.log('Created workflow:', workflow.id);

  // // Create steps
  // const [stepWait] = await sql`
  //   INSERT INTO step (workflow_id, step_type, step_order)
  //   VALUES (${workflow.id}, 'wait', 1)
  //   RETURNING id
  // `;
  // const [stepBranch] = await sql`
  //   INSERT INTO step (workflow_id, step_type, step_order)
  //   VALUES (${workflow.id}, 'branch', 2)
  //   RETURNING id
  // `;
  // const [stepSend] = await sql`
  //   INSERT INTO step (workflow_id, step_type, step_order)
  //   VALUES (${workflow.id}, 'send', 3)
  //   RETURNING id
  // `;
  // console.log('Created steps:', stepWait.id, stepBranch.id, stepSend.id);

  // // Configure wait step: 24 hours, then go to branch
  // await sql`
  //   INSERT INTO step_wait (step_id, hours, next_step_id)
  //   VALUES (${stepWait.id}, 24, ${stepBranch.id})
  // `;

  // // Configure branch step: if plan != 'pro', go to send; otherwise exit
  // await sql`
  //   INSERT INTO step_branch (step_id, attribute_definition_id, operator, compare_value, true_step_id, false_step_id)
  //   VALUES (${stepBranch.id}, ${attrPlan.id}, '!=', 'pro', ${stepSend.id}, NULL)
  // `;

  // // Configure send step: notification content, no next step (end)
  // await sql`
  //   INSERT INTO step_send (step_id, title, body, next_step_id)
  //   VALUES (${stepSend.id}, 'Upgrade to Pro!', 'Get 50% off your first month of Pro. Limited time offer!', NULL)
  // `;
  // console.log('Configured step details');

  // // Create an enrollment for the user (free plan, should get notification)
  // await sql`
  //   INSERT INTO workflow_enrollment (user_id, workflow_id, current_step_id, status, process_at)
  //   VALUES (${user.id}, ${workflow.id}, ${stepWait.id}, 'active', NOW())
  // `;
  // console.log('Created enrollment for user (free plan)');

  console.log('Seed complete!');
  await sql.end();
}

seed().catch(console.error);
