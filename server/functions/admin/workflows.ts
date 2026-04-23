import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { match } from "ts-pattern";
import { eq, desc } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  customer,
  workflow,
  step,
  stepWait,
  stepBranch,
  stepSend,
  triggerEventEnum,
  stepTypeEnum,
  branchOperatorEnum,
} from "../../db";

const [waitType, branchType, sendType] = stepTypeEnum.enumValues;

const waitStepSchema = z.object({
  id: z.string(),
  type: z.literal(waitType),
  config: z.object({
    hours: z.number(),
  }),
});

const branchStepSchema = z.object({
  id: z.string(),
  type: z.literal(branchType),
  config: z.object({
    user_column: z.string(),
    operator: z.enum(branchOperatorEnum.enumValues),
    compare_value: z.string().nullable(),
  }),
});

const sendStepSchema = z.object({
  id: z.string(),
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
  sourceHandle: z.string().optional(),
});

const createWorkflowSchema = z.object({
  name: z.string(),
  trigger_event: z.enum(triggerEventEnum.enumValues),
  customer_id: z.string().optional(),
  steps: z.array(canvasStepSchema),
  edges: z.array(canvasEdgeSchema),
});

const updateWorkflowSchema = z.object({
  name: z.string(),
  trigger_event: z.enum(triggerEventEnum.enumValues),
  steps: z.array(canvasStepSchema),
  edges: z.array(canvasEdgeSchema),
});

type CanvasStep = z.infer<typeof canvasStepSchema>;
type CanvasEdge = z.infer<typeof canvasEdgeSchema>;

async function insertSteps(workflowId: string, canvasSteps: CanvasStep[]) {
  const idMap = new Map<string, string>();

  for (const canvasStep of canvasSteps) {
    const [dbStep] = await db
      .insert(step)
      .values({ workflowId, stepType: canvasStep.type })
      .returning();
    idMap.set(canvasStep.id, dbStep.id);

    await match(canvasStep)
      .with({ type: "wait" }, (s) =>
        db.insert(stepWait).values({
          stepId: dbStep.id,
          hours: s.config.hours,
        })
      )
      .with({ type: "branch" }, (s) =>
        db.insert(stepBranch).values({
          stepId: dbStep.id,
          userColumn: s.config.user_column,
          operator: s.config.operator,
          compareValue: s.config.compare_value,
        })
      )
      .with({ type: "send" }, (s) =>
        db.insert(stepSend).values({
          stepId: dbStep.id,
          title: s.config.title,
          body: s.config.body,
        })
      )
      .exhaustive();
  }

  return idMap;
}

async function linkEdges(
  idMap: Map<string, string>,
  canvasSteps: CanvasStep[],
  edges: CanvasEdge[]
) {
  for (const edge of edges) {
    const sourceDbId = idMap.get(edge.source);
    const targetDbId = idMap.get(edge.target);
    if (!sourceDbId || !targetDbId) continue;

    const sourceStep = canvasSteps.find((s) => s.id === edge.source);
    if (!sourceStep) continue;

    await match(sourceStep)
      .with({ type: "wait" }, () =>
        db
          .update(stepWait)
          .set({ nextStepId: targetDbId })
          .where(eq(stepWait.stepId, sourceDbId))
      )
      .with({ type: "send" }, () =>
        db
          .update(stepSend)
          .set({ nextStepId: targetDbId })
          .where(eq(stepSend.stepId, sourceDbId))
      )
      .with({ type: "branch" }, () => {
        const field =
          edge.sourceHandle === "yes" ? "trueStepId" : "falseStepId";
        return db
          .update(stepBranch)
          .set({ [field]: targetDbId })
          .where(eq(stepBranch.stepId, sourceDbId));
      })
      .exhaustive();
  }
}

const workflows = new Hono()
  .get("/:id", async (c) => {
    const workflowId = c.req.param("id");

    const workflowResult = await db.query.workflow.findFirst({
      where: eq(workflow.id, workflowId),
    });

    if (!workflowResult) {
      return c.json({ error: "Workflow not found" }, 404);
    }

    const steps = await db
      .select({
        id: step.id,
        stepType: step.stepType,
        waitHours: stepWait.hours,
        waitNextStepId: stepWait.nextStepId,
        branchUserColumn: stepBranch.userColumn,
        branchOperator: stepBranch.operator,
        branchCompareValue: stepBranch.compareValue,
        branchTrueStepId: stepBranch.trueStepId,
        branchFalseStepId: stepBranch.falseStepId,
        sendTitle: stepSend.title,
        sendBody: stepSend.body,
        sendNextStepId: stepSend.nextStepId,
      })
      .from(step)
      .leftJoin(stepWait, eq(stepWait.stepId, step.id))
      .leftJoin(stepBranch, eq(stepBranch.stepId, step.id))
      .leftJoin(stepSend, eq(stepSend.stepId, step.id))
      .where(eq(step.workflowId, workflowId));

    return c.json({ workflow: workflowResult, steps }, 200);
  })
  .get("/", async (c) => {
    const allWorkflows = await db
      .select()
      .from(workflow)
      .orderBy(desc(workflow.createdAt))
      .limit(10);
    return c.json({ workflows: allWorkflows }, 200);
  })
  .post(
    "/",
    zValidator("json", createWorkflowSchema),
    async (c) => {
      const body = c.req.valid("json");

      let customerId = body.customer_id;
      if (!customerId) {
        const existingCustomer = await db.query.customer.findFirst();
        if (existingCustomer) {
          customerId = existingCustomer.id;
        } else {
          const [newCustomer] = await db
            .insert(customer)
            .values({ email: "dev@example.com", name: "Dev Customer" })
            .returning();
          customerId = newCustomer.id;
        }
      }

      const [newWorkflow] = await db
        .insert(workflow)
        .values({
          customerId,
          name: body.name,
          triggerEvent: body.trigger_event,
          status: "active",
        })
        .returning();

      const idMap = await insertSteps(newWorkflow.id, body.steps);
      await linkEdges(idMap, body.steps, body.edges);

      return c.json({ workflow: newWorkflow, idMap: Object.fromEntries(idMap) }, 200);
    }
  )
  .put(
    "/:id",
    zValidator("json", updateWorkflowSchema),
    async (c) => {
      const body = c.req.valid("json");
      const workflowId = c.req.param("id");

      const [updatedWorkflow] = await db
        .update(workflow)
        .set({ name: body.name, triggerEvent: body.trigger_event })
        .where(eq(workflow.id, workflowId))
        .returning();

      if (!updatedWorkflow) {
        return c.json({ error: "Workflow not found" }, 404);
      }

      await db.delete(step).where(eq(step.workflowId, workflowId));

      const idMap = await insertSteps(workflowId, body.steps);
      await linkEdges(idMap, body.steps, body.edges);

      return c.json({
        workflow: updatedWorkflow,
        idMap: Object.fromEntries(idMap),
      }, 200);
    }
  );

export { workflows };
