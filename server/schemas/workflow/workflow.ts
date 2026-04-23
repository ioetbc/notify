import { z } from "zod";
import * as schema from "../../db";

const [waitType, branchType, sendType] = schema.stepTypeEnum.enumValues;

const waitStepSchema = z.object({
  id: z.uuid(),
  type: z.literal(waitType),
  config: z.object({
    hours: z.number(),
  }),
});

const branchStepSchema = z.object({
  id: z.uuid(),
  type: z.literal(branchType),
  config: z.object({
    user_column: z.string(),
    operator: z.enum(["=", "!=", "exists", "not_exists"]),
    compare_value: z.string().optional(),
  }),
});

const sendStepSchema = z.object({
  id: z.uuid(),
  type: z.literal(sendType),
  config: z.object({
    title: z.string(),
    body: z.string(),
  }),
});

export const canvasStepSchema = z.discriminatedUnion("type", [
  waitStepSchema,
  branchStepSchema,
  sendStepSchema,
]);

export const canvasEdgeSchema = z.object({
  source: z.string(),
  target: z.string(),
  handle: z.string().optional(),
});

export const createWorkflowSchema = z.object({
  name: z.string(),
  trigger_event: z.enum(schema.triggerEventEnum.enumValues),
  customer_id: z.string(),
  steps: z.array(canvasStepSchema),
  edges: z.array(canvasEdgeSchema),
});

export const updateWorkflowSchema = z.object({
  name: z.string(),
  trigger_event: z.enum(schema.triggerEventEnum.enumValues),
  steps: z.array(canvasStepSchema),
  edges: z.array(canvasEdgeSchema),
});
