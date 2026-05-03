import { Hono } from "hono";
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

export const integrationApp = new Hono()
  .use("/api/integrations/*", async (c, next) => {
    const customerId = c.req.header("x-customer-id");
    if (!customerId) {
      return c.json({ error: { code: "unauthorized" } }, 401);
    }
    c.set("customerId" as never, customerId as never);
    await next();
  })
  .get("/api/integrations/posthog", async (c) => {
    const customerId = c.req.header("x-customer-id")!;
    const summary = await getSummary(makeDeps(), { customerId });
    if (!summary) {
      return c.json({ error: { code: "integration_not_found" } }, 404);
    }
    return c.json(summary, 200);
  })
  .post(
    "/api/integrations/posthog/connect",
    zValidator("json", connectBodySchema),
    async (c) => {
      const customerId = c.req.header("x-customer-id")!;
      const { personal_api_key, project_id, region } = c.req.valid("json");

      console.log("[POST /api/integrations/posthog/connect] received", {
        customerId,
        projectId: project_id,
        region,
        webhookBaseUrl: process.env.WEBHOOK_BASE_URL ?? "(unset)",
      });

      try {
        const result = await connect(makeDeps(), {
          customerId,
          personalApiKey: personal_api_key,
          projectId: project_id,
          region,
        });
        console.log("[POST /api/integrations/posthog/connect] 201", {
          customerId,
          integrationId: result.integration_id,
        });
        return c.json(result, 201);
      } catch (err) {
        if (err instanceof IntegrationAlreadyExistsError) {
          console.warn(
            "[POST /api/integrations/posthog/connect] 409 already exists",
            { customerId }
          );
          return c.json(
            { error: { code: "integration_already_exists" } },
            409
          );
        }
        const mapped = mapPosthogError(err);
        if (mapped) {
          console.error(
            "[POST /api/integrations/posthog/connect] mapped posthog error",
            {
              customerId,
              status: mapped.status,
              code: mapped.body.code,
              errorName: (err as Error)?.name,
              errorMessage: (err as Error)?.message,
            }
          );
          if (mapped.retryAfter) c.header("Retry-After", mapped.retryAfter);
          return c.json(mapped.body, mapped.status);
        }
        console.error(
          "[POST /api/integrations/posthog/connect] unmapped error",
          {
            customerId,
            errorName: (err as Error)?.name,
            errorMessage: (err as Error)?.message,
            errorStack: (err as Error)?.stack,
          }
        );
        throw err;
      }
    }
  )
  .get(
    "/api/integrations/posthog/events",
    zValidator("query", eventsQuerySchema),
    async (c) => {
      const customerId = c.req.header("x-customer-id")!;
      const { days, limit, include_autocaptured } = c.req.valid("query");

      try {
        const events = await listEvents(makeDeps(), {
          customerId,
          days,
          limit,
          includeAutocaptured: include_autocaptured,
        });
        if (events === null) {
          return c.json({ error: { code: "integration_not_found" } }, 404);
        }
        return c.json(events, 200);
      } catch (err) {
        const mapped = mapPosthogError(err);
        if (mapped) {
          if (mapped.retryAfter) c.header("Retry-After", mapped.retryAfter);
          return c.json(mapped.body, mapped.status);
        }
        throw err;
      }
    }
  )
  .post(
    "/api/integrations/posthog/events/selection",
    zValidator("json", eventSelectionBodySchema),
    async (c) => {
      const customerId = c.req.header("x-customer-id")!;
      const { events } = c.req.valid("json");

      try {
        const result = await saveEventSelection(makeDeps(), {
          customerId,
          events,
        });
        if (result === null) {
          return c.json({ error: { code: "integration_not_found" } }, 404);
        }
        return c.json(result, 200);
      } catch (err) {
        const mapped = mapPosthogError(err);
        if (mapped) {
          if (mapped.retryAfter) c.header("Retry-After", mapped.retryAfter);
          return c.json(mapped.body, mapped.status);
        }
        throw err;
      }
    }
  )
  .delete("/api/integrations/posthog", async (c) => {
    const customerId = c.req.header("x-customer-id")!;
    const ok = await disconnect(makeDeps(), { customerId });
    if (!ok) {
      return c.json({ error: { code: "integration_not_found" } }, 404);
    }
    return c.body(null, 204);
  });

export type IntegrationAppType = typeof integrationApp;
