import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterAll,
  mock,
} from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb, resetTestDb, type TestDb } from "../test/db";
import { customer } from "../db/schema";
import type { PosthogIntegrationConfig } from "../db/schema";
import { create as createIntegration } from "../repository/integration";
import { createWebhookApp } from "../functions/posthog-webhook/handler";
import { computeSignature } from "../services/posthog-webhook/verify";

const CUSTOMER_ID = "00000000-0000-0000-0000-0000000000aa";
const SECRET = "test-webhook-secret";
const SECRET_B64 = Buffer.from(SECRET, "utf-8").toString("base64");

const baseConfig: PosthogIntegrationConfig = {
  personal_api_key_encrypted: "cGgtYWJj",
  project_id: "1",
  hog_function_id: null,
  webhook_secret_encrypted: SECRET_B64,
};

let db: TestDb;
let client: PGlite;
let trackEventCalls: Array<unknown[]>;
let trackEventReturn: unknown = { id: "evt-1" };

const mockTrackEvent = mock(async (...args: unknown[]) => {
  trackEventCalls.push(args);
  return trackEventReturn;
});

function buildApp() {
  return createWebhookApp({ db, trackEvent: mockTrackEvent as any });
}

async function seedCustomer(id = CUSTOMER_ID) {
  await db.insert(customer).values({
    id,
    email: `c-${id}@example.com`,
    name: "Test",
  });
}

async function seedIntegration(customerId = CUSTOMER_ID) {
  return createIntegration(db, {
    customerId,
    provider: "posthog",
    config: baseConfig,
  });
}

function makeRequest(opts: {
  customerId?: string;
  body: string;
  signature?: string | null;
  contentType?: string;
}) {
  const headers: Record<string, string> = {
    "Content-Type": opts.contentType ?? "application/json",
  };
  if (opts.signature !== null) {
    headers["X-Notify-Signature"] =
      opts.signature ?? computeSignature(SECRET, opts.body);
  }
  return new Request(
    `http://localhost/webhooks/posthog/${opts.customerId ?? CUSTOMER_ID}`,
    {
      method: "POST",
      headers,
      body: opts.body,
    }
  );
}

beforeAll(async () => {
  ({ db, client } = await createTestDb());
});

afterAll(async () => {
  await client.close();
});

beforeEach(async () => {
  await resetTestDb(client);
  trackEventCalls = [];
  trackEventReturn = { id: "evt-1" };
});

describe("posthog webhook handler", () => {
  it("happy path: matching signature triggers ingest, returns 202", async () => {
    await seedCustomer();
    await seedIntegration();

    const payload = {
      event: "purchase_completed",
      distinct_id: "user-ext-1",
      properties: { amount: 42 },
      timestamp: "2026-05-02T10:00:00.000Z",
      uuid: "01900000-0000-7000-8000-000000000001",
    };
    const body = JSON.stringify(payload);

    const res = await buildApp().fetch(makeRequest({ body }));

    expect(res.status).toBe(202);
    expect(trackEventCalls).toHaveLength(1);
    expect(trackEventCalls[0]).toEqual([
      CUSTOMER_ID,
      "user-ext-1",
      "purchase_completed",
      { amount: 42 },
      "2026-05-02T10:00:00.000Z",
    ]);
  });

  it("returns 404 when integration is missing", async () => {
    await seedCustomer();
    // no integration

    const body = JSON.stringify({ event: "x", distinct_id: "u" });
    const res = await buildApp().fetch(makeRequest({ body }));

    expect(res.status).toBe(404);
    expect(trackEventCalls).toHaveLength(0);
  });

  it("returns 401 on bad signature", async () => {
    await seedCustomer();
    await seedIntegration();

    const body = JSON.stringify({ event: "x", distinct_id: "u" });
    const goodSig = computeSignature(SECRET, body);
    const badSig = (goodSig[0] === "a" ? "b" : "a") + goodSig.slice(1);

    const res = await buildApp().fetch(makeRequest({ body, signature: badSig }));

    expect(res.status).toBe(401);
    expect(trackEventCalls).toHaveLength(0);
  });

  it("returns 401 when signature header is missing", async () => {
    await seedCustomer();
    await seedIntegration();

    const body = JSON.stringify({ event: "x", distinct_id: "u" });
    const res = await buildApp().fetch(makeRequest({ body, signature: null }));

    expect(res.status).toBe(401);
    expect(trackEventCalls).toHaveLength(0);
  });

  it("returns 400 on malformed JSON and does not call ingest", async () => {
    await seedCustomer();
    await seedIntegration();

    const body = "{not json";
    const res = await buildApp().fetch(makeRequest({ body }));

    expect(res.status).toBe(400);
    expect(trackEventCalls).toHaveLength(0);
  });

  it("returns 400 when distinct_id is missing", async () => {
    await seedCustomer();
    await seedIntegration();

    const body = JSON.stringify({ event: "x" });
    const res = await buildApp().fetch(makeRequest({ body }));

    expect(res.status).toBe(400);
    expect(trackEventCalls).toHaveLength(0);
  });

  it("returns 400 when event is missing", async () => {
    await seedCustomer();
    await seedIntegration();

    const body = JSON.stringify({ distinct_id: "u" });
    const res = await buildApp().fetch(makeRequest({ body }));

    expect(res.status).toBe(400);
    expect(trackEventCalls).toHaveLength(0);
  });

  it("returns 202 for unknown event names (ingest decides)", async () => {
    await seedCustomer();
    await seedIntegration();
    trackEventReturn = null; // simulate ingest finding no user / no workflows

    const body = JSON.stringify({
      event: "$pageview",
      distinct_id: "u",
    });
    const res = await buildApp().fetch(makeRequest({ body }));

    expect(res.status).toBe(202);
    expect(trackEventCalls).toHaveLength(1);
    expect((trackEventCalls[0] as any[])[2]).toBe("$pageview");
  });

  it("body re-stringification footgun: signature must match raw bytes", async () => {
    // PostHog sends the body exactly as-is; if we re-stringified after parsing
    // (e.g. via JSON.parse → JSON.stringify) the signature would mismatch
    // because key ordering / whitespace would differ. This test simulates a
    // body with key ordering and whitespace that JSON.stringify would change.
    await seedCustomer();
    await seedIntegration();

    const body = `{ "distinct_id":"u","event":"x" ,"properties":{"a":1}}`;
    const res = await buildApp().fetch(makeRequest({ body }));

    expect(res.status).toBe(202);
    expect(trackEventCalls).toHaveLength(1);
  });
});
