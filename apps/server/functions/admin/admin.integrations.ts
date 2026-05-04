import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import * as service from "../../services/integration";
import {
  previewPosthogSchema,
  connectPosthogSchema,
} from "../../schemas/integration";

function getCustomerId(c: {
  req: { header: (name: string) => string | undefined };
}) {
  const customerId = c.req.header("x-customer-id");
  if (!customerId) throw new Error("Missing X-Customer-Id header");
  return customerId;
}

const integrations = new Hono()
  .get("/posthog", async (c) => {
    const customerId = getCustomerId(c);
    const result = await service.getPosthogIntegration(customerId);
    if (!result) {
      return c.json({ connected: false }, 200);
    }
    return c.json({ connected: true, integration: result }, 200);
  })
  .post(
    "/posthog/preview",
    zValidator("json", previewPosthogSchema),
    async (c) => {
      const { pat, team_id } = c.req.valid("json");
      try {
        const result = await service.previewPosthogEvents(pat, team_id);
        return c.json(result, 200);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to connect to PostHog";
        return c.json({ error: { code: "posthog_error", message } }, 400);
      }
    }
  )
  .post(
    "/posthog",
    zValidator("json", connectPosthogSchema),
    async (c) => {
      const customerId = getCustomerId(c);
      const body = c.req.valid("json");

      const webhookBaseUrl =
        process.env.PUBLIC_API_URL ?? c.req.url.replace(/\/integrations.*/, "");

      try {
        const result = await service.connectPosthog(
          customerId,
          body.pat,
          body.team_id,
          body.identity_field,
          body.enabled_events,
          webhookBaseUrl
        );
        return c.json(result, 201);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to create integration";
        return c.json({ error: { code: "integration_error", message } }, 400);
      }
    }
  );

export { integrations };
