import { match, P } from "ts-pattern";
import {
  HOG_DESTINATION_SOURCE,
  HOG_INPUTS_SCHEMA,
} from "./hog-template";
import {
  CreateHogFunctionArgsSchema,
  DeleteHogFunctionArgsSchema,
  HogFunctionCreateResponseSchema,
  HogQlQueryResponseSchema,
  ListRecentEventsArgsSchema,
  PosthogClientConfigSchema,
  UpdateHogFunctionFiltersArgsSchema,
  type CreateHogFunctionArgs,
  type DeleteHogFunctionArgs,
  type ListRecentEventsArgs,
  type PosthogClientConfig,
  type RecentEvent,
  type UpdateHogFunctionFiltersArgs,
} from "./types";

export class PosthogAuthError extends Error {
  constructor(message = "PostHog rejected the personal API key (401)") {
    super(message);
    this.name = "PosthogAuthError";
  }
}

export class PosthogClientError extends Error {
  constructor(public readonly status: number, public readonly body: unknown) {
    super(`PostHog request failed with status ${status}`);
    this.name = "PosthogClientError";
  }
}

export class PosthogTransientError extends Error {
  constructor(
    public readonly status: number | null,
    public readonly cause?: unknown
  ) {
    super(
      status === null
        ? "PostHog request failed (network error)"
        : `PostHog request failed with status ${status}`
    );
    this.name = "PosthogTransientError";
  }
}

function buildEventFilter(eventNames: string[]) {
  return {
    events: eventNames.map((name) => ({
      id: name,
      name,
      type: "events",
      order: 0,
    })),
  };
}

async function request(
  cfg: PosthogClientConfig,
  init: { method: string; path: string; body?: unknown }
): Promise<unknown> {
  const parsed = PosthogClientConfigSchema.parse(cfg);
  const url = `${parsed.baseUrl.replace(/\/$/, "")}${init.path}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${parsed.personalApiKey}`,
        "Content-Type": "application/json",
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch (cause) {
    throw new PosthogTransientError(null, cause);
  }

  const text = await response.text();
  const body = text.length === 0 ? null : safeJson(text);

  return match(response.status)
    .with(P.number.gte(200).and(P.number.lt(300)), () => body)
    .with(401, () => {
      throw new PosthogAuthError();
    })
    .with(P.number.gte(500), (status) => {
      throw new PosthogTransientError(status, body);
    })
    .otherwise((status) => {
      throw new PosthogClientError(status, body);
    });
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function createHogFunction(
  cfg: PosthogClientConfig,
  args: CreateHogFunctionArgs
): Promise<{ hogFunctionId: string }> {
  const a = CreateHogFunctionArgsSchema.parse(args);
  const projectId = PosthogClientConfigSchema.parse(cfg).projectId;

  const body = await request(cfg, {
    method: "POST",
    path: `/api/projects/${projectId}/hog_functions/`,
    body: {
      name: `Notify — ${a.customerId}`,
      type: "destination",
      enabled: true,
      hog: HOG_DESTINATION_SOURCE,
      inputs_schema: HOG_INPUTS_SCHEMA,
      inputs: {
        webhook_url: { value: a.webhookUrl },
      },
      filters: buildEventFilter(a.eventNames),
    },
  });

  return { hogFunctionId: HogFunctionCreateResponseSchema.parse(body).id };
}

export async function updateHogFunctionFilters(
  cfg: PosthogClientConfig,
  args: UpdateHogFunctionFiltersArgs
): Promise<void> {
  const a = UpdateHogFunctionFiltersArgsSchema.parse(args);
  const projectId = PosthogClientConfigSchema.parse(cfg).projectId;

  await request(cfg, {
    method: "PATCH",
    path: `/api/projects/${projectId}/hog_functions/${a.hogFunctionId}/`,
    body: { filters: buildEventFilter(a.eventNames) },
  });
}

export async function deleteHogFunction(
  cfg: PosthogClientConfig,
  args: DeleteHogFunctionArgs
): Promise<void> {
  const a = DeleteHogFunctionArgsSchema.parse(args);
  const projectId = PosthogClientConfigSchema.parse(cfg).projectId;

  await request(cfg, {
    method: "PATCH",
    path: `/api/projects/${projectId}/hog_functions/${a.hogFunctionId}/`,
    body: { deleted: true },
  });
}

export async function listRecentEvents(
  cfg: PosthogClientConfig,
  args: ListRecentEventsArgs = {}
): Promise<RecentEvent[]> {
  const a = ListRecentEventsArgsSchema.parse(args);
  const projectId = PosthogClientConfigSchema.parse(cfg).projectId;

  const where = a.excludePrefixed ? "AND NOT startsWith(event, '$')" : "";
  const query = `
    SELECT event, count() AS volume
    FROM events
    WHERE timestamp > now() - INTERVAL ${a.days} DAY ${where}
    GROUP BY event
    ORDER BY volume DESC
    LIMIT ${a.limit}
  `.trim();

  const body = await request(cfg, {
    method: "POST",
    path: `/api/projects/${projectId}/query/`,
    body: { query: { kind: "HogQLQuery", query } },
  });

  const parsed = HogQlQueryResponseSchema.parse(body);
  return parsed.results.map(([name, volume]) => ({
    name,
    volume: typeof volume === "number" ? volume : Number(volume),
  }));
}
