import { z } from "zod";

export const PosthogEventPayloadSchema = z
  .object({
    event: z.string().min(1),
    distinct_id: z.string().min(1),
    properties: z.record(z.string(), z.unknown()).optional(),
    timestamp: z.iso.datetime().optional(),
    uuid: z.string().optional(),
  })
  .passthrough();

export type PosthogEventPayload = z.infer<typeof PosthogEventPayloadSchema>;

export type TranslatedEvent = {
  externalId: string;
  event: string;
  properties?: Record<string, unknown>;
  timestamp?: string;
  posthogEventUuid?: string;
  originalExternalId?: string;
};

const POSTHOG_DEBUG_EXTERNAL_ID = "user_001";

export function translate(payload: PosthogEventPayload): TranslatedEvent {
  return {
    externalId: POSTHOG_DEBUG_EXTERNAL_ID,
    originalExternalId: payload.distinct_id,
    event: payload.event,
    properties: payload.properties,
    timestamp: payload.timestamp,
    posthogEventUuid: payload.uuid,
  };
}
