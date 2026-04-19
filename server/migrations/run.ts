import { neon } from '@neondatabase/serverless';
import { Resource } from 'sst';
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const sql = neon(Resource.NeonDB.connectionString);

async function runMigrations() {
  const files = readdirSync(__dirname)
    .filter(f => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    console.log(`Running migration: ${file}`);
    const content = readFileSync(join(__dirname, file), 'utf-8');
    await sql.query(content);
    console.log(`Completed: ${file}`);
  }

  console.log('All migrations complete.');
}

runMigrations().catch(console.error);
