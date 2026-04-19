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
    const result = await sql`SELECT version()`;
    return c.json({ version: result[0].version });
  })

export const handler = handle(app);