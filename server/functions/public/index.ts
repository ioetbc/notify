import { Hono } from "hono";
import { handle } from "hono/aws-lambda";
import { zValidator } from "@hono/zod-validator";
import * as service from "../../services/public";
import {
  updateUserAttributesSchema,
  trackEventSchema,
} from "../../schemas/public";
const app = new Hono();

function getCustomerId(c: { req: { header: (name: string) => string | undefined } }) {
  const customerId = c.req.header('x-customer-id');
  if (!customerId) throw new Error('Missing X-Customer-Id header');
  return customerId;
}

function errorResponse(code: string, message: string, status: number) {
  return { error: { code, message }, _status: status } as const;
}

const routes = app
  .patch(
    "/v1/users/:external_id",
    zValidator("json", updateUserAttributesSchema),
    async (c) => {
      const customerId = getCustomerId(c);
      const externalId = c.req.param("external_id");
      const { attributes } = c.req.valid("json");

      console.log('customerId', customerId)
      console.log('externalId', externalId)

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
  });

export type PublicAppType = typeof routes;
export const handler = handle(app);
