import postgres from 'postgres';
import { Resource } from 'sst';

const sql = postgres(Resource.NeonDB.connectionString);

await sql`DROP TABLE IF EXISTS customer CASCADE`;
await sql`DROP TABLE IF EXISTS migrations CASCADE`;
console.log('Tables dropped.');
await sql.end();
