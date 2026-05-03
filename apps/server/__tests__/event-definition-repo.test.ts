import { describe, it, expect, beforeAll, beforeEach, afterAll } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { createTestDb, resetTestDb, type TestDb } from "../test/db";
import {
  customer,
  customerIntegration,
  customerEventDefinition,
} from "../db/schema";
import {
  createEventDefinitionRepo,
  type EventDefinitionRepo,
} from "../repository/event-definition";

const CUSTOMER_ID = "00000000-0000-0000-0000-000000000aaa";
const INTEGRATION_ID = "00000000-0000-0000-0000-000000000bbb";

let testDb: TestDb;
let pgClient: PGlite;
let repo: EventDefinitionRepo;

beforeAll(async () => {
  const created = await createTestDb();
  testDb = created.db;
  pgClient = created.client;
  repo = createEventDefinitionRepo(testDb);
});

afterAll(async () => {
  await pgClient.close();
});

beforeEach(async () => {
  await resetTestDb(pgClient);
  await testDb.insert(customer).values({
    id: CUSTOMER_ID,
    email: "c@example.com",
    name: "C",
  });
  await testDb.insert(customerIntegration).values({
    id: INTEGRATION_ID,
    customerId: CUSTOMER_ID,
    provider: "posthog",
    config: {
      personal_api_key_encrypted: "key",
      project_id: "42",
      region: "us",
      hog_function_id: "hf",
    },
  });
});

describe("recordSeen", () => {
  it("inserts a new (integrationId, eventName) row with active = false", async () => {
    const result = await repo.run({
      kind: "recordSeen",
      customerId: CUSTOMER_ID,
      integrationId: INTEGRATION_ID,
      provider: "posthog",
      eventName: "name_changed",
    });

    expect(result.kind).toBe("recordSeen");
    expect(result.active).toBe(false);

    const rows = await testDb.select().from(customerEventDefinition);
    expect(rows).toHaveLength(1);
    expect(rows[0].eventName).toBe("name_changed");
    expect(rows[0].active).toBe(false);
  });

  it("updates last_seen_at and volume but never modifies active on conflict", async () => {
    await repo.run({
      kind: "replaceSelection",
      customerId: CUSTOMER_ID,
      integrationId: INTEGRATION_ID,
      provider: "posthog",
      events: [{ name: "purchase", volume: 1 }],
    });

    await new Promise((r) => setTimeout(r, 5));

    const before = await testDb
      .select()
      .from(customerEventDefinition)
      .where(eq(customerEventDefinition.eventName, "purchase"));
    expect(before[0].active).toBe(true);
    const lastSeenBefore = before[0].lastSeenAt;

    await repo.run({
      kind: "recordSeen",
      customerId: CUSTOMER_ID,
      integrationId: INTEGRATION_ID,
      provider: "posthog",
      eventName: "purchase",
      volume: 99,
    });

    const after = await testDb
      .select()
      .from(customerEventDefinition)
      .where(eq(customerEventDefinition.eventName, "purchase"));
    expect(after[0].active).toBe(true);
    expect(after[0].volume).toBe(99);
    expect(after[0].lastSeenAt!.getTime()).toBeGreaterThan(
      lastSeenBefore!.getTime()
    );
  });

  it("converges to a single row when called concurrently for the same key", async () => {
    await Promise.all(
      Array.from({ length: 10 }, () =>
        repo.run({
          kind: "recordSeen",
          customerId: CUSTOMER_ID,
          integrationId: INTEGRATION_ID,
          provider: "posthog",
          eventName: "concurrent",
        })
      )
    );

    const rows = await testDb
      .select()
      .from(customerEventDefinition)
      .where(eq(customerEventDefinition.eventName, "concurrent"));
    expect(rows).toHaveLength(1);
  });
});

describe("replaceSelection", () => {
  it("activates exactly the supplied names and deactivates everything else", async () => {
    await repo.run({
      kind: "replaceSelection",
      customerId: CUSTOMER_ID,
      integrationId: INTEGRATION_ID,
      provider: "posthog",
      events: [
        { name: "purchase", volume: 9 },
        { name: "signup", volume: 4 },
      ],
    });

    await repo.run({
      kind: "replaceSelection",
      customerId: CUSTOMER_ID,
      integrationId: INTEGRATION_ID,
      provider: "posthog",
      events: [{ name: "purchase", volume: 12 }],
    });

    const rows = await testDb.select().from(customerEventDefinition);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.eventName === "purchase")?.active).toBe(true);
    expect(rows.find((r) => r.eventName === "purchase")?.volume).toBe(12);
    expect(rows.find((r) => r.eventName === "signup")?.active).toBe(false);
  });

  it("deactivates every row when called with an empty list", async () => {
    await repo.run({
      kind: "replaceSelection",
      customerId: CUSTOMER_ID,
      integrationId: INTEGRATION_ID,
      provider: "posthog",
      events: [
        { name: "a", volume: 1 },
        { name: "b", volume: 2 },
      ],
    });

    await repo.run({
      kind: "replaceSelection",
      customerId: CUSTOMER_ID,
      integrationId: INTEGRATION_ID,
      provider: "posthog",
      events: [],
    });

    const rows = await testDb.select().from(customerEventDefinition);
    expect(rows.every((r) => r.active === false)).toBe(true);
  });

  it("preserves selection regardless of recordSeen interleaving", async () => {
    await repo.run({
      kind: "replaceSelection",
      customerId: CUSTOMER_ID,
      integrationId: INTEGRATION_ID,
      provider: "posthog",
      events: [{ name: "selected", volume: 1 }],
    });

    await Promise.all([
      repo.run({
        kind: "recordSeen",
        customerId: CUSTOMER_ID,
        integrationId: INTEGRATION_ID,
        provider: "posthog",
        eventName: "selected",
      }),
      repo.run({
        kind: "recordSeen",
        customerId: CUSTOMER_ID,
        integrationId: INTEGRATION_ID,
        provider: "posthog",
        eventName: "drive_by",
      }),
    ]);

    const rows = await testDb.select().from(customerEventDefinition);
    expect(rows.find((r) => r.eventName === "selected")?.active).toBe(true);
    expect(rows.find((r) => r.eventName === "drive_by")?.active).toBe(false);
  });
});

describe("listActiveNames", () => {
  it("returns only active rows scoped to the customer", async () => {
    await repo.run({
      kind: "replaceSelection",
      customerId: CUSTOMER_ID,
      integrationId: INTEGRATION_ID,
      provider: "posthog",
      events: [
        { name: "purchase", volume: 1 },
        { name: "signup", volume: 1 },
      ],
    });

    await testDb
      .update(customerEventDefinition)
      .set({ active: false })
      .where(eq(customerEventDefinition.eventName, "signup"));

    const result = await repo.run({
      kind: "listActiveNames",
      customerId: CUSTOMER_ID,
    });

    expect(result.names).toEqual(["purchase"]);
  });
});

describe("listForIntegration", () => {
  it("returns all rows with active and volume", async () => {
    await repo.run({
      kind: "replaceSelection",
      customerId: CUSTOMER_ID,
      integrationId: INTEGRATION_ID,
      provider: "posthog",
      events: [{ name: "selected", volume: 7 }],
    });
    await repo.run({
      kind: "recordSeen",
      customerId: CUSTOMER_ID,
      integrationId: INTEGRATION_ID,
      provider: "posthog",
      eventName: "unselected",
      volume: 3,
    });

    const result = await repo.run({
      kind: "listForIntegration",
      integrationId: INTEGRATION_ID,
    });

    expect(result.rows).toEqual([
      { name: "selected", active: true, volume: 7 },
      { name: "unselected", active: false, volume: 3 },
    ]);
  });
});
