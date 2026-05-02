import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../db/schema";
import { readFileSync } from "fs";
import { join } from "path";

const migrationsDir = join(import.meta.dir, "../drizzle");

type Journal = { entries: { idx: number; tag: string }[] };

function readMigration(filename: string): string {
  return readFileSync(join(migrationsDir, filename), "utf-8");
}

function loadMigrationFiles(): string[] {
  const journal: Journal = JSON.parse(
    readFileSync(join(migrationsDir, "meta/_journal.json"), "utf-8"),
  );
  return journal.entries
    .sort((a, b) => a.idx - b.idx)
    .map((e) => `${e.tag}.sql`);
}

/**
 * Splits a Drizzle Kit migration on the `--> statement-breakpoint` markers
 * and executes each statement individually. This avoids wrapping
 * `ALTER TYPE ... ADD VALUE` inside a transaction (which PG disallows).
 */
async function applyMigration(client: PGlite, sql: string) {
  const statements = sql
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);

  for (const stmt of statements) {
    await client.exec(stmt);
  }
}

export async function createTestDb() {
  const client = new PGlite();

  for (const file of loadMigrationFiles()) {
    await applyMigration(client, readMigration(file));
  }

  const db = drizzle(client, { schema });

  return { db, client };
}

export async function resetTestDb(client: PGlite) {
  const { rows } = await client.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename != '__drizzle_migrations'`,
  );
  if (rows.length === 0) return;
  const list = rows.map((r) => `"public"."${r.tablename}"`).join(", ");
  await client.exec(`TRUNCATE ${list} RESTART IDENTITY CASCADE;`);
}

export type TestDb = Awaited<ReturnType<typeof createTestDb>>["db"];
