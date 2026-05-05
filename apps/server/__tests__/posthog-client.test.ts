import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  httpPosthogAdapter,
  PosthogApiError,
  PosthogAuthError,
  PosthogTransientError,
  type PosthogCreds,
} from "../services/posthog";

type FetchCall = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
};

type StubResponse = { status: number; body?: unknown };

let calls: FetchCall[] = [];
let nextResponses: StubResponse[] = [];
let throwOnFetch: unknown = null;
const originalFetch = globalThis.fetch;

function stubFetch() {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (throwOnFetch) throw throwOnFetch;
    const headers = init?.headers as Record<string, string> | undefined;
    const bodyText = typeof init?.body === "string" ? init.body : undefined;
    calls.push({
      url: input.toString(),
      method: init?.method ?? "GET",
      headers: headers ?? {},
      body: bodyText === undefined ? undefined : JSON.parse(bodyText),
    });
    const next = nextResponses.shift();
    if (!next) throw new Error("no stub response queued");
    return new Response(
      next.body === undefined ? "" : JSON.stringify(next.body),
      { status: next.status }
    );
  }) as typeof fetch;
}

const creds: PosthogCreds = {
  baseUrl: "https://us.posthog.com",
  personalApiKey: "phx_test_key",
  projectId: "42",
};

beforeEach(() => {
  calls = [];
  nextResponses = [];
  throwOnFetch = null;
  stubFetch();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("listRecentEvents", () => {
  it("posts a HogQL query and parses tuples", async () => {
    nextResponses.push({
      status: 200,
      body: { results: [["signup", 120], ["purchase", 87]] },
    });

    const events = await httpPosthogAdapter.listRecentEvents(creds, {
      days: 30,
      limit: 50,
      excludePrefixed: true,
    });

    expect(events).toEqual([
      { name: "signup", volume: 120 },
      { name: "purchase", volume: 87 },
    ]);
    const call = calls[0];
    expect(call.url).toBe("https://us.posthog.com/api/projects/42/query/");
    expect(call.headers.Authorization).toBe("Bearer phx_test_key");
    const body = call.body as { query: { kind: string; query: string } };
    expect(body.query.kind).toBe("HogQLQuery");
    expect(body.query.query).toContain("INTERVAL 30 DAY");
    expect(body.query.query).toContain("LIMIT 50");
    expect(body.query.query).toContain("NOT startsWith(event, '$')");
  });

  it("omits prefix exclusion when excludePrefixed is false", async () => {
    nextResponses.push({ status: 200, body: { results: [] } });

    await httpPosthogAdapter.listRecentEvents(creds, {
      days: 7,
      limit: 5,
      excludePrefixed: false,
    });

    const body = calls[0].body as { query: { query: string } };
    expect(body.query.query).toContain("INTERVAL 7 DAY");
    expect(body.query.query).toContain("LIMIT 5");
    expect(body.query.query).not.toContain("startsWith(event, '$')");
  });

  it("coerces string volume counts to numbers", async () => {
    nextResponses.push({
      status: 200,
      body: { results: [["signup", "42"]] },
    });

    const events = await httpPosthogAdapter.listRecentEvents(creds, {
      days: 30,
      limit: 50,
      excludePrefixed: true,
    });
    expect(events).toEqual([{ name: "signup", volume: 42 }]);
  });
});

describe("reconcileDestination", () => {
  it("creates a new hog function when current id is null and desired is present", async () => {
    nextResponses.push({ status: 201, body: { id: "hf_new" } });

    const { hogFunctionId } = await httpPosthogAdapter.reconcileDestination(
      creds,
      null,
      {
        kind: "present",
        webhookUrl: "https://api.notify.com/webhooks/posthog/cust-1",
        eventNames: ["signup", "purchase"],
        customerId: "cust-1",
      }
    );

    expect(hogFunctionId).toBe("hf_new");
    const call = calls[0];
    expect(call.method).toBe("POST");
    expect(call.url).toBe("https://us.posthog.com/api/projects/42/hog_functions/");
    const body = call.body as Record<string, unknown>;
    expect(body.type).toBe("destination");
    expect(body.name).toBe("Notify — cust-1");
    const filters = body.filters as { events: Array<{ id: string }> };
    expect(filters.events.map((e) => e.id)).toEqual(["signup", "purchase"]);
  });

  it("PATCHes filters when current id is set and desired is present", async () => {
    nextResponses.push({ status: 200, body: { id: "hf_existing" } });

    const { hogFunctionId } = await httpPosthogAdapter.reconcileDestination(
      creds,
      "hf_existing",
      {
        kind: "present",
        webhookUrl: "https://x",
        eventNames: ["checkout_started"],
        customerId: "cust-1",
      }
    );

    expect(hogFunctionId).toBe("hf_existing");
    const call = calls[0];
    expect(call.method).toBe("PATCH");
    expect(call.url).toBe(
      "https://us.posthog.com/api/projects/42/hog_functions/hf_existing/"
    );
    expect(call.body).toEqual({
      filters: {
        events: [
          { id: "checkout_started", name: "checkout_started", type: "events", order: 0 },
        ],
      },
    });
  });

  it("uses the disabled-sentinel filter when desired is present with empty events", async () => {
    nextResponses.push({ status: 200, body: {} });

    await httpPosthogAdapter.reconcileDestination(creds, "hf_existing", {
      kind: "present",
      webhookUrl: "https://x",
      eventNames: [],
      customerId: "cust-1",
    });

    const filters = (calls[0].body as { filters: { events: Array<{ id: string }> } })
      .filters;
    expect(filters.events.map((e) => e.id)).toEqual([
      "__notify_no_active_posthog_events__",
    ]);
  });

  it("soft-deletes when desired is absent and a function exists", async () => {
    nextResponses.push({ status: 200, body: {} });

    const { hogFunctionId } = await httpPosthogAdapter.reconcileDestination(
      creds,
      "hf_existing",
      { kind: "absent" }
    );

    expect(hogFunctionId).toBeNull();
    expect(calls[0].method).toBe("PATCH");
    expect(calls[0].body).toEqual({ deleted: true });
  });

  it("is a no-op when desired is absent and no function exists", async () => {
    const { hogFunctionId } = await httpPosthogAdapter.reconcileDestination(
      creds,
      null,
      { kind: "absent" }
    );

    expect(hogFunctionId).toBeNull();
    expect(calls).toHaveLength(0);
  });
});

describe("error mapping", () => {
  it("401 throws PosthogAuthError", async () => {
    nextResponses.push({ status: 401, body: { detail: "Invalid token" } });
    await expect(
      httpPosthogAdapter.reconcileDestination(creds, "hf", {
        kind: "present",
        webhookUrl: "https://x",
        eventNames: ["x"],
        customerId: "c",
      })
    ).rejects.toBeInstanceOf(PosthogAuthError);
  });

  it("4xx (non-401) throws PosthogApiError with status and body", async () => {
    nextResponses.push({ status: 422, body: { detail: "bad" } });
    try {
      await httpPosthogAdapter.reconcileDestination(creds, "hf", {
        kind: "present",
        webhookUrl: "https://x",
        eventNames: ["x"],
        customerId: "c",
      });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(PosthogApiError);
      const e = err as PosthogApiError;
      expect(e.status).toBe(422);
      expect(e.body).toEqual({ detail: "bad" });
    }
  });

  it("5xx throws PosthogTransientError", async () => {
    nextResponses.push({ status: 503, body: { detail: "unavailable" } });
    try {
      await httpPosthogAdapter.reconcileDestination(creds, "hf", {
        kind: "present",
        webhookUrl: "https://x",
        eventNames: ["x"],
        customerId: "c",
      });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(PosthogTransientError);
      expect((err as PosthogTransientError).status).toBe(503);
    }
  });

  it("network error throws PosthogTransientError with null status", async () => {
    throwOnFetch = new TypeError("fetch failed");
    try {
      await httpPosthogAdapter.verifyCredentials(creds);
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(PosthogTransientError);
      expect((err as PosthogTransientError).status).toBeNull();
    }
  });
});
