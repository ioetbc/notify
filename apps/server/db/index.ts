import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { Resource } from "sst";
import ws from "ws";
import * as schema from "./schema";

neonConfig.webSocketConstructor = ws;

const pool = new Pool({ connectionString: Resource.NeonDB.connectionString });
export const db = drizzle(pool, { schema });

export type Db = PgDatabase<any, typeof schema>;

export * from "./schema";
