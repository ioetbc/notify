import { z } from "zod";

const attributeValue = z.union([z.string(), z.number(), z.boolean()]);

export type AttributeValue = z.infer<typeof attributeValue>;
export type Attributes = Record<string, AttributeValue>;

export const updateUserAttributesSchema = z.object({
  attributes: z.record(z.string(), attributeValue),
});

const eventNameRegex = /^[a-z0-9_]+$/;

export const trackEventSchema = z.object({
  external_id: z.string().min(1),
  event: z.string().min(1).regex(eventNameRegex, {
    message:
      "Event name must be lowercase alphanumeric with underscores only",
  }),
  properties: z.record(z.string(), z.unknown()).optional(),
  timestamp: z.iso.datetime().optional(),
});
