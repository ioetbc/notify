import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { Resource } from "sst";
import { match } from "ts-pattern";
import ws from "ws";
import * as schema from "./schema";

neonConfig.webSocketConstructor = ws;

type Env = "test" | "runtime";

const env: Env = process.env.NODE_ENV === "test" ? "test" : "runtime";

const connectionString = match(env)
  .with("test", () => "postgres://stub:stub@localhost:5432/stub")
  .with("runtime", () => Resource.NeonDB.connectionString)
  .exhaustive();

const pool = new Pool({ connectionString });

export const db = drizzle(pool, { schema });

export type Db = PgDatabase<any, typeof schema>;

export * from "./schema";
