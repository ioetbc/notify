import { describe, it, expect, beforeAll, beforeEach, afterAll } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { createTestDb, resetTestDb, type TestDb } from "../test/db";
import { customer, customerIntegration } from "../db/schema";
import type { PosthogIntegrationConfig } from "../db/schema";
import {
  findByCustomerAndProvider,
  findById,
  create,
  updateConfig,
  deleteIntegration,
} from "../repository/integration";

let db: TestDb;
let client: PGlite;

const CUSTOMER_ID = "00000000-0000-0000-0000-000000000001";

const baseConfig: PosthogIntegrationConfig = {
  personal_api_key_encrypted: "cGgtYWJj",
  project_id: "1",
  hog_function_id: null,
  webhook_secret_encrypted: "c2VjcmV0",
};

async function seedCustomer(id = CUSTOMER_ID, email = "c@example.com") {
  await db.insert(customer).values({ id, email, name: "C" });
}

beforeAll(async () => {
  ({ db, client } = await createTestDb());
});

afterAll(async () => {
  await client.close();
});

beforeEach(async () => {
  await resetTestDb(client);
});

describe("integration repository", () => {
  it("create round-trips a row", async () => {
    await seedCustomer();
    const created = await create(db, {
      customerId: CUSTOMER_ID,
      provider: "posthog",
      config: baseConfig,
    });

    expect(created.customerId).toBe(CUSTOMER_ID);
    expect(created.provider).toBe("posthog");
    expect(created.config).toEqual(baseConfig);
    expect(created.connectedAt).toBeInstanceOf(Date);

    const found = await findById(db, created.id);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(created.id);
  });

  it("findByCustomerAndProvider returns null when no row exists", async () => {
    await seedCustomer();
    const found = await findByCustomerAndProvider(
      db,
      CUSTOMER_ID,
      "posthog"
    );
    expect(found).toBeNull();
  });

  it("findByCustomerAndProvider returns the matching row", async () => {
    await seedCustomer();
    const created = await create(db, {
      customerId: CUSTOMER_ID,
      provider: "posthog",
      config: baseConfig,
    });

    const found = await findByCustomerAndProvider(
      db,
      CUSTOMER_ID,
      "posthog"
    );
    expect(found?.id).toBe(created.id);
  });

  it("enforces uniqueness on (customerId, provider)", async () => {
    await seedCustomer();
    await create(db, {
      customerId: CUSTOMER_ID,
      provider: "posthog",
      config: baseConfig,
    });

    expect(
      create(db, {
        customerId: CUSTOMER_ID,
        provider: "posthog",
        config: baseConfig,
      })
    ).rejects.toThrow();
  });

  it("updateConfig overwrites the config payload", async () => {
    await seedCustomer();
    
    const created = await create(db, {
      customerId: CUSTOMER_ID,
      provider: "posthog",
      config: baseConfig,
    });

    const next: PosthogIntegrationConfig = {
      ...baseConfig,
      hog_function_id: "hf_123",
      project_id: "2",
    };
    const updated = await updateConfig(db, created.id, next);
    expect(updated.config).toEqual(next);

    const reread = await findById(db, created.id);
    expect(reread!.config).toEqual(next);
  });

  it("deleteIntegration removes the row", async () => {
    await seedCustomer();
    const created = await create(db, {
      customerId: CUSTOMER_ID,
      provider: "posthog",
      config: baseConfig,
    });

    await deleteIntegration(db, created.id);

    const found = await findById(db, created.id);
    expect(found).toBeNull();
  });

  it("cascades delete from customer to integration", async () => {
    await seedCustomer();
    await create(db, {
      customerId: CUSTOMER_ID,
      provider: "posthog",
      config: baseConfig,
    });

    await db.delete(customer).where(eq(customer.id, CUSTOMER_ID));

    const remaining = await db.select().from(customerIntegration);
    expect(remaining).toHaveLength(0);
  });
});
