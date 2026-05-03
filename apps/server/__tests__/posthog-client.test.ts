import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  createHogFunction,
  deleteHogFunction,
  listRecentEvents,
  updateHogFunctionFilters,
  PosthogAuthError,
  PosthogClientError,
  PosthogTransientError,
  type PosthogClientConfig,
} from "../services/posthog";

type FetchCall = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
};

type StubResponse = {
  status: number;
  body?: unknown;
};

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

const cfg: PosthogClientConfig = {
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

describe("createHogFunction", () => {
  it("posts to the project hog_functions endpoint with the right body", async () => {
    nextResponses.push({ status: 201, body: { id: "hf_abc" } });

    const result = await createHogFunction(cfg, {
      webhookUrl: "https://api.notify.com/webhooks/posthog/cust-1",
      eventNames: ["signup", "purchase"],
      customerId: "cust-1",
    });

    expect(result).toEqual({ hogFunctionId: "hf_abc" });
    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call.url).toBe(
      "https://us.posthog.com/api/projects/42/hog_functions/"
    );
    expect(call.method).toBe("POST");
    expect(call.headers.Authorization).toBe("Bearer phx_test_key");

    const body = call.body as Record<string, unknown>;
    expect(body.type).toBe("destination");
    expect(body.name).toBe("Notify — cust-1");
    expect(body.enabled).toBe(true);
    expect(typeof body.hog).toBe("string");
    expect(body.inputs).toEqual({
      webhook_url: { value: "https://api.notify.com/webhooks/posthog/cust-1" },
    });
    const filters = body.filters as { events: Array<{ id: string }> };
    expect(filters.events.map((e) => e.id)).toEqual(["signup", "purchase"]);
  });
});

describe("updateHogFunctionFilters", () => {
  it("PATCHes only the filters field", async () => {
    nextResponses.push({ status: 200, body: { id: "hf_abc" } });

    await updateHogFunctionFilters(cfg, {
      hogFunctionId: "hf_abc",
      eventNames: ["checkout_started"],
    });

    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call.method).toBe("PATCH");
    expect(call.url).toBe(
      "https://us.posthog.com/api/projects/42/hog_functions/hf_abc/"
    );
    expect(call.body).toEqual({
      filters: {
        events: [
          { id: "checkout_started", name: "checkout_started", type: "events", order: 0 },
        ],
      },
    });
  });
});

describe("deleteHogFunction", () => {
  it("soft-deletes the project hog function via PATCH", async () => {
    nextResponses.push({ status: 200, body: {} });

    await deleteHogFunction(cfg, { hogFunctionId: "hf_abc" });

    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call.method).toBe("PATCH");
    expect(call.url).toBe(
      "https://us.posthog.com/api/projects/42/hog_functions/hf_abc/"
    );
    expect(call.body).toEqual({ deleted: true });
  });
});

describe("listRecentEvents", () => {
  it("posts a HogQL query with defaults and parses the result tuples", async () => {
    nextResponses.push({
      status: 200,
      body: {
        results: [
          ["signup", 120],
          ["purchase", 87],
        ],
      },
    });

    const events = await listRecentEvents(cfg);

    expect(events).toEqual([
      { name: "signup", volume: 120 },
      { name: "purchase", volume: 87 },
    ]);
    const call = calls[0];
    expect(call.url).toBe("https://us.posthog.com/api/projects/42/query/");
    const body = call.body as { query: { kind: string; query: string } };
    expect(body.query.kind).toBe("HogQLQuery");
    expect(body.query.query).toContain("INTERVAL 30 DAY");
    expect(body.query.query).toContain("NOT startsWith(event, '$')");
    expect(body.query.query).toContain("LIMIT 50");
  });

  it("includes $ events when excludePrefixed is false and respects custom days/limit", async () => {
    nextResponses.push({ status: 200, body: { results: [] } });

    await listRecentEvents(cfg, {
      days: 7,
      excludePrefixed: false,
      limit: 5,
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

    const events = await listRecentEvents(cfg);
    expect(events).toEqual([{ name: "signup", volume: 42 }]);
  });
});

describe("error mapping", () => {
  it("401 throws PosthogAuthError", async () => {
    nextResponses.push({ status: 401, body: { detail: "Invalid token" } });
    await expect(
      updateHogFunctionFilters(cfg, {
        hogFunctionId: "hf_abc",
        eventNames: ["x"],
      })
    ).rejects.toBeInstanceOf(PosthogAuthError);
  });

  it("4xx (non-401) throws PosthogClientError with status and body", async () => {
    nextResponses.push({ status: 422, body: { detail: "bad" } });
    try {
      await updateHogFunctionFilters(cfg, {
        hogFunctionId: "hf_abc",
        eventNames: ["x"],
      });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(PosthogClientError);
      const e = err as PosthogClientError;
      expect(e.status).toBe(422);
      expect(e.body).toEqual({ detail: "bad" });
    }
  });

  it("5xx throws PosthogTransientError", async () => {
    nextResponses.push({ status: 503, body: { detail: "unavailable" } });
    try {
      await updateHogFunctionFilters(cfg, {
        hogFunctionId: "hf_abc",
        eventNames: ["x"],
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
      await updateHogFunctionFilters(cfg, {
        hogFunctionId: "hf_abc",
        eventNames: ["x"],
      });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(PosthogTransientError);
      expect((err as PosthogTransientError).status).toBeNull();
    }
  });
});
