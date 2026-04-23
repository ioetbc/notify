import { Hono } from "hono";
import { handle } from "hono/aws-lambda";
import { db, user } from "../../db";
import { eq, sql } from "drizzle-orm";
import { workflows } from "./workflows";
const app = new Hono();

function getCustomerId(c: { req: { header: (name: string) => string | undefined } }) {
  const customerId = c.req.header('x-customer-id');
  if (!customerId) throw new Error('Missing X-Customer-Id header');
  return customerId;
}

const routes = app
  .route("/workflows", workflows)
  .get("/user-columns", async (c) => {
    const customerId = getCustomerId(c);

    const result = await db
      .select({
        key: sql<string>`k`,
        values: sql<string[]>`array_agg(DISTINCT v::text)`,
      })
      .from(
        sql`(SELECT k, ${user.attributes} -> k AS v FROM ${user}, jsonb_object_keys(${user.attributes}) AS k WHERE ${user.customerId} = ${customerId}) AS sub`
      )
      .groupBy(sql`k`);

    const columns = result.map((row) => ({
      name: row.key,
      values: row.values ?? [],
    }));

    return c.json({ columns }, 200);
  });

export type AppType = typeof routes;
export const handler = handle(app);
