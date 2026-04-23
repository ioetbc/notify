import { Hono } from "hono";
import { handle } from "hono/aws-lambda";
import { db, attributeDefinition } from "../../db";
import { workflows } from "./workflows";
import { steps } from "./steps";

const app = new Hono();

const routes = app
  .route("/workflows", workflows)
  .route("/steps", steps)
  .get("/user-columns", async (c) => {
    const attributes = await db
      .select({
        id: attributeDefinition.id,
        name: attributeDefinition.name,
        dataType: attributeDefinition.dataType,
      })
      .from(attributeDefinition)
      .orderBy(attributeDefinition.name);

    return c.json({ columns: attributes }, 200);
  });

export type AppType = typeof routes;
export const handler = handle(app);
