import { match, P } from "ts-pattern";
import type {
  CustomerIntegration,
  Db,
  PosthogIntegrationConfig,
  PosthogRegion,
} from "../../../db";
import type { EventDefinitionRepo } from "../../../repository/event-definition";
import * as integrationRepo from "../../../repository/integration";
import {
  PosthogApiError,
  PosthogAuthError,
  PosthogTransientError,
  type DesiredFunctionState,
  type PosthogCreds,
  type PosthogPort,
} from "../../posthog/port";

const POSTHOG_REGION_HOST: Record<PosthogRegion, string> = {
  us: "https://us.posthog.com",
  eu: "https://eu.posthog.com",
};

export type PosthogFault =
  | { kind: "auth_failed" }
  | { kind: "transient"; retryAfterSec: number | null }
  | { kind: "already_exists" }
  | { kind: "not_found" }
  | { kind: "upstream"; status: number; body: unknown };

export class PosthogIntegrationError extends Error {
  constructor(public readonly detail: PosthogFault) {
    super(detail.kind);
    this.name = "PosthogIntegrationError";
  }
}

export type ConnectInput = {
  customerId: string;
  personalApiKey: string;
  projectId: string;
  region: PosthogRegion;
};

export type SaveEventsInput = {
  customerId: string;
  events: Array<{ name: string; volume?: number | null }>;
};

export type ListEventsInput = {
  customerId: string;
  days: number;
  limit: number;
  includeAutocaptured: boolean;
};

export type MergedEvent = {
  name: string;
  volume: number;
  active: boolean;
};

export type IntegrationSummary = {
  id: string;
  provider: "posthog";
  project_id: string;
  connected_at: string;
};

export type PosthogIntegrationPort = {
  connect(input: ConnectInput): Promise<{ integrationId: string }>;
  saveEvents(input: SaveEventsInput): Promise<{ eventNames: string[] }>;
  listEvents(input: ListEventsInput): Promise<MergedEvent[]>;
  disconnect(input: { customerId: string }): Promise<boolean>;
  getSummary(input: { customerId: string }): Promise<IntegrationSummary | null>;
};

export type IntegrationDeps = {
  db: Db;
  repo: Pick<
    typeof integrationRepo,
    "findByCustomerAndProvider" | "create" | "updateConfig" | "deleteIntegration"
  >;
  eventDefinitions: EventDefinitionRepo;
  posthog: PosthogPort;
  webhookBaseUrl: string;
};

type Context = {
  row: CustomerIntegration;
  config: PosthogIntegrationConfig;
  creds: PosthogCreds;
};

const encode = (s: string) => Buffer.from(s, "utf-8").toString("base64");
const decode = (s: string) => Buffer.from(s, "base64").toString("utf-8");

export class PosthogIntegration implements PosthogIntegrationPort {
  constructor(private readonly deps: IntegrationDeps) {}

  async connect(input: ConnectInput): Promise<{ integrationId: string }> {
    return this.withFaultMapping(async () => {
      const existing = await this.deps.repo.findByCustomerAndProvider(
        this.deps.db,
        input.customerId,
        "posthog"
      );
      if (existing) {
        throw new PosthogIntegrationError({ kind: "already_exists" });
      }

      await this.deps.posthog.verifyCredentials({
        personalApiKey: input.personalApiKey,
        projectId: input.projectId,
        baseUrl: POSTHOG_REGION_HOST[input.region],
      });

      const initialConfig: PosthogIntegrationConfig = {
        personal_api_key_encrypted: encode(input.personalApiKey),
        project_id: input.projectId,
        region: input.region,
        hog_function_id: null,
      };

      const created = await this.deps.repo.create(this.deps.db, {
        customerId: input.customerId,
        provider: "posthog",
        config: initialConfig,
      });
      return { integrationId: created.id };
    });
  }

  async getSummary(input: {
    customerId: string;
  }): Promise<IntegrationSummary | null> {
    const ctx = await this.loadContext(input.customerId);
    if (!ctx) return null;
    return {
      id: ctx.row.id,
      provider: "posthog",
      project_id: ctx.config.project_id,
      connected_at:
        ctx.row.connectedAt?.toISOString() ?? new Date(0).toISOString(),
    };
  }

  async listEvents(input: ListEventsInput): Promise<MergedEvent[]> {
    const ctx = await this.loadContext(input.customerId);
    if (!ctx) throw new PosthogIntegrationError({ kind: "not_found" });

    return this.withFaultMapping(async () => {
      const events = await this.deps.posthog.listRecentEvents(ctx.creds, {
        days: input.days,
        limit: input.limit,
        excludePrefixed: !input.includeAutocaptured,
      });
      const { rows } = await this.deps.eventDefinitions.run({
        kind: "listForIntegration",
        integrationId: ctx.row.id,
      });
      return mergeStored(events, rows);
    });
  }

  async saveEvents(input: SaveEventsInput): Promise<{ eventNames: string[] }> {
    const ctx = await this.loadContext(input.customerId);
    if (!ctx) throw new PosthogIntegrationError({ kind: "not_found" });

    const eventNames = uniqueNames(input.events);

    return this.withFaultMapping(async () => {
      const desired = decideDesired(
        ctx.config.hog_function_id,
        eventNames,
        this.deps.webhookBaseUrl,
        input.customerId
      );

      const { hogFunctionId } = await this.deps.posthog.reconcileDestination(
        ctx.creds,
        ctx.config.hog_function_id,
        desired
      );

      if (hogFunctionId !== ctx.config.hog_function_id) {
        await this.deps.repo.updateConfig(this.deps.db, ctx.row.id, {
          ...ctx.config,
          hog_function_id: hogFunctionId,
        });
      }

      await this.deps.eventDefinitions.run({
        kind: "replaceSelection",
        customerId: input.customerId,
        integrationId: ctx.row.id,
        provider: "posthog",
        events: input.events,
      });

      return { eventNames };
    });
  }

  async disconnect(input: { customerId: string }): Promise<boolean> {
    const ctx = await this.loadContext(input.customerId);
    if (!ctx) return false;

    return this.withFaultMapping(async () => {
      if (ctx.config.hog_function_id) {
        await this.deps.posthog.reconcileDestination(
          ctx.creds,
          ctx.config.hog_function_id,
          { kind: "absent" }
        );
      }
      await this.deps.repo.deleteIntegration(this.deps.db, ctx.row.id);
      return true;
    });
  }

  private async loadContext(customerId: string): Promise<Context | null> {
    const row = await this.deps.repo.findByCustomerAndProvider(
      this.deps.db,
      customerId,
      "posthog"
    );
    if (!row) return null;
    const config = row.config as PosthogIntegrationConfig;
    return { row, config, creds: buildCreds(config) };
  }

  private async withFaultMapping<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (err) {
      if (err instanceof PosthogIntegrationError) throw err;
      const fault = toFault(err);
      if (fault) throw new PosthogIntegrationError(fault);
      throw err;
    }
  }
}

export function makePosthogIntegration(
  deps: IntegrationDeps
): PosthogIntegrationPort {
  return new PosthogIntegration(deps);
}

function buildCreds(config: PosthogIntegrationConfig): PosthogCreds {
  return {
    personalApiKey: decode(config.personal_api_key_encrypted),
    projectId: config.project_id,
    baseUrl: POSTHOG_REGION_HOST[config.region ?? "us"],
  };
}

function webhookUrl(baseUrl: string, customerId: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/webhooks/posthog/${customerId}`;
}

function uniqueNames(events: Array<{ name: string }>): string[] {
  return [...new Set(events.map((e) => e.name))];
}

function toFault(err: unknown): PosthogFault | null {
  return match(err)
    .returnType<PosthogFault | null>()
    .when(
      (e) => e instanceof PosthogAuthError,
      () => ({ kind: "auth_failed" })
    )
    .when(
      (e) => e instanceof PosthogTransientError,
      () => ({ kind: "transient", retryAfterSec: 30 })
    )
    .when(
      (e) => e instanceof PosthogApiError,
      (e) => {
        const apiError = e as PosthogApiError;
        return { kind: "upstream", status: apiError.status, body: apiError.body };
      }
    )
    .otherwise(() => null);
}

function mergeStored(
  events: Array<{ name: string; volume: number }>,
  stored: ReadonlyArray<{ name: string; active: boolean; volume: number | null }>
): MergedEvent[] {
  const storedByName = new Map(stored.map((e) => [e.name, e]));
  const returnedNames = new Set(events.map((e) => e.name));
  const merged: MergedEvent[] = events.map((event) => ({
    ...event,
    active: storedByName.get(event.name)?.active ?? false,
  }));
  for (const e of stored) {
    if (!returnedNames.has(e.name)) {
      merged.push({ name: e.name, volume: e.volume ?? 0, active: e.active });
    }
  }
  return merged;
}

function decideDesired(
  currentHogFunctionId: string | null,
  eventNames: string[],
  webhookBaseUrl: string,
  customerId: string
): DesiredFunctionState {
  return match({ currentHogFunctionId, empty: eventNames.length === 0 })
    .returnType<DesiredFunctionState>()
    .with({ currentHogFunctionId: null, empty: true }, () => ({ kind: "absent" }))
    .with({ currentHogFunctionId: P.string, empty: P.boolean }, () => ({
      kind: "present",
      webhookUrl: webhookUrl(webhookBaseUrl, customerId),
      eventNames,
      customerId,
    }))
    .with({ currentHogFunctionId: null, empty: false }, () => ({
      kind: "present",
      webhookUrl: webhookUrl(webhookBaseUrl, customerId),
      eventNames,
      customerId,
    }))
    .exhaustive();
}
