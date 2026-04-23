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
        keys: sql<string[]>`array_agg(DISTINCT jsonb_object_keys(${user.attributes}))`,
      })
      .from(user)
      .where(eq(user.customerId, customerId));

    const columns = (result[0]?.keys ?? []).map((name) => ({ name }));

    return c.json({ columns }, 200);
  });

export type AppType = typeof routes;
export const handler = handle(app);
