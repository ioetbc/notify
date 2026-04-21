import { Hono } from 'hono';
import { handle } from 'hono/aws-lambda';
import { neon } from '@neondatabase/serverless';
import { Resource } from 'sst';

const sql = neon(Resource.NeonDB.connectionString);
const app = new Hono();

// Public API - customer-facing endpoints
// These endpoints will be called by customers from their codebase
// to update user attributes and definitions

app.get('/', (c) => {
  return c.json({ api: 'public', version: '1.0.0' });
});

// TODO: Add authentication middleware for API key validation

// TODO: POST /users/:id/attributes - Update user attributes
// TODO: GET /users/:id/attributes - Get user attributes
// TODO: POST /definitions - Create attribute definitions
// TODO: GET /definitions - List attribute definitions

export const handler = handle(app);
