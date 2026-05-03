import { describe, it, expect, beforeAll, beforeEach, afterAll, mock } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb, resetTestDb, type TestDb } from "../test/db";
import { customer, customerIntegration, customerEventDefinition } from "../db/schema";
import {
  createInMemoryPosthogAdapter,
  type InMemoryPosthogAdapter,
} from "../services/posthog/in-memory-adapter";

// Construct the in-memory PostHog adapter and route the production export
// through it. Routes only know about httpPosthogAdapter; we replace it.
let posthogAdapter: InMemoryPosthogAdapter = createInMemoryPosthogAdapter();

mock.module("../services/posthog", () => ({
  httpPosthogAdapter: new Proxy({} as InMemoryPosthogAdapter, {
    get: (_t, key) => (posthogAdapter as any)[key],
  }),
  // Re-export the rest of the module surface used elsewhere (none in routes).
  HOG_DESTINATION_SOURCE: "",
  HOG_INPUTS_SCHEMA: [],
}));

// Construct the test DB before registering its mock so `import { db } from "../db"`
// resolves to the live PGlite handle.
const { db: testDb, client: pgClient } = (await createTestDb()) as {
  db: TestDb;
  client: PGlite;
};

mock.module("../db", () => ({ db: testDb }));

const { integrationApp } = await import("../functions/public/integration");

const CUSTOMER_ID = "00000000-0000-0000-0000-000000000aaa";
const WEBHOOK_BASE = "https://api.notify.test";

async function seedCustomer() {
  await testDb.insert(customer).values({
    id: CUSTOMER_ID,
    email: "c@example.com",
    name: "C",
  });
}

beforeAll(() => {
  process.env.WEBHOOK_BASE_URL = WEBHOOK_BASE;
});

afterAll(async () => {
  await pgClient.close();
});

beforeEach(async () => {
  await resetTestDb(pgClient);
  posthogAdapter = createInMemoryPosthogAdapter();
});

function request(
  path: string,
  init: RequestInit & { customerId?: string | null } = {}
) {
  const headers = new Headers(init.headers);
  if (init.customerId !== null) {
    headers.set("x-customer-id", init.customerId ?? CUSTOMER_ID);
  }
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  return integrationApp.request(`http://localhost${path}`, {
    ...init,
    headers,
  });
}

describe("auth", () => {
  it("returns 401 when X-Customer-Id is missing", async () => {
    const res = await request("/api/integrations/posthog/connect", {
      method: "POST",
      body: JSON.stringify({ personal_api_key: "k", project_id: "1" }),
      customerId: null,
    });
    expect(res.status).toBe(401);
  });
});

describe("POST /api/integrations/posthog/connect", () => {
  it("happy path inserts a row and returns the integration id", async () => {
    await seedCustomer();

    const res = await request("/api/integrations/posthog/connect", {
      method: "POST",
      body: JSON.stringify({ personal_api_key: "ph-key", project_id: "42" }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { integration_id: string };
    expect(body.integration_id).toBeTruthy();

    const rows = await testDb.select().from(customerIntegration);
    expect(rows).toHaveLength(1);
    expect(rows[0].config.hog_function_id).toBeNull();
    expect(rows[0].config.project_id).toBe("42");

    expect(posthogAdapter.getHogFunction("42")).toBeNull();
  });

  it("returns 502 when PostHog rejects the credentials", async () => {
    await seedCustomer();
    posthogAdapter.setSimulate("auth");

    const res = await request("/api/integrations/posthog/connect", {
      method: "POST",
      body: JSON.stringify({ personal_api_key: "bad", project_id: "1" }),
    });

    expect(res.status).toBe(502);
    const rows = await testDb.select().from(customerIntegration);
    expect(rows).toHaveLength(0);
  });

  it("returns 409 when an integration already exists", async () => {
    await seedCustomer();
    const first = await request("/api/integrations/posthog/connect", {
      method: "POST",
      body: JSON.stringify({ personal_api_key: "k", project_id: "1" }),
    });
    expect(first.status).toBe(201);

    const second = await request("/api/integrations/posthog/connect", {
      method: "POST",
      body: JSON.stringify({ personal_api_key: "k", project_id: "1" }),
    });
    expect(second.status).toBe(409);
  });
});

describe("GET /api/integrations/posthog/events", () => {
  it("returns the merged event list", async () => {
    await seedCustomer();
    await request("/api/integrations/posthog/connect", {
      method: "POST",
      body: JSON.stringify({ personal_api_key: "k", project_id: "1" }),
    });

    posthogAdapter.setEvents("1", [
      { name: "purchase", volume: 9 },
      { name: "signup", volume: 4 },
    ]);

    const res = await request("/api/integrations/posthog/events?days=14&limit=20");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      { name: "purchase", volume: 9, active: false },
      { name: "signup", volume: 4, active: false },
    ]);

    const definitions = await testDb.select().from(customerEventDefinition);
    expect(definitions).toHaveLength(0);
  });

  it("returns 404 when no integration exists", async () => {
    await seedCustomer();
    const res = await request("/api/integrations/posthog/events");
    expect(res.status).toBe(404);
  });
});

describe("POST /api/integrations/posthog/events/selection", () => {
  it("stores selected events and provisions the hog function", async () => {
    await seedCustomer();
    await request("/api/integrations/posthog/connect", {
      method: "POST",
      body: JSON.stringify({ personal_api_key: "k", project_id: "1" }),
    });

    const res = await request("/api/integrations/posthog/events/selection", {
      method: "POST",
      body: JSON.stringify({
        events: [
          { name: "purchase", volume: 9 },
          { name: "signup", volume: 4 },
        ],
      }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ event_names: ["purchase", "signup"] });

    const integrations = await testDb.select().from(customerIntegration);
    const fn = posthogAdapter.getHogFunction("1");
    expect(fn).not.toBeNull();
    expect(fn!.eventNames).toEqual(["purchase", "signup"]);
    expect(integrations[0].config.hog_function_id).toBe(fn!.id);

    const definitions = await testDb.select().from(customerEventDefinition);
    expect(
      definitions.map((row) => ({
        eventName: row.eventName,
        volume: row.volume,
        active: row.active,
      }))
    ).toEqual([
      { eventName: "purchase", volume: 9, active: true },
      { eventName: "signup", volume: 4, active: true },
    ]);
  });

  it("marks deselected events inactive and patches filters", async () => {
    await seedCustomer();
    await request("/api/integrations/posthog/connect", {
      method: "POST",
      body: JSON.stringify({ personal_api_key: "k", project_id: "1" }),
    });
    await request("/api/integrations/posthog/events/selection", {
      method: "POST",
      body: JSON.stringify({
        events: [
          { name: "purchase", volume: 9 },
          { name: "signup", volume: 4 },
        ],
      }),
    });
    const firstFnId = posthogAdapter.getHogFunction("1")!.id;

    const res = await request("/api/integrations/posthog/events/selection", {
      method: "POST",
      body: JSON.stringify({ events: [{ name: "purchase", volume: 9 }] }),
    });

    expect(res.status).toBe(200);
    const fn = posthogAdapter.getHogFunction("1")!;
    expect(fn.id).toBe(firstFnId);
    expect(fn.eventNames).toEqual(["purchase"]);

    const definitions = await testDb.select().from(customerEventDefinition);
    expect(
      definitions
        .map((row) => ({ eventName: row.eventName, active: row.active }))
        .sort((a, b) => a.eventName.localeCompare(b.eventName))
    ).toEqual([
      { eventName: "purchase", active: true },
      { eventName: "signup", active: false },
    ]);
  });

  it("returns 404 when no integration exists", async () => {
    await seedCustomer();
    const res = await request("/api/integrations/posthog/events/selection", {
      method: "POST",
      body: JSON.stringify({ events: [{ name: "purchase" }] }),
    });
    expect(res.status).toBe(404);
  });

  it("returns 503 with Retry-After during a transient PostHog outage", async () => {
    await seedCustomer();
    await request("/api/integrations/posthog/connect", {
      method: "POST",
      body: JSON.stringify({ personal_api_key: "k", project_id: "1" }),
    });
    posthogAdapter.setSimulate("transient");

    const res = await request("/api/integrations/posthog/events/selection", {
      method: "POST",
      body: JSON.stringify({ events: [{ name: "purchase", volume: 9 }] }),
    });

    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("30");
  });
});

describe("DELETE /api/integrations/posthog", () => {
  it("removes the remote hog function, removes the row, and returns 204", async () => {
    await seedCustomer();
    await request("/api/integrations/posthog/connect", {
      method: "POST",
      body: JSON.stringify({ personal_api_key: "k", project_id: "1" }),
    });
    await request("/api/integrations/posthog/events/selection", {
      method: "POST",
      body: JSON.stringify({ events: [{ name: "purchase", volume: 9 }] }),
    });
    expect(posthogAdapter.getHogFunction("1")).not.toBeNull();

    const res = await request("/api/integrations/posthog", { method: "DELETE" });
    expect(res.status).toBe(204);

    const rows = await testDb.select().from(customerIntegration);
    expect(rows).toHaveLength(0);
    expect(posthogAdapter.getHogFunction("1")).toBeNull();
  });

  it("returns 404 when no integration exists", async () => {
    await seedCustomer();
    const res = await request("/api/integrations/posthog", { method: "DELETE" });
    expect(res.status).toBe(404);
  });
});
