import { Hono, type Context } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { match } from "ts-pattern";
import { db } from "../../db";
import * as integrationRepo from "../../repository/integration";
import { createEventDefinitionRepo } from "../../repository/event-definition";
import { httpPosthogAdapter } from "../../services/posthog";
import {
  makePosthogIntegration,
  PosthogIntegrationError,
  type IntegrationDeps,
  type PosthogIntegrationPort,
} from "../../services/integration";

const connectBodySchema = z.object({
  personal_api_key: z.string().min(1),
  project_id: z.string().min(1),
  region: z.enum(["us", "eu"]).default("us"),
});

const eventsQuerySchema = z.object({
  days: z.coerce.number().int().positive().max(365).default(30),
  limit: z.coerce.number().int().positive().max(500).default(50),
  include_autocaptured: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
});

const eventSelectionBodySchema = z.object({
  events: z.array(
    z.object({
      name: z.string().min(1),
      volume: z.number().int().nonnegative().nullable().optional(),
    })
  ),
});

const eventDefinitions = createEventDefinitionRepo(db);

function makeIntegration(): PosthogIntegrationPort {
  const deps: IntegrationDeps = {
    db,
    repo: integrationRepo,
    eventDefinitions,
    posthog: httpPosthogAdapter,
    webhookBaseUrl: process.env.WEBHOOK_BASE_URL ?? "",
  };
  return makePosthogIntegration(deps);
}

function getCustomerId(c: Context): string {
  return c.req.header("x-customer-id")!;
}

async function reply<T>(
  c: Context,
  action: () => Promise<T>,
  successStatus: 200 | 201 | 204
): Promise<Response> {
  try {
    const result = await action();
    if (successStatus === 204) return c.body(null, 204);
    return c.json(result as object, successStatus);
  } catch (err) {
    if (err instanceof PosthogIntegrationError) {
      return match(err.detail)
        .with({ kind: "auth_failed" }, () =>
          c.json({ error: { code: "posthog_auth_failed" } }, 502)
        )
        .with({ kind: "transient" }, (d) => {
          if (d.retryAfterSec !== null) {
            c.header("Retry-After", String(d.retryAfterSec));
          }
          return c.json({ error: { code: "posthog_unavailable" } }, 503);
        })
        .with({ kind: "already_exists" }, () =>
          c.json({ error: { code: "integration_already_exists" } }, 409)
        )
        .with({ kind: "not_found" }, () =>
          c.json({ error: { code: "integration_not_found" } }, 404)
        )
        .with({ kind: "upstream" }, () =>
          c.json({ error: { code: "posthog_upstream_error" } }, 502)
        )
        .exhaustive() as Response;
    }
    throw err;
  }
}

export const integrationApp = new Hono()
  .use("/api/integrations/*", async (c, next) => {
    const customerId = c.req.header("x-customer-id");
    if (!customerId) {
      return c.json({ error: { code: "unauthorized" } }, 401);
    }
    await next();
  })
  .get("/api/integrations/posthog", async (c) => {
    const summary = await makeIntegration().getSummary({
      customerId: getCustomerId(c),
    });
    if (!summary) return c.json({ error: { code: "integration_not_found" } }, 404);
    return c.json(summary, 200);
  })
  .post(
    "/api/integrations/posthog/connect",
    zValidator("json", connectBodySchema),
    (c) => {
      const { personal_api_key, project_id, region } = c.req.valid("json");
      return reply(
        c,
        () =>
          makeIntegration().connect({
            customerId: getCustomerId(c),
            personalApiKey: personal_api_key,
            projectId: project_id,
            region,
          }).then(({ integrationId }) => ({ integration_id: integrationId })),
        201
      );
    }
  )
  .get(
    "/api/integrations/posthog/events",
    zValidator("query", eventsQuerySchema),
    (c) => {
      const { days, limit, include_autocaptured } = c.req.valid("query");
      return reply(
        c,
        () =>
          makeIntegration().listEvents({
            customerId: getCustomerId(c),
            days,
            limit,
            includeAutocaptured: include_autocaptured,
          }),
        200
      );
    }
  )
  .post(
    "/api/integrations/posthog/events/selection",
    zValidator("json", eventSelectionBodySchema),
    (c) => {
      const { events } = c.req.valid("json");
      return reply(
        c,
        () =>
          makeIntegration()
            .saveEvents({ customerId: getCustomerId(c), events })
            .then(({ eventNames }) => ({ event_names: eventNames })),
        200
      );
    }
  )
  .delete("/api/integrations/posthog", (c) =>
    reply(
      c,
      async () => {
        const ok = await makeIntegration().disconnect({
          customerId: getCustomerId(c),
        });
        if (!ok) throw new PosthogIntegrationError({ kind: "not_found" });
      },
      204
    )
  );

export type IntegrationAppType = typeof integrationApp;
