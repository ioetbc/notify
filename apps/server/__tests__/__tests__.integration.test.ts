import { describe, it, expect, beforeEach, mock } from "bun:test";

// ── Mock: drizzle-orm operators (no-op for mock db) ─────────────
mock.module("drizzle-orm", () => ({
  eq: (...a: any[]) => a,
  and: (...a: any[]) => a,
  inArray: (...a: any[]) => a,
}));

// ── Mock state ──────────────────────────────────────────────────
let selectResult: any[] = [];
let deleteResults: any[][] = [];
let deleteCallCount = 0;
let updateCallCount = 0;

function makeChain(getResult: () => any) {
  const c: Record<string, any> = {};
  for (const m of [
    "select", "from", "where", "delete", "update",
    "set", "returning", "insert", "values",
  ]) {
    c[m] = () => c;
  }
  c.then = (resolve: any) => resolve(getResult());
  return c;
}

// ── Mock: db ────────────────────────────────────────────────────
const col = (n: string) => ({ _col: n });

const mockCustomerEventDefinition = {
  id: col("ced.id"),
  customerId: col("ced.customerId"),
  source: col("ced.source"),
};

const mockWorkflow = {
  customerId: col("wf.customerId"),
  triggerEventDefinitionId: col("wf.triggerEventDefinitionId"),
};

const mockEvent = {
  id: col("evt.id"),
  customerId: col("evt.customerId"),
  source: col("evt.source"),
};

mock.module("../db", () => ({
  db: {
    select: () => makeChain(() => selectResult),
    delete: () => {
      const idx = deleteCallCount++;
      return makeChain(() => deleteResults[idx] ?? []);
    },
    update: () => {
      updateCallCount++;
      return makeChain(() => undefined);
    },
    query: {
      posthogIntegration: { findFirst: mock<any>() },
    },
  },
  customerEventDefinition: mockCustomerEventDefinition,
  workflow: mockWorkflow,
  event: mockEvent,
  posthogIntegration: { customerId: col("phi.customerId") },
}));

// ── Import service under test (after mocks) ─────────────────────
import { purgePosthogData } from "../services/integration";

// ── Tests ───────────────────────────────────────────────────────

describe("purgePosthogData", () => {
  beforeEach(() => {
    selectResult = [];
    deleteResults = [];
    deleteCallCount = 0;
    updateCallCount = 0;
  });

  it("deletes events and definitions, returns counts", async () => {
    selectResult = [{ id: "def-1" }, { id: "def-2" }];
    deleteResults = [
      [{ id: "evt-1" }, { id: "evt-2" }, { id: "evt-3" }],
      [{ id: "def-1" }, { id: "def-2" }],
    ];

    const result = await purgePosthogData("cust-1");

    expect(result.events_deleted).toBe(3);
    expect(result.definitions_deleted).toBe(2);
  });

  it("returns zero counts when no posthog data exists", async () => {
    selectResult = [];
    deleteResults = [[]];

    const result = await purgePosthogData("cust-1");

    expect(result.events_deleted).toBe(0);
    expect(result.definitions_deleted).toBe(0);
  });

  it("skips workflow FK update and definition delete when no definitions exist", async () => {
    selectResult = [];
    deleteResults = [[]];

    await purgePosthogData("cust-1");

    expect(deleteCallCount).toBe(1);
    expect(updateCallCount).toBe(0);
  });

  it("nulls workflow FKs before deleting definitions", async () => {
    selectResult = [{ id: "def-1" }];
    deleteResults = [
      [{ id: "evt-1" }],
      [{ id: "def-1" }],
    ];

    const result = await purgePosthogData("cust-1");

    expect(updateCallCount).toBe(1);
    expect(deleteCallCount).toBe(2);
    expect(result.events_deleted).toBe(1);
    expect(result.definitions_deleted).toBe(1);
  });

  it("handles definitions with no matching events", async () => {
    selectResult = [{ id: "def-1" }];
    deleteResults = [
      [],
      [{ id: "def-1" }],
    ];

    const result = await purgePosthogData("cust-1");

    expect(result.events_deleted).toBe(0);
    expect(result.definitions_deleted).toBe(1);
    expect(updateCallCount).toBe(1);
  });
});
