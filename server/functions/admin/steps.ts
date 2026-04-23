import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, step, stepWait, stepBranch, stepSend } from "../../db";

const updateStepSchema = z.object({
  hours: z.number().optional(),
  user_column: z.string().optional(),
  operator: z.string().optional(),
  compare_value: z.string().optional(),
  title: z.string().optional(),
  body: z.string().optional(),
});

const steps = new Hono()
  .put(
    "/:id",
    zValidator("json", updateStepSchema),
    async (c) => {
      const stepId = c.req.param("id");
      const body = c.req.valid("json");

      const existingStep = await db.query.step.findFirst({
        where: eq(step.id, stepId),
      });

      if (!existingStep) {
        return c.json({ error: "Step not found" }, 404);
      }

      if (existingStep.stepType === "wait" && body.hours !== undefined) {
        await db
          .update(stepWait)
          .set({ hours: body.hours })
          .where(eq(stepWait.stepId, stepId));
      } else if (existingStep.stepType === "branch") {
        const updates: Record<string, unknown> = {};
        if (body.user_column !== undefined) updates.userColumn = body.user_column;
        if (body.operator !== undefined) updates.operator = body.operator;
        if (body.compare_value !== undefined)
          updates.compareValue = body.compare_value;

        if (Object.keys(updates).length > 0) {
          await db
            .update(stepBranch)
            .set(updates)
            .where(eq(stepBranch.stepId, stepId));
        }
      } else if (existingStep.stepType === "send") {
        const updates: Record<string, unknown> = {};
        if (body.title !== undefined) updates.title = body.title;
        if (body.body !== undefined) updates.body = body.body;

        if (Object.keys(updates).length > 0) {
          await db
            .update(stepSend)
            .set(updates)
            .where(eq(stepSend.stepId, stepId));
        }
      }

      return c.json({ success: true }, 200);
    }
  );

export { steps };
