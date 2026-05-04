import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import * as service from "../../services/integration";
import {
  previewPosthogSchema,
  connectPosthogSchema,
  updatePosthogSchema,
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
  )
  .put(
    "/posthog",
    zValidator("json", updatePosthogSchema),
    async (c) => {
      const customerId = getCustomerId(c);
      const body = c.req.valid("json");

      try {
        const result = await service.updatePosthogIntegration(customerId, body);

        if ("error" in result) {
          if (result.error === "not_connected") {
            return c.json(
              { error: { code: "not_connected", message: "No PostHog integration found" } },
              404
            );
          }
          if (result.error === "team_id_change_not_allowed") {
            return c.json(
              {
                error: {
                  code: "team_id_change_not_allowed",
                  message: "Team ID cannot be changed. Disconnect and reconnect to use a different team.",
                },
              },
              422
            );
          }
        }

        return c.json({ ok: true }, 200);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to update integration";
        return c.json({ error: { code: "integration_error", message } }, 400);
      }
    }
  )
  .delete("/posthog/data", async (c) => {
    const customerId = getCustomerId(c);

    try {
      const result = await service.purgePosthogData(customerId);
      return c.json(result, 200);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to purge data";
      return c.json(
        { error: { code: "purge_error", message } },
        500
      );
    }
  })
  .delete("/posthog", async (c) => {
    const customerId = getCustomerId(c);

    try {
      const result = await service.disconnectPosthog(customerId);

      if ("error" in result) {
        return c.json(
          { error: { code: "not_connected", message: "No PostHog integration found" } },
          404
        );
      }

      return c.json({ ok: true }, 200);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to disconnect";
      return c.json(
        { error: { code: "disconnect_error", message } },
        500
      );
    }
  });

export { integrations };
