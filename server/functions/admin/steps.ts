import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, step } from "../../db";

const updateStepSchema = z.object({
  config: z.record(z.string(), z.unknown()),
});

const steps = new Hono().put(
  "/:id",
  zValidator("json", updateStepSchema),
  async (c) => {
    const stepId = c.req.param("id");
    const body = c.req.valid("json");

    const [updated] = await db
      .update(step)
      .set({ config: body.config })
      .where(eq(step.id, stepId))
      .returning();

    if (!updated) {
      return c.json({ error: "Step not found" }, 404);
    }

    return c.json({ success: true }, 200);
  }
);

export { steps };
