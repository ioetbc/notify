import { Hono } from "hono";
import { handle } from "hono/aws-lambda";
import { zValidator } from "@hono/zod-validator";
import * as service from "../../services/public";
import * as ingestService from "../../services/ingest";
import {
  createUserSchema,
  updateUserAttributesSchema,
  trackEventSchema,
  registerPushTokenSchema,
} from "../../schemas/public";
const app = new Hono();

function getCustomerId(c: { req: { header: (name: string) => string | undefined } }) {
  const customerId = c.req.header('x-customer-id');
  if (!customerId) throw new Error('Missing X-Customer-Id header');
  return customerId;
}

const routes = app
  .post(
    "/v1/users",
    zValidator("json", createUserSchema),
    async (c) => {
      const customerId = getCustomerId(c);
      const { external_id, phone, gender, attributes } = c.req.valid("json");

      const result = await service.createUser(
        customerId,
        external_id,
        phone,
        gender,
        attributes
      );

      if (!result) {
        return c.json(
          {
            error: {
              code: "user_already_exists",
              message: `A user with external_id '${external_id}' already exists`,
            },
          },
          409
        );
      }

      return c.json(result, 201);
    }
  )
  .patch(
    "/v1/users/:external_id",
    zValidator("json", updateUserAttributesSchema),
    async (c) => {
      const customerId = getCustomerId(c);
      const externalId = c.req.param("external_id");
      const { attributes } = c.req.valid("json");

      const result = await service.updateUserAttributes(
        customerId,
        externalId,
        attributes
      );

      if (!result) {
        return c.json(
          {
            error: {
              code: "user_not_found",
              message: `No user found with external_id '${externalId}'`,
            },
          },
          404
        );
      }

      return c.json(result, 200);
    }
  )
  .get("/v1/users/:external_id", async (c) => {
    const customerId = getCustomerId(c);
    const externalId = c.req.param("external_id");

    const result = await service.getUser(customerId, externalId);

    if (!result) {
      return c.json(
        {
          error: {
            code: "user_not_found",
            message: `No user found with external_id '${externalId}'`,
          },
        },
        404
      );
    }

    return c.json(result, 200);
  })
  .post(
    "/v1/users/:external_id/push-tokens",
    zValidator("json", registerPushTokenSchema),
    async (c) => {
      const customerId = getCustomerId(c);
      const externalId = c.req.param("external_id");
      const { token } = c.req.valid("json");

      const result = await service.registerPushToken(customerId, externalId, token);

      if (!result) {
        return c.json(
          {
            error: {
              code: "user_not_found",
              message: `No user found with external_id '${externalId}'`,
            },
          },
          404
        );
      }

      return c.json(result, 201);
    }
  )
  .post("/v1/events", zValidator("json", trackEventSchema), async (c) => {
    const customerId = getCustomerId(c);
    const body = c.req.valid("json");

    const result = await service.trackEvent(
      customerId,
      body.external_id,
      body.event,
      body.properties,
      body.timestamp
    );

    if (!result) {
      return c.json(
        {
          error: {
            code: "user_not_found",
            message: `No user found with external_id '${body.external_id}'`,
          },
        },
        404
      );
    }

    return c.json(result, 202);
  })
  .post("/ingest/posthog/:integrationId", async (c) => {
    const integrationId = c.req.param("integrationId");
    const token = c.req.header("x-notify-token");

    if (!token) {
      return c.json({ error: { code: "unauthorized", message: "Missing X-Notify-Token" } }, 401);
    }

    const valid = await ingestService.verifyWebhookSecret(integrationId, token);
    if (!valid) {
      return c.json({ error: { code: "unauthorized", message: "Invalid token" } }, 401);
    }

    const payload = await c.req.json();

    const result = await ingestService.ingestPosthogEvent(integrationId, payload);

    if ("error" in result) {
      return c.json({ ok: true, dropped: true, reason: result.error }, 200);
    }

    return c.json({ ok: true, workflows_triggered: result.workflows_triggered }, 200);
  });

export type PublicAppType = typeof routes;
export const handler = handle(app);
