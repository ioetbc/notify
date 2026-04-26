import postgres from 'postgres';
import { Resource } from 'sst';
import { readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const sql = postgres(Resource.NeonDB.connectionString);

async function runMigrations() {
  // Create migrations tracking table if it doesn't exist
  await sql`
    CREATE TABLE IF NOT EXISTS migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  // Get already applied migrations
  const applied = await sql`SELECT name FROM migrations`;
  const appliedSet = new Set(applied.map(r => r.name));

  const files = readdirSync(__dirname)
    .filter(f => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    if (appliedSet.has(file)) {
      console.log(`Skipping: ${file} (already applied)`);
      continue;
    }

    console.log(`Running migration: ${file}`);
    await sql.file(join(__dirname, file));
    await sql`INSERT INTO migrations (name) VALUES (${file})`;
    console.log(`Completed: ${file}`);
  }

  console.log('All migrations complete.');
  await sql.end();
}

runMigrations().catch(console.error);
