import { randomBytes } from "crypto";
import type {
  CustomerIntegration,
  Db,
  PosthogIntegrationConfig,
  PosthogRegion,
} from "../../db";
import * as eventDefinitionRepo from "../../repository/event-definition";
import * as integrationRepo from "../../repository/integration";

const POSTHOG_REGION_HOST: Record<PosthogRegion, string> = {
  us: "https://us.posthog.com",
  eu: "https://eu.posthog.com",
};

export const DISABLED_HOG_FUNCTION_EVENT = "__notify_no_active_posthog_events__";

type PosthogConfig = {
  personalApiKey: string;
  projectId: string;
  baseUrl?: string;
};

type PosthogIntegrationContext = {
  row: CustomerIntegration;
  config: PosthogIntegrationConfig;
  posthogConfig: PosthogConfig;
  webhookSecret: string;
};

export class IntegrationAlreadyExistsError extends Error {
  constructor() {
    super("integration_already_exists");
    this.name = "IntegrationAlreadyExistsError";
  }
}

export type PosthogClient = {
  createHogFunction: (
    cfg: PosthogConfig,
    args: {
      webhookUrl: string;
      webhookSecret: string;
      eventNames: string[];
      customerId: string;
    }
  ) => Promise<{ hogFunctionId: string }>;
  listRecentEvents: (
    cfg: PosthogConfig,
    args: { days: number; excludePrefixed: boolean; limit: number }
  ) => Promise<Array<{ name: string; volume: number }>>;
  updateHogFunctionFilters: (
    cfg: PosthogConfig,
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
  const existing = await deps.repo.findByCustomerAndProvider(
    deps.db,
    input.customerId,
    "posthog"
  );

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
  const row = await deps.repo.findByCustomerAndProvider(
    deps.db,
    input.customerId,
    "posthog"
  );
  if (!row) return null;

  const config = row.config as PosthogIntegrationConfig;
  return {
    id: row.id,
    provider: "posthog",
    project_id: config.project_id,
    connected_at: row.connectedAt?.toISOString() ?? new Date(0).toISOString(),
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
  const context = await getPosthogIntegrationContext(deps, input.customerId);
  if (!context) return null;

  const events = await deps.posthog.listRecentEvents(context.posthogConfig, {
    days: input.days,
    limit: input.limit,
    excludePrefixed: !input.includeAutocaptured,
  });

  return mergeStoredEventSelection(
    events,
    await deps.eventDefinitions.listEventSelectionByIntegration(
      deps.db,
      context.row.id
    )
  );
}

export async function saveEventSelection(
  deps: IntegrationDeps,
  input: {
    customerId: string;
    events: Array<{ name: string; volume?: number | null }>;
  }
): Promise<{ event_names: string[] } | null> {
  const context = await getPosthogIntegrationContext(deps, input.customerId);
  if (!context) return null;

  const selectedNames = uniqueEventNames(input.events);
  await syncHogFunctionFilters(deps, context, input.customerId, selectedNames);

  await deps.eventDefinitions.setPosthogEventSelection(deps.db, {
    customerId: input.customerId,
    integrationId: context.row.id,
    events: input.events,
  });

  return { event_names: selectedNames };
}

export async function disconnect(
  deps: IntegrationDeps,
  input: { customerId: string }
): Promise<boolean> {
  const context = await getPosthogIntegrationContext(deps, input.customerId);
  if (!context) return false;

  await deps.repo.deleteIntegration(deps.db, context.row.id);
  return true;
}

async function getPosthogIntegrationContext(
  deps: IntegrationDeps,
  customerId: string
): Promise<PosthogIntegrationContext | null> {
  const row = await deps.repo.findByCustomerAndProvider(
    deps.db,
    customerId,
    "posthog"
  );
  if (!row) return null;

  const config = row.config as PosthogIntegrationConfig;
  return {
    row,
    config,
    posthogConfig: {
      personalApiKey: decode(config.personal_api_key_encrypted),
      projectId: config.project_id,
      baseUrl: POSTHOG_REGION_HOST[config.region ?? "us"],
    },
    webhookSecret: decode(config.webhook_secret_encrypted),
  };
}

async function syncHogFunctionFilters(
  deps: IntegrationDeps,
  context: PosthogIntegrationContext,
  customerId: string,
  selectedNames: string[]
): Promise<void> {
  const filterNames = selectedNames.length > 0
    ? selectedNames
    : [DISABLED_HOG_FUNCTION_EVENT];

  if (!context.config.hog_function_id) {
    if (selectedNames.length === 0) return;

    const { hogFunctionId } = await deps.posthog.createHogFunction(
      context.posthogConfig,
      {
        webhookUrl: buildWebhookUrl(deps.webhookBaseUrl, customerId),
        webhookSecret: context.webhookSecret,
        eventNames: selectedNames,
        customerId,
      }
    );

    await deps.repo.updateConfig(deps.db, context.row.id, {
      ...context.config,
      hog_function_id: hogFunctionId,
    });
    return;
  }

  await deps.posthog.updateHogFunctionFilters(context.posthogConfig, {
    hogFunctionId: context.config.hog_function_id,
    eventNames: filterNames,
  });
}

function buildWebhookUrl(baseUrl: string, customerId: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/webhooks/posthog/${customerId}`;
}

function uniqueEventNames(events: Array<{ name: string }>): string[] {
  return [...new Set(events.map((event) => event.name))];
}

function mergeStoredEventSelection(
  events: Array<{ name: string; volume: number }>,
  stored: Array<{ name: string; active: boolean; volume: number | null }>
): Array<{ name: string; volume: number; active: boolean }> {
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
