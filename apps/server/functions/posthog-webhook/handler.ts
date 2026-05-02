import { Hono } from "hono";
import type { Context } from "hono";
import type { Db } from "../../db";
import { findByCustomerAndProvider } from "../../repository/integration";
import { verifySignature } from "../../services/posthog-webhook/verify";
import {
  PosthogEventPayloadSchema,
  translate,
} from "../../services/posthog-webhook/translate";

const SIGNATURE_HEADER = "x-notify-signature";

export type TrackEventFn = (
  customerId: string,
  externalId: string,
  eventName: string,
  properties?: Record<string, unknown>,
  timestamp?: string
) => Promise<unknown>;

export type HandlerDeps = {
  db: Db;
  trackEvent: TrackEventFn;
};

function jsonError(c: Context, status: 400 | 401 | 404, code: string, message: string) {
  return c.json({ error: { code, message } }, status);
}

export function createWebhookHandler(deps: HandlerDeps) {
  return async (c: Context) => {
    const customerId = c.req.param("customerId");
    if (!customerId) {
      return jsonError(c, 400, "missing_customer_id", "Missing customerId path param");
    }

    const signature = c.req.header(SIGNATURE_HEADER);
    if (!signature) {
      return jsonError(c, 401, "missing_signature", "Missing X-Notify-Signature header");
    }

    const integration = await findByCustomerAndProvider(deps.db, customerId, "posthog");
    if (!integration) {
      return jsonError(c, 404, "integration_not_found", "No PostHog integration for customer");
    }

    const rawBody = new Uint8Array(await c.req.raw.arrayBuffer());

    const secret = Buffer.from(
      integration.config.webhook_secret_encrypted,
      "base64"
    ).toString("utf-8");

    if (!verifySignature(secret, rawBody, signature)) {
      return jsonError(c, 401, "invalid_signature", "Signature verification failed");
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(new TextDecoder().decode(rawBody));
    } catch {
      return jsonError(c, 400, "invalid_json", "Body is not valid JSON");
    }

    const result = PosthogEventPayloadSchema.safeParse(parsedJson);
    if (!result.success) {
      return jsonError(
        c,
        400,
        "invalid_payload",
        "Payload missing required fields (event, distinct_id)"
      );
    }

    const translated = translate(result.data);

    if (translated.posthogEventUuid) {
      console.log(
        JSON.stringify({
          msg: "posthog_webhook_received",
          customer_id: customerId,
          posthog_event_uuid: translated.posthogEventUuid,
          event: translated.event,
        })
      );
    }

    await deps.trackEvent(
      customerId,
      translated.externalId,
      translated.event,
      translated.properties,
      translated.timestamp
    );

    return c.json({ accepted: true }, 202);
  };
}

export function createWebhookApp(deps: HandlerDeps) {
  const app = new Hono();
  app.post("/webhooks/posthog/:customerId", createWebhookHandler(deps));
  return app;
}
