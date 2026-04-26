import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../db/schema";
import { readFileSync } from "fs";
import { join } from "path";

const migrationsDir = join(import.meta.dir, "../drizzle");

function readMigration(filename: string): string {
  return readFileSync(join(migrationsDir, filename), "utf-8");
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

  // Apply migrations in order
  const migrations = [
    "0000_lyrical_vulcan.sql",
    "0001_nosy_gorgon.sql",
    "0002_orange_goliath.sql",
    "0003_sour_electro.sql",
  ];

  for (const file of migrations) {
    await applyMigration(client, readMigration(file));
  }

  const db = drizzle(client, { schema });
  return { db, client };
}

export type TestDb = Awaited<ReturnType<typeof createTestDb>>["db"];
