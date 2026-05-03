import { describe, it, expect, beforeAll, beforeEach, afterAll } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { createTestDb, resetTestDb, type TestDb } from "../test/db";
import { customer, customerIntegration, customerEventDefinition } from "../db/schema";
import {
  listActiveEventNames,
  setPosthogEventSelection,
  upsertSeenPosthogEventDefinition,
} from "../repository/event-definition";

const CUSTOMER_ID = "00000000-0000-0000-0000-000000000aaa";
const INTEGRATION_ID = "00000000-0000-0000-0000-000000000bbb";

let testDb: TestDb;
let pgClient: PGlite;

beforeAll(async () => {
  const created = await createTestDb();
  testDb = created.db;
  pgClient = created.client;
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

describe("event definition repository", () => {
  it("stores selected PostHog events as active definitions", async () => {
    await setPosthogEventSelection(testDb, {
      customerId: CUSTOMER_ID,
      integrationId: INTEGRATION_ID,
      events: [
        { name: "purchase", volume: 9 },
        { name: "signup", volume: 4 },
      ],
    });

    await setPosthogEventSelection(testDb, {
      customerId: CUSTOMER_ID,
      integrationId: INTEGRATION_ID,
      events: [{ name: "purchase", volume: 12 }],
    });

    const rows = await testDb.select().from(customerEventDefinition);
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.eventName === "purchase")?.volume).toBe(12);
    expect(rows.find((row) => row.eventName === "purchase")?.active).toBe(true);
    expect(rows.find((row) => row.eventName === "signup")?.active).toBe(false);
  });

  it("lists only active event names for workflow triggers", async () => {
    await setPosthogEventSelection(testDb, {
      customerId: CUSTOMER_ID,
      integrationId: INTEGRATION_ID,
      events: [
        { name: "signup", volume: 4 },
        { name: "purchase", volume: 9 },
      ],
    });

    await testDb
      .update(customerEventDefinition)
      .set({ active: false })
      .where(eq(customerEventDefinition.eventName, "signup"));

    await expect(listActiveEventNames(testDb, CUSTOMER_ID)).resolves.toEqual([
      "purchase",
    ]);
  });

  it("stores newly seen webhook events without selecting them", async () => {
    const row = await upsertSeenPosthogEventDefinition(testDb, {
      customerId: CUSTOMER_ID,
      integrationId: INTEGRATION_ID,
      eventName: "name_changed",
    });

    expect(row.eventName).toBe("name_changed");
    expect(row.active).toBe(false);
  });

  it("updates seen timestamps without changing checkbox selection", async () => {
    await setPosthogEventSelection(testDb, {
      customerId: CUSTOMER_ID,
      integrationId: INTEGRATION_ID,
      events: [
        { name: "selected_event", volume: 3 },
        { name: "unselected_event", volume: 4 },
      ],
    });
    await setPosthogEventSelection(testDb, {
      customerId: CUSTOMER_ID,
      integrationId: INTEGRATION_ID,
      events: [{ name: "selected_event", volume: 3 }],
    });

    const selected = await upsertSeenPosthogEventDefinition(testDb, {
      customerId: CUSTOMER_ID,
      integrationId: INTEGRATION_ID,
      eventName: "selected_event",
    });
    const unselected = await upsertSeenPosthogEventDefinition(testDb, {
      customerId: CUSTOMER_ID,
      integrationId: INTEGRATION_ID,
      eventName: "unselected_event",
    });

    expect(selected.active).toBe(true);
    expect(unselected.active).toBe(false);
  });
});
