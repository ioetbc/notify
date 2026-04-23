import postgres from 'postgres';
import { Resource } from 'sst';

const sql = postgres(Resource.NeonDB.connectionString);

await sql`DROP SCHEMA IF EXISTS drizzle CASCADE`;
await sql`DROP SCHEMA public CASCADE`;
await sql`CREATE SCHEMA public`;

console.log('Database reset complete.');
await sql.end();
