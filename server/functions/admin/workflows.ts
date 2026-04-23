import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { eq, desc } from "drizzle-orm";
import { z } from "zod";
import * as schema from "../../db";

const [waitType, branchType, sendType] = schema.stepTypeEnum.enumValues;

const waitStepSchema = z.object({
  id: z.string().uuid(),
  type: z.literal(waitType),
  config: z.object({
    hours: z.number(),
  }),
});

const branchStepSchema = z.object({
  id: z.string().uuid(),
  type: z.literal(branchType),
  config: z.object({
    user_column: z.string(),
    operator: z.enum(["=", "!=", "exists", "not_exists"]),
    compare_value: z.string().nullable(),
  }),
});

const sendStepSchema = z.object({
  id: z.string().uuid(),
  type: z.literal(sendType),
  config: z.object({
    title: z.string(),
    body: z.string(),
  }),
});

const canvasStepSchema = z.discriminatedUnion("type", [
  waitStepSchema,
  branchStepSchema,
  sendStepSchema,
]);

const canvasEdgeSchema = z.object({
  source: z.string(),
  target: z.string(),
  handle: z.string().optional(),
});

const createWorkflowSchema = z.object({
  name: z.string(),
  trigger_event: z.enum(schema.triggerEventEnum.enumValues),
  customer_id: z.string().optional(),
  steps: z.array(canvasStepSchema),
  edges: z.array(canvasEdgeSchema),
});

const updateWorkflowSchema = z.object({
  name: z.string(),
  trigger_event: z.enum(schema.triggerEventEnum.enumValues),
  steps: z.array(canvasStepSchema),
  edges: z.array(canvasEdgeSchema),
});

type CanvasStep = z.infer<typeof canvasStepSchema>;
type CanvasEdge = z.infer<typeof canvasEdgeSchema>;

async function insertSteps(workflowId: string, steps: CanvasStep[]) {
  if (!steps.length) return;

  const payload = steps.map((step) => ({ id: step.id, workflowId, type: step.type, config: step.config }))

  await schema.db.insert(schema.step).values(payload);
}

async function insertEdges(workflowId: string, edges: CanvasEdge[]) {
  if (!edges.length) return;

  const payload = edges.map((e) => ({
    workflowId,
    source: e.source,
    target: e.target,
    handle: e.handle ?? null,
  }))

  await schema.db.insert(schema.stepEdge).values(payload);
}

const workflows = new Hono()
  .get("/:id", async (c) => {
    const workflowId = c.req.param("id");

    const workflowResult = await schema.db.query.workflow.findFirst({
      where: eq(schema.workflow.id, workflowId),
    });

    if (!workflowResult) {
      return c.json({ error: "Workflow not found" }, 404);
    }

    const steps = await schema.db
      .select()
      .from(schema.step)
      .where(eq(schema.step.workflowId, workflowId));

    const edges = await schema.db
      .select()
      .from(schema.stepEdge)
      .where(eq(schema.stepEdge.workflowId, workflowId));

    return c.json({ workflow: workflowResult, steps, edges }, 200);
  })
  .get("/", async (c) => {
    const allWorkflows = await schema.db
      .select()
      .from(schema.workflow)
      .orderBy(desc(schema.workflow.createdAt))
      .limit(10);
    return c.json({ workflows: allWorkflows }, 200);
  })
  .post(
    "/",
    zValidator("json", createWorkflowSchema),
    async (c) => {
      const body = c.req.valid("json");
      
      const customer = await schema.db.query.customer.findFirst();

      if (!customer) {
        throw new Error("No customer found in db")
      }

      console.log('workflow body', JSON.stringify(body, null, 4))

      const [workflow] = await schema.db
        .insert(schema.workflow)
        .values({
          customerId: customer.id,
          name: body.name,
          triggerEvent: body.trigger_event,
          status: "active",
        })
        .returning();

      await insertSteps(workflow.id, body.steps);
      await insertEdges(workflow.id, body.edges);

      return c.json({ workflow }, 200);
    }
  )
  .put(
    "/:id",
    zValidator("json", updateWorkflowSchema),
    async (c) => {
      const body = c.req.valid("json");
      const workflowId = c.req.param("id");

      const [updatedWorkflow] = await schema.db
        .update(schema.workflow)
        .set({ name: body.name, triggerEvent: body.trigger_event })
        .where(eq(schema.workflow.id, workflowId))
        .returning();

      if (!updatedWorkflow) {
        return c.json({ error: "Workflow not found" }, 404);
      }

      await schema.db.delete(schema.step).where(eq(schema.step.workflowId, workflowId));

      await insertSteps(workflowId, body.steps);
      await insertEdges(workflowId, body.edges);

      return c.json({ workflow: updatedWorkflow }, 200);
    }
  );

export { workflows };
