import { z } from "zod";
import * as schema from "../../db";

const [waitType, branchType, sendType, filterType] = schema.stepTypeEnum.enumValues;

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

const filterStepSchema = z.object({
  id: z.uuid(),
  type: z.literal(filterType),
  config: z.object({
    attribute_key: z.string(),
    operator: z.enum(["=", "!=", ">", "<"]),
    compare_value: z.union([z.string(), z.number(), z.boolean()]),
  }),
});

export const canvasStepSchema = z.discriminatedUnion("type", [
  waitStepSchema,
  branchStepSchema,
  sendStepSchema,
  filterStepSchema,
]);

export const canvasEdgeSchema = z.object({
  source: z.string(),
  target: z.string(),
  handle: z.boolean().optional(),
});

export const systemEvents = ["user_created", "user_updated"] as const;

export const triggerSchema = z.discriminatedUnion("trigger_type", [
  z.object({
    trigger_type: z.literal("system"),
    trigger_event: z.enum(systemEvents),
  }),
  z.object({
    trigger_type: z.literal("custom"),
    trigger_event: z.string().min(1),
  }),
]);

export const createWorkflowSchema = z
  .object({
    name: z.string(),
    steps: z.array(canvasStepSchema),
    edges: z.array(canvasEdgeSchema),
  })
  .and(triggerSchema);

export const updateWorkflowSchema = z
  .object({
    name: z.string(),
    steps: z.array(canvasStepSchema),
    edges: z.array(canvasEdgeSchema),
  })
  .and(triggerSchema);
