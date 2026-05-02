import { randomBytes } from "crypto";
import type { Db, PosthogIntegrationConfig, PosthogRegion } from "../../db";
import * as integrationRepo from "../../repository/integration";

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

  console.log("[integration.connect] row created", {
    integrationId: created.id,
    customerId: input.customerId,
  });

  const webhookUrl = `${deps.webhookBaseUrl.replace(/\/+$/, "")}/webhooks/posthog/${input.customerId}`;

  try {
    console.log("[integration.connect] calling posthog.createHogFunction", {
      integrationId: created.id,
      webhookUrl,
      projectId: input.projectId,
    });

    const { hogFunctionId } = await deps.posthog.createHogFunction(
      {
        personalApiKey: input.personalApiKey,
        projectId: input.projectId,
        baseUrl: POSTHOG_REGION_HOST[input.region],
      },
      {
        webhookUrl,
        webhookSecret,
        eventNames: [],
        customerId: input.customerId,
      }
    );

    console.log("[integration.connect] hog function created", {
      integrationId: created.id,
      hogFunctionId,
    });

    await deps.repo.updateConfig(deps.db, created.id, {
      ...initialConfig,
      hog_function_id: hogFunctionId,
    });

    console.log("[integration.connect] config updated, success", {
      integrationId: created.id,
    });

    return { integration_id: created.id };
  } catch (err) {
    console.error("[integration.connect] failed after row created — rolling back", {
      integrationId: created.id,
      customerId: input.customerId,
      errorName: (err as Error)?.name,
      errorMessage: (err as Error)?.message,
      errorStack: (err as Error)?.stack,
    });
    await deps.repo.deleteIntegration(deps.db, created.id);
    console.log("[integration.connect] rollback complete", {
      integrationId: created.id,
    });
    throw err;
  }
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
): Promise<Array<{ name: string; volume: number }> | null> {
  const found = await deps.repo.findByCustomerAndProvider(
    deps.db,
    input.customerId,
    "posthog"
  );
  if (!found) return null;

  const cfg = found.config as PosthogIntegrationConfig;
  const personalApiKey = decode(cfg.personal_api_key_encrypted);

  return deps.posthog.listRecentEvents(
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
