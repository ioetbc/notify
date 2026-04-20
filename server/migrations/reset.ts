import postgres from 'postgres';
import { Resource } from 'sst';

const sql = postgres(Resource.NeonDB.connectionString);

// Drop all tables (order matters for foreign keys, but CASCADE handles it)
await sql`DROP TABLE IF EXISTS workflow_enrollment CASCADE`;
await sql`DROP TABLE IF EXISTS step_wait CASCADE`;
await sql`DROP TABLE IF EXISTS step_branch CASCADE`;
await sql`DROP TABLE IF EXISTS step_send CASCADE`;
await sql`DROP TABLE IF EXISTS step CASCADE`;
await sql`DROP TABLE IF EXISTS workflow CASCADE`;
await sql`DROP TABLE IF EXISTS "user" CASCADE`;
await sql`DROP TABLE IF EXISTS customer CASCADE`;
await sql`DROP TABLE IF EXISTS migrations CASCADE`;

// Drop enum types
await sql`DROP TYPE IF EXISTS step_type CASCADE`;
await sql`DROP TYPE IF EXISTS trigger_event CASCADE`;
await sql`DROP TYPE IF EXISTS enrollment_status CASCADE`;
await sql`DROP TYPE IF EXISTS branch_operator CASCADE`;
await sql`DROP TYPE IF EXISTS gender CASCADE`;

console.log('All tables and types dropped.');
await sql.end();
