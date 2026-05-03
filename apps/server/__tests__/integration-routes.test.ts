import { describe, it, expect, beforeAll, beforeEach, afterAll, mock } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb, resetTestDb, type TestDb } from "../test/db";
import { customer, customerIntegration, customerEventDefinition } from "../db/schema";

// ── PostHog client stubs (Chunk A surface) ───────────────────────────────
class PosthogAuthError extends Error {
  constructor() {
    super("posthog_auth_failed");
    this.name = "PosthogAuthError";
  }
}

class PosthogTransientError extends Error {
  constructor() {
    super("posthog_transient");
    this.name = "PosthogTransientError";
  }
}

const mockCreateHogFunction = mock<any>();
const mockListRecentEvents = mock<any>();
const mockUpdateHogFunctionFilters = mock<any>();
const mockDeleteHogFunction = mock<any>();

mock.module("../services/posthog", () => ({
  createHogFunction: mockCreateHogFunction,
  listRecentEvents: mockListRecentEvents,
  updateHogFunctionFilters: mockUpdateHogFunctionFilters,
  deleteHogFunction: mockDeleteHogFunction,
  PosthogAuthError,
  PosthogTransientError,
}));

// ── DB module mock pointing at a PGlite test DB ──────────────────────────
// Construct the test DB synchronously before registering the mock so that
// the static `import { db } from "../db"` in the route module resolves to
// the live PGlite handle rather than a still-undefined binding.
const { db: testDb, client: pgClient } = (await createTestDb()) as {
  db: TestDb;
  client: PGlite;
};

mock.module("../db", () => ({ db: testDb }));

// Imports must come AFTER the module mocks so that the route file resolves
// the mocked versions.
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
  mockCreateHogFunction.mockReset();
  mockListRecentEvents.mockReset();
  mockUpdateHogFunctionFilters.mockReset();
  mockDeleteHogFunction.mockReset();
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

    expect(mockCreateHogFunction).not.toHaveBeenCalled();
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

  it("does not call PostHog during connect", async () => {
    await seedCustomer();
    mockCreateHogFunction.mockRejectedValue(new PosthogAuthError());

    const res = await request("/api/integrations/posthog/connect", {
      method: "POST",
      body: JSON.stringify({ personal_api_key: "bad", project_id: "1" }),
    });

    expect(res.status).toBe(201);
    const rows = await testDb.select().from(customerIntegration);
    expect(rows).toHaveLength(1);
    expect(mockCreateHogFunction).not.toHaveBeenCalled();
  });

  it("does not surface transient PostHog errors during connect", async () => {
    await seedCustomer();
    mockCreateHogFunction.mockRejectedValue(new PosthogTransientError());

    const res = await request("/api/integrations/posthog/connect", {
      method: "POST",
      body: JSON.stringify({ personal_api_key: "k", project_id: "1" }),
    });

    expect(res.status).toBe(201);
    expect(res.headers.get("retry-after")).toBeNull();
  });
});

describe("GET /api/integrations/posthog/events", () => {
  it("returns the list from the PostHog client", async () => {
    await seedCustomer();

    await request("/api/integrations/posthog/connect", {
      method: "POST",
      body: JSON.stringify({ personal_api_key: "k", project_id: "1" }),
    });

    mockListRecentEvents.mockResolvedValue([
      { name: "purchase", volume: 9 },
      { name: "signup", volume: 4 },
    ]);

    const res = await request("/api/integrations/posthog/events?days=14&limit=20");
  
    expect(res.status).toBe(200);
    
    expect(await res.json()).toEqual([
      { name: "purchase", volume: 9, active: false },
      { name: "signup", volume: 4, active: false },
    ]);

    const definitions = await testDb
      .select()
      .from(customerEventDefinition);
    expect(definitions).toHaveLength(0);

    const [, args] = mockListRecentEvents.mock.calls[0];

    expect(args).toEqual({ days: 14, limit: 20, excludePrefixed: true });
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
    mockCreateHogFunction.mockResolvedValue({ hogFunctionId: "hf-1" });
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
    expect(integrations[0].config.hog_function_id).toBe("hf-1");
    expect(mockCreateHogFunction).toHaveBeenCalledTimes(1);
    const [, hogArgs] = mockCreateHogFunction.mock.calls[0] as [any, any];
    expect(hogArgs.eventNames).toEqual(["purchase", "signup"]);

    const definitions = await testDb.select().from(customerEventDefinition);
    expect(definitions.map((row) => ({
      eventName: row.eventName,
      volume: row.volume,
      active: row.active,
    }))).toEqual([
      { eventName: "purchase", volume: 9, active: true },
      { eventName: "signup", volume: 4, active: true },
    ]);
  });

  it("marks deselected events inactive and updates the hog function filters", async () => {
    await seedCustomer();
    mockCreateHogFunction.mockResolvedValue({ hogFunctionId: "hf-1" });
    mockUpdateHogFunctionFilters.mockResolvedValue(undefined);
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

    const res = await request("/api/integrations/posthog/events/selection", {
      method: "POST",
      body: JSON.stringify({ events: [{ name: "purchase", volume: 9 }] }),
    });

    expect(res.status).toBe(200);
    expect(mockUpdateHogFunctionFilters).toHaveBeenCalledWith(
      expect.anything(),
      { hogFunctionId: "hf-1", eventNames: ["purchase"] }
    );
    const definitions = await testDb.select().from(customerEventDefinition);
    expect(definitions.map((row) => ({
      eventName: row.eventName,
      active: row.active,
    })).sort((a, b) => a.eventName.localeCompare(b.eventName))).toEqual([
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
});

describe("DELETE /api/integrations/posthog", () => {
  it("removes the remote hog function, removes the row, and returns 204", async () => {
    await seedCustomer();
    mockCreateHogFunction.mockResolvedValue({ hogFunctionId: "hf-1" });
    mockDeleteHogFunction.mockResolvedValue(undefined);
    await request("/api/integrations/posthog/connect", {
      method: "POST",
      body: JSON.stringify({ personal_api_key: "k", project_id: "1" }),
    });
    await request("/api/integrations/posthog/events/selection", {
      method: "POST",
      body: JSON.stringify({ events: [{ name: "purchase", volume: 9 }] }),
    });
    mockDeleteHogFunction.mockClear();

    const res = await request("/api/integrations/posthog", { method: "DELETE" });
    expect(res.status).toBe(204);

    const rows = await testDb.select().from(customerIntegration);
    expect(rows).toHaveLength(0);
    expect(mockDeleteHogFunction).toHaveBeenCalledWith(
      expect.anything(),
      { hogFunctionId: "hf-1" }
    );
  });

  it("returns 404 when no integration exists", async () => {
    await seedCustomer();
    const res = await request("/api/integrations/posthog", { method: "DELETE" });
    expect(res.status).toBe(404);
  });
});
