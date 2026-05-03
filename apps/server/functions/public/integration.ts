import { Hono, type Context } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { match } from "ts-pattern";
import { db } from "../../db";
import * as integrationRepo from "../../repository/integration";
import * as eventDefinitionRepo from "../../repository/event-definition";
import * as posthog from "../../services/posthog";
import {
  connect,
  listEvents,
  saveEventSelection,
  disconnect,
  getSummary,
  IntegrationAlreadyExistsError,
  type IntegrationDeps,
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

function makeDeps(): IntegrationDeps {
  return {
    db,
    repo: integrationRepo,
    eventDefinitions: eventDefinitionRepo,
    posthog: posthog as unknown as IntegrationDeps["posthog"],
    webhookBaseUrl: process.env.WEBHOOK_BASE_URL ?? "",
  };
}

type MappedPosthogError = {
  status: 502 | 503;
  body: { code: string };
  retryAfter?: string;
};

function mapPosthogError(err: unknown): MappedPosthogError | null {
  return match(err)
    .returnType<MappedPosthogError | null>()
    .when(
      (e) => e instanceof posthog.PosthogAuthError,
      () => ({ status: 502, body: { code: "posthog_auth_failed" } })
    )
    .when(
      (e) => e instanceof posthog.PosthogTransientError,
      () => ({
        status: 503,
        body: { code: "posthog_unavailable" },
        retryAfter: "30",
      })
    )
    .otherwise(() => null);
}

function getCustomerId(c: Context): string {
  return c.req.header("x-customer-id")!;
}

function integrationNotFound(c: Context) {
  return c.json({ error: { code: "integration_not_found" } }, 404);
}

function respondWithMappedError(c: Context, err: unknown) {
  if (err instanceof IntegrationAlreadyExistsError) {
    return c.json({ error: { code: "integration_already_exists" } }, 409);
  }

  const mapped = mapPosthogError(err);
  if (!mapped) return null;

  if (mapped.retryAfter) c.header("Retry-After", mapped.retryAfter);
  return c.json(mapped.body, mapped.status);
}

async function handleIntegrationAction(
  c: Context,
  action: () => Promise<Response>
): Promise<Response> {
  try {
    return await action();
  } catch (err) {
    const response = respondWithMappedError(c, err);
    if (response) return response;
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
    const customerId = getCustomerId(c);
    const summary = await getSummary(makeDeps(), { customerId });
    if (!summary) return integrationNotFound(c);
    return c.json(summary, 200);
  })
  .post(
    "/api/integrations/posthog/connect",
    zValidator("json", connectBodySchema),
    async (c) => {
      const customerId = getCustomerId(c);
      const { personal_api_key, project_id, region } = c.req.valid("json");

      return handleIntegrationAction(c, async () => {
        const result = await connect(makeDeps(), {
          customerId,
          personalApiKey: personal_api_key,
          projectId: project_id,
          region,
        });
        return c.json(result, 201);
      });
    }
  )
  .get(
    "/api/integrations/posthog/events",
    zValidator("query", eventsQuerySchema),
    async (c) => {
      const customerId = getCustomerId(c);
      const { days, limit, include_autocaptured } = c.req.valid("query");

      return handleIntegrationAction(c, async () => {
        const events = await listEvents(makeDeps(), {
          customerId,
          days,
          limit,
          includeAutocaptured: include_autocaptured,
        });
        if (events === null) return integrationNotFound(c);
        return c.json(events, 200);
      });
    }
  )
  .post(
    "/api/integrations/posthog/events/selection",
    zValidator("json", eventSelectionBodySchema),
    async (c) => {
      const customerId = getCustomerId(c);
      const { events } = c.req.valid("json");

      return handleIntegrationAction(c, async () => {
        const result = await saveEventSelection(makeDeps(), {
          customerId,
          events,
        });
        if (result === null) return integrationNotFound(c);
        return c.json(result, 200);
      });
    }
  )
  .delete("/api/integrations/posthog", async (c) => {
    const customerId = getCustomerId(c);
    const ok = await disconnect(makeDeps(), { customerId });
    if (!ok) return integrationNotFound(c);
    return c.body(null, 204);
  });

export type IntegrationAppType = typeof integrationApp;
