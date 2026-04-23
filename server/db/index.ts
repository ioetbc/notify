import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { Resource } from "sst";
import * as schema from "./schema";

const sql = neon(Resource.NeonDB.connectionString);
export const db = drizzle(sql, { schema });

// Re-export schema for convenience
export * from "./schema";
