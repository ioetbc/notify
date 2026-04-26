import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { Resource } from "sst";
import * as schema from "./schema";

const sql = neon(Resource.NeonDB.connectionString);
export const db = drizzle(sql, { schema });

export type Db = PgDatabase<any, typeof schema>;

export * from "./schema";
