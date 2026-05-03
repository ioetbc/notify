import { randomBytes } from "crypto";
import type { Db, PosthogIntegrationConfig, PosthogRegion } from "../../db";
import * as integrationRepo from "../../repository/integration";
import * as eventDefinitionRepo from "../../repository/event-definition";

const POSTHOG_REGION_HOST: Record<PosthogRegion, string> = {
  us: "https://us.posthog.com",
  eu: "https://eu.posthog.com",
};

export class IntegrationAlreadyExistsError extends Error {
  constructor() {
    super("integration_already_exists");
    this.name = "IntegrationAlreadyExistsError";
  }
}

// Subset of the PostHog client surface (Chunk A) consumed by this service.
// Defined here so unit tests can pass a fake without touching the real module.
export type PosthogClient = {
  createHogFunction: (
    cfg: { personalApiKey: string; projectId: string; baseUrl?: string },
    args: {
      webhookUrl: string;
      webhookSecret: string;
      eventNames: string[];
      customerId: string;
    }
  ) => Promise<{ hogFunctionId: string }>;
  listRecentEvents: (
    cfg: { personalApiKey: string; projectId: string; baseUrl?: string },
    args: { days: number; excludePrefixed: boolean; limit: number }
  ) => Promise<Array<{ name: string; volume: number }>>;
  updateHogFunctionFilters: (
    cfg: { personalApiKey: string; projectId: string; baseUrl?: string },
    args: { hogFunctionId: string; eventNames: string[] }
  ) => Promise<void>;
};

export type IntegrationDeps = {
  db: Db;
  repo: Pick<
    typeof integrationRepo,
    | "findByCustomerAndProvider"
    | "create"
    | "updateConfig"
    | "deleteIntegration"
  >;
  eventDefinitions: Pick<
    typeof eventDefinitionRepo,
    | "listEventSelectionByIntegration"
    | "setPosthogEventSelection"
  >;
  posthog: PosthogClient;
  webhookBaseUrl: string;
};

const encode = (s: string) => Buffer.from(s, "utf-8").toString("base64");
const decode = (s: string) => Buffer.from(s, "base64").toString("utf-8");

export async function connect(
  deps: IntegrationDeps,
  input: {
    customerId: string;
    personalApiKey: string;
    projectId: string;
    region: PosthogRegion;
  }
): Promise<{ integration_id: string }> {
  console.log("[integration.connect] start", {
    customerId: input.customerId,
    projectId: input.projectId,
    webhookBaseUrl: deps.webhookBaseUrl,
  });

  const existing = await deps.repo.findByCustomerAndProvider(
    deps.db,
    input.customerId,
    "posthog"
  );

  console.log("[integration.connect] existing lookup", {
    customerId: input.customerId,
    found: !!existing,
    existingId: existing?.id ?? null,
  });

  if (existing) throw new IntegrationAlreadyExistsError();

  const webhookSecret = randomBytes(32).toString("hex");

  const initialConfig: PosthogIntegrationConfig = {
    personal_api_key_encrypted: encode(input.personalApiKey),
    project_id: input.projectId,
    region: input.region,
    hog_function_id: null,
    webhook_secret_encrypted: encode(webhookSecret),
  };

  const created = await deps.repo.create(deps.db, {
    customerId: input.customerId,
    provider: "posthog",
    config: initialConfig,
  });

  console.log("[integration.connect] row created, success", {
    integrationId: created.id,
    customerId: input.customerId,
  });

  return { integration_id: created.id };
}

export type IntegrationSummary = {
  id: string;
  provider: "posthog";
  project_id: string;
  connected_at: string;
};

export async function getSummary(
  deps: IntegrationDeps,
  input: { customerId: string }
): Promise<IntegrationSummary | null> {
  const found = await deps.repo.findByCustomerAndProvider(
    deps.db,
    input.customerId,
    "posthog"
  );
  if (!found) return null;

  const cfg = found.config as PosthogIntegrationConfig;
  return {
    id: found.id,
    provider: "posthog",
    project_id: cfg.project_id,
    connected_at:
      (found as { connectedAt?: Date | null }).connectedAt?.toISOString() ??
      new Date(0).toISOString(),
  };
}

export async function listEvents(
  deps: IntegrationDeps,
  input: {
    customerId: string;
    days: number;
    limit: number;
    includeAutocaptured: boolean;
  }
): Promise<Array<{ name: string; volume: number; active: boolean }> | null> {
  const found = await deps.repo.findByCustomerAndProvider(
    deps.db,
    input.customerId,
    "posthog"
  );
  if (!found) return null;

  const cfg = found.config as PosthogIntegrationConfig;
  const personalApiKey = decode(cfg.personal_api_key_encrypted);

  const events = await deps.posthog.listRecentEvents(
    {
      personalApiKey,
      projectId: cfg.project_id,
      baseUrl: POSTHOG_REGION_HOST[cfg.region ?? "us"],
    },
    {
      days: input.days,
      limit: input.limit,
      excludePrefixed: !input.includeAutocaptured,
    }
  );

  const stored = await deps.eventDefinitions.listEventSelectionByIntegration(
    deps.db,
    found.id
  );
  const storedByName = new Map(stored.map((event) => [event.name, event]));
  const returnedNames = new Set(events.map((event) => event.name));
  const merged = events.map((event) => ({
    ...event,
    active: storedByName.get(event.name)?.active ?? false,
  }));

  for (const event of stored) {
    if (!returnedNames.has(event.name)) {
      merged.push({
        name: event.name,
        volume: event.volume ?? 0,
        active: event.active,
      });
    }
  }

  return merged;
}

export async function saveEventSelection(
  deps: IntegrationDeps,
  input: {
    customerId: string;
    events: Array<{ name: string; volume?: number | null }>;
  }
): Promise<{ event_names: string[] } | null> {
  const found = await deps.repo.findByCustomerAndProvider(
    deps.db,
    input.customerId,
    "posthog"
  );
  if (!found) return null;

  const cfg = found.config as PosthogIntegrationConfig;
  const personalApiKey = decode(cfg.personal_api_key_encrypted);
  const webhookSecret = decode(cfg.webhook_secret_encrypted);
  const selectedNames = [...new Set(input.events.map((event) => event.name))];
  const posthogCfg = {
    personalApiKey,
    projectId: cfg.project_id,
    baseUrl: POSTHOG_REGION_HOST[cfg.region ?? "us"],
  };

  if (selectedNames.length > 0 && !cfg.hog_function_id) {
    const webhookUrl = `${deps.webhookBaseUrl.replace(/\/+$/, "")}/webhooks/posthog/${input.customerId}`;
    const { hogFunctionId } = await deps.posthog.createHogFunction(
      posthogCfg,
      {
        webhookUrl,
        webhookSecret,
        eventNames: selectedNames,
        customerId: input.customerId,
      }
    );

    await deps.repo.updateConfig(deps.db, found.id, {
      ...cfg,
      hog_function_id: hogFunctionId,
    });
  } else if (cfg.hog_function_id) {
    await deps.posthog.updateHogFunctionFilters(posthogCfg, {
      hogFunctionId: cfg.hog_function_id,
      eventNames: selectedNames,
    });
  }

  await deps.eventDefinitions.setPosthogEventSelection(deps.db, {
    customerId: input.customerId,
    integrationId: found.id,
    events: input.events,
  });

  return { event_names: selectedNames };
}

export async function disconnect(
  deps: IntegrationDeps,
  input: { customerId: string }
): Promise<boolean> {
  const found = await deps.repo.findByCustomerAndProvider(
    deps.db,
    input.customerId,
    "posthog"
  );
  if (!found) return false;

  // Intentionally leave the hog function in place. Stranding a no-op function
  // is preferable to deleting the wrong one off a stale id.
  await deps.repo.deleteIntegration(deps.db, found.id);
  return true;
}
