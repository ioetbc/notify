import { Hono } from "hono";
import type { Context } from "hono";
import type { Db } from "../../db";
import { findByCustomerAndProvider } from "../../repository/integration";
import { computeSignature, verifySignature } from "../../services/posthog-webhook/verify";
import {
  PosthogEventPayloadSchema,
  translate,
} from "../../services/posthog-webhook/translate";

const SIGNATURE_HEADER = "x-notify-signature";
const SKIP_SIGNATURE_ENV = "POSTHOG_WEBHOOK_SKIP_SIGNATURE";

function logWebhook(message: string, fields: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ msg: message, ...fields }));
}

function signaturePreview(signature: string) {
  return {
    length: signature.length,
    prefix: signature.slice(0, 8),
    suffix: signature.slice(-8),
  };
}

function shouldSkipSignatureVerification() {
  return process.env[SKIP_SIGNATURE_ENV] === "true";
}

export type TrackEventFn = (
  customerId: string,
  integrationId: string,
  externalId: string,
  eventName: string,
  properties?: Record<string, unknown>,
  timestamp?: string
) => Promise<unknown>;

export type HandlerDeps = {
  db: Db;
  trackPosthogEvent: TrackEventFn;
};

function jsonError(c: Context, status: 400 | 401 | 404, code: string, message: string) {
  return c.json({ error: { code, message } }, status);
}

export function createWebhookHandler(deps: HandlerDeps) {
  return async (c: Context) => {
    const customerId = c.req.param("customerId");

    if (!customerId) {
      logWebhook("posthog_webhook_missing_customer_id");
      return jsonError(c, 400, "missing_customer_id", "Missing customerId path param");
    }

    logWebhook("posthog_webhook_received", { customer_id: customerId });

    const signature = c.req.header(SIGNATURE_HEADER);

    if (!signature) {
      logWebhook("posthog_webhook_missing_signature", { customer_id: customerId });
      return jsonError(c, 401, "missing_signature", "Missing X-Notify-Signature header");
    }

    const integration = await findByCustomerAndProvider(deps.db, customerId, "posthog");

    if (!integration) {
      logWebhook("posthog_webhook_integration_not_found", { customer_id: customerId });
      return jsonError(c, 404, "integration_not_found", "No PostHog integration for customer");
    }

    const rawBody = new Uint8Array(await c.req.raw.arrayBuffer());

    logWebhook("posthog_webhook_integration_found", {
      customer_id: customerId,
      integration_id: integration.id,
      body_bytes: rawBody.byteLength,
    });

    const secret = Buffer.from(
      integration.config.webhook_secret_encrypted,
      "base64"
    ).toString("utf-8");

    const expectedSignature = computeSignature(secret, rawBody);

    if (!verifySignature(secret, rawBody, signature)) {
      logWebhook("posthog_webhook_invalid_signature", {
        customer_id: customerId,
        integration_id: integration.id,
        received_signature: signaturePreview(signature),
        expected_signature: signaturePreview(expectedSignature),
      });

      if (!shouldSkipSignatureVerification()) {
        return jsonError(c, 401, "invalid_signature", "Signature verification failed");
      }

      logWebhook("posthog_webhook_signature_verification_skipped", {
        customer_id: customerId,
        integration_id: integration.id,
        env: SKIP_SIGNATURE_ENV,
      });
    } else {
      logWebhook("posthog_webhook_signature_verified", {
        customer_id: customerId,
        integration_id: integration.id,
      });
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(new TextDecoder().decode(rawBody));
    } catch {
      logWebhook("posthog_webhook_invalid_json", {
        customer_id: customerId,
        integration_id: integration.id,
      });
      return jsonError(c, 400, "invalid_json", "Body is not valid JSON");
    }

    const result = PosthogEventPayloadSchema.safeParse(parsedJson);

    if (!result.success) {
      logWebhook("posthog_webhook_invalid_payload", {
        customer_id: customerId,
        integration_id: integration.id,
        issues: result.error.issues.map((issue) => ({
          path: issue.path.join("."),
          code: issue.code,
        })),
      });
      return jsonError(
        c,
        400,
        "invalid_payload",
        "Payload missing required fields (event, distinct_id)"
      );
    }

    const translated = translate(result.data);

    logWebhook("posthog_webhook_translated", {
      customer_id: customerId,
      integration_id: integration.id,
      event: translated.event,
      external_id: translated.externalId,
      original_external_id: translated.originalExternalId,
      posthog_event_uuid: translated.posthogEventUuid,
      has_properties: Boolean(translated.properties),
      timestamp: translated.timestamp,
    });

    await deps.trackPosthogEvent(
      customerId,
      integration.id,
      translated.externalId,
      translated.event,
      translated.properties,
      translated.timestamp
    );

    logWebhook("posthog_webhook_track_event_completed", {
      customer_id: customerId,
      integration_id: integration.id,
      event: translated.event,
      external_id: translated.externalId,
      original_external_id: translated.originalExternalId,
      posthog_event_uuid: translated.posthogEventUuid,
    });

    return c.json({ accepted: true }, 202);
  };
}

export function createWebhookApp(deps: HandlerDeps) {
  const app = new Hono();
  app.post("/webhooks/posthog/:customerId", createWebhookHandler(deps));
  return app;
}
