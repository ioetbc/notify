const POSTHOG_API_BASE = "https://us.posthog.com";

export interface PosthogUser {
  email: string;
  first_name: string;
}

export interface PosthogEventDefinition {
  id: string;
  name: string;
  last_seen_at: string | null;
}

export interface PosthogHogFunction {
  id: string;
  name: string;
  enabled: boolean;
}

interface HogFunctionInput {
  name: string;
  webhookUrl: string;
  webhookSecret: string;
  eventNames: string[];
}

function headers(pat: string) {
  return {
    Authorization: `Bearer ${pat}`,
    "Content-Type": "application/json",
  };
}

async function assertOk(res: Response, context: string) {
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`PostHog API error (${context}): ${res.status} ${body}`);
  }
}

/** Validate PAT by fetching the authenticated user. */
export async function validatePat(pat: string): Promise<PosthogUser> {
  const res = await fetch(`${POSTHOG_API_BASE}/api/users/@me/`, {
    headers: headers(pat),
  });
  await assertOk(res, "validate PAT");
  const data = (await res.json()) as PosthogUser;
  return data;
}

/** List event definitions for a PostHog team. */
export async function listEventDefinitions(
  pat: string,
  teamId: string
): Promise<PosthogEventDefinition[]> {
  const all: PosthogEventDefinition[] = [];
  let url: string | null =
    `${POSTHOG_API_BASE}/api/projects/${teamId}/event_definitions/?limit=200`;

  while (url) {
    const res = await fetch(url, { headers: headers(pat) });
    await assertOk(res, "list event definitions");
    const data = (await res.json()) as {
      results: PosthogEventDefinition[];
      next: string | null;
    };
    all.push(...data.results);
    url = data.next;
  }
  return all;
}

function hogFunctionBody(input: HogFunctionInput) {
  return {
    name: input.name,
    type: "destination",
    enabled: true,
    inputs: {
      url: { value: input.webhookUrl },
      method: { value: "POST" },
      headers: {
        value: {
          "Content-Type": "application/json",
          "X-Notify-Token": input.webhookSecret,
        },
      },
      body: {
        value: {
          event: "{event.event}",
          distinct_id: "{event.distinct_id}",
          properties: "{event.properties}",
          timestamp: "{event.timestamp}",
        },
      },
    },
    filters: {
      events: input.eventNames.map((name) => ({
        id: name,
        name,
        type: "events",
      })),
    },
    hog: "fetch(inputs.url, {\n  'method': inputs.method,\n  'headers': inputs.headers,\n  'body': inputs.body\n})",
  };
}

/** Create a Hog function (destination webhook) in PostHog. */
export async function createHogFunction(
  pat: string,
  teamId: string,
  input: HogFunctionInput
): Promise<PosthogHogFunction> {
  const res = await fetch(
    `${POSTHOG_API_BASE}/api/projects/${teamId}/hog_functions/`,
    {
      method: "POST",
      headers: headers(pat),
      body: JSON.stringify(hogFunctionBody(input)),
    }
  );
  await assertOk(res, "create Hog function");
  return (await res.json()) as PosthogHogFunction;
}

/** Update the event filter on an existing Hog function. */
export async function updateHogFunction(
  pat: string,
  teamId: string,
  hogFunctionId: string,
  eventNames: string[]
): Promise<PosthogHogFunction> {
  const res = await fetch(
    `${POSTHOG_API_BASE}/api/projects/${teamId}/hog_functions/${hogFunctionId}/`,
    {
      method: "PATCH",
      headers: headers(pat),
      body: JSON.stringify({
        filters: {
          events: eventNames.map((name) => ({
            id: name,
            name,
            type: "events",
          })),
        },
      }),
    }
  );
  await assertOk(res, "update Hog function");
  return (await res.json()) as PosthogHogFunction;
}

/** Delete a Hog function from PostHog. */
export async function deleteHogFunction(
  pat: string,
  teamId: string,
  hogFunctionId: string
): Promise<void> {
  const res = await fetch(
    `${POSTHOG_API_BASE}/api/projects/${teamId}/hog_functions/${hogFunctionId}/`,
    {
      method: "DELETE",
      headers: headers(pat),
    }
  );
  if (res.status !== 204) {
    await assertOk(res, "delete Hog function");
  }
}
