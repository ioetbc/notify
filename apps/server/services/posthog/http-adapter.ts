import { match, P } from "ts-pattern";
import { z } from "zod";
import { HOG_DESTINATION_SOURCE, HOG_INPUTS_SCHEMA } from "./hog-template";
import {
  PosthogApiError,
  PosthogAuthError,
  PosthogTransientError,
  type DesiredFunctionState,
  type EventVolume,
  type ListOpts,
  type PosthogCreds,
  type PosthogPort,
} from "./port";

const DISABLED_HOG_FUNCTION_EVENT = "__notify_no_active_posthog_events__";

const HogFunctionCreateResponseSchema = z
  .object({ id: z.string().min(1) })
  .passthrough();

const HogQlQueryResponseSchema = z
  .object({
    results: z.array(z.tuple([z.string(), z.union([z.number(), z.string()])])),
  })
  .passthrough();

function buildEventFilter(eventNames: string[]) {
  const names = eventNames.length > 0 ? eventNames : [DISABLED_HOG_FUNCTION_EVENT];
  return {
    events: names.map((name) => ({
      id: name,
      name,
      type: "events",
      order: 0,
    })),
  };
}

async function request(
  creds: PosthogCreds,
  init: { method: string; path: string; body?: unknown }
): Promise<unknown> {
  const url = `${creds.baseUrl.replace(/\/$/, "")}${init.path}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${creds.personalApiKey}`,
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
      throw new PosthogApiError(status, body);
    });
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function listRecentEvents(
  creds: PosthogCreds,
  opts: ListOpts
): Promise<EventVolume[]> {
  const where = opts.excludePrefixed ? "AND NOT startsWith(event, '$')" : "";
  const query = `
    SELECT event, count() AS volume
    FROM events
    WHERE timestamp > now() - INTERVAL ${opts.days} DAY ${where}
    GROUP BY event
    ORDER BY volume DESC
    LIMIT ${opts.limit}
  `.trim();

  const body = await request(creds, {
    method: "POST",
    path: `/api/projects/${creds.projectId}/query/`,
    body: { query: { kind: "HogQLQuery", query } },
  });

  const parsed = HogQlQueryResponseSchema.parse(body);
  return parsed.results.map(([name, volume]) => ({
    name,
    volume: typeof volume === "number" ? volume : Number(volume),
  }));
}

async function createHogFunction(
  creds: PosthogCreds,
  args: { webhookUrl: string; eventNames: string[]; customerId: string }
): Promise<string> {
  const body = await request(creds, {
    method: "POST",
    path: `/api/projects/${creds.projectId}/hog_functions/`,
    body: {
      name: `Notify — ${args.customerId}`,
      type: "destination",
      enabled: true,
      hog: HOG_DESTINATION_SOURCE,
      inputs_schema: HOG_INPUTS_SCHEMA,
      inputs: { webhook_url: { value: args.webhookUrl } },
      filters: buildEventFilter(args.eventNames),
    },
  });
  return HogFunctionCreateResponseSchema.parse(body).id;
}

async function patchHogFunction(
  creds: PosthogCreds,
  hogFunctionId: string,
  patch: Record<string, unknown>
): Promise<void> {
  await request(creds, {
    method: "PATCH",
    path: `/api/projects/${creds.projectId}/hog_functions/${hogFunctionId}/`,
    body: patch,
  });
}

async function reconcileDestination(
  creds: PosthogCreds,
  currentHogFunctionId: string | null,
  desired: DesiredFunctionState
): Promise<{ hogFunctionId: string | null }> {
  return match({ desired, currentHogFunctionId })
    .with(
      { desired: { kind: "absent" }, currentHogFunctionId: null },
      async () => ({ hogFunctionId: null })
    )
    .with(
      { desired: { kind: "absent" }, currentHogFunctionId: P.string },
      async ({ currentHogFunctionId: id }) => {
        await patchHogFunction(creds, id, { deleted: true });
        return { hogFunctionId: null };
      }
    )
    .with(
      { desired: { kind: "present" }, currentHogFunctionId: null },
      async ({ desired: d }) => {
        const id = await createHogFunction(creds, {
          webhookUrl: d.webhookUrl,
          eventNames: d.eventNames,
          customerId: d.customerId,
        });
        return { hogFunctionId: id };
      }
    )
    .with(
      { desired: { kind: "present" }, currentHogFunctionId: P.string },
      async ({ desired: d, currentHogFunctionId: id }) => {
        await patchHogFunction(creds, id, {
          filters: buildEventFilter(d.eventNames),
        });
        return { hogFunctionId: id };
      }
    )
    .exhaustive();
}

async function verifyCredentials(creds: PosthogCreds): Promise<void> {
  // Cheap auth probe: list a single project property; 401 → PosthogAuthError.
  await request(creds, {
    method: "GET",
    path: `/api/projects/${creds.projectId}/`,
  });
}

export const httpPosthogAdapter: PosthogPort = {
  listRecentEvents,
  reconcileDestination,
  verifyCredentials,
};
