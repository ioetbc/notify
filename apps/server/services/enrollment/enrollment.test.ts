import { describe, it, expect, beforeEach } from "bun:test";
import { createTestDb, type TestDb } from "../../test/db";
import { EnrollmentWalker, type StepEvent } from "./enrollment";
import {
  customer,
  user,
  workflow,
  step,
  stepEdge,
  workflowEnrollment,
  communicationLog,
  dispatch,
  pushToken,
} from "../../db/schema";
import type { SendConfig, StepConfig } from "../../db/schema";
import { eq, sql } from "drizzle-orm";

// ── Helpers ─────────────────────────────────────────────────────────────

type SeedStep = {
  id: string;
  type: "send" | "branch" | "filter" | "wait" | "exit";
  config: StepConfig;
};

type SeedEdge = {
  id: string;
  source: string;
  target: string;
  handle: boolean | null;
};

async function seedWorkflow(
  db: TestDb,
  opts: {
    steps: SeedStep[];
    edges?: SeedEdge[];
    userAttributes?: Record<string, string | number | boolean>;
    enrollmentId?: string;
    currentStepId?: string;
    processAt?: Date;
  }
) {
  const customerId = "00000000-0000-0000-0000-000000000001";
  const userId = "00000000-0000-0000-0000-000000000002";
  const workflowId = "00000000-0000-0000-0000-000000000003";
  const enrollmentId = opts.enrollmentId ?? "00000000-0000-0000-0000-000000000004";

  await db.insert(customer).values({
    id: customerId,
    email: `test-${enrollmentId}@example.com`,
    name: "Test Customer",
  });

  await db.insert(user).values({
    id: userId,
    customerId,
    externalId: `ext-${enrollmentId}`,
    attributes: opts.userAttributes ?? {},
  });

  await db.insert(workflow).values({
    id: workflowId,
    customerId,
    name: "Test Workflow",
    triggerType: "system",
    triggerEvent: "test",
    status: "active",
  });

  for (const s of opts.steps) {
    await db.insert(step).values({
      id: s.id,
      workflowId,
      type: s.type,
      config: s.config,
    });
  }

  for (const e of opts.edges ?? []) {
    await db.insert(stepEdge).values({
      id: e.id,
      workflowId,
      source: e.source,
      target: e.target,
      handle: e.handle,
    });
  }

  await db.insert(workflowEnrollment).values({
    id: enrollmentId,
    userId,
    workflowId,
    currentStepId: opts.currentStepId ?? opts.steps[0]?.id ?? null,
    status: "active",
    processAt: opts.processAt ?? new Date(),
  });

  return { customerId, userId, workflowId, enrollmentId };
}

// ── Test setup ──────────────────────────────────────────────────────────

let db: TestDb;
let events: StepEvent[];
let sendCalls: { userId: string; enrollmentId: string; stepId: string; config: SendConfig }[];

function createWalker() {
  return new EnrollmentWalker({
    db,
    onSend: async (payload) => { sendCalls.push(payload); },
    observe: (event) => { events.push(event); },
  });
}

beforeEach(async () => {
  ({ db } = await createTestDb());
  events = [];
  sendCalls = [];
});

describe("send step", () => {
  it("completes when send is the last step in the workflow", async () => {
    const { enrollmentId } = await seedWorkflow(db, {
      steps: [
        { id: "00000000-0000-0000-0000-000000000010", type: "send", config: { title: "Your order shipped", body: "Track it here" } },
      ],
    });

    const walker = createWalker();
    await walker.processEnrollment(enrollmentId);

    const logs = await db.select().from(communicationLog).where(eq(communicationLog.enrollmentId, enrollmentId));
    expect(logs).toHaveLength(1);
    expect(logs[0].config).toEqual({ title: "Your order shipped", body: "Track it here" });

    expect(sendCalls).toHaveLength(1);
    expect(sendCalls[0].config).toEqual({ title: "Your order shipped", body: "Track it here" });

    const [enrollment] = await db.select().from(workflowEnrollment).where(eq(workflowEnrollment.id, enrollmentId));
    expect(enrollment.status).toBe("completed");
    expect(enrollment.currentStepId).toBeNull();
  });
});

describe("branch step", () => {
  it("follows true edge when user plan = pro", async () => {
    const { enrollmentId } = await seedWorkflow(db, {
      steps: [
        { id: "00000000-0000-0000-0000-000000000010", type: "branch", config: { user_column: "plan", operator: "=", compare_value: "pro" } },
        { id: "00000000-0000-0000-0000-000000000011", type: "send", config: { title: "Welcome to Pro!", body: "Enjoy your benefits" } },
        { id: "00000000-0000-0000-0000-000000000012", type: "exit", config: {} },
      ],
      edges: [
        { id: "00000000-0000-0000-0000-0000000000e1", source: "00000000-0000-0000-0000-000000000010", target: "00000000-0000-0000-0000-000000000011", handle: true },
        { id: "00000000-0000-0000-0000-0000000000e2", source: "00000000-0000-0000-0000-000000000010", target: "00000000-0000-0000-0000-000000000012", handle: false },
      ],
      userAttributes: { plan: "pro" },
    });

    const walker = createWalker();
    await walker.processEnrollment(enrollmentId);

    const [enrollment] = await db.select().from(workflowEnrollment).where(eq(workflowEnrollment.id, enrollmentId));
    expect(enrollment.status).toBe("completed");

    const logs = await db.select().from(communicationLog).where(eq(communicationLog.enrollmentId, enrollmentId));
    expect(logs).toHaveLength(1);
    expect(logs[0].config).toEqual({ title: "Welcome to Pro!", body: "Enjoy your benefits" });
  });

  it("follows false edge when user plan does not match", async () => {
    const { enrollmentId } = await seedWorkflow(db, {
      steps: [
        { id: "00000000-0000-0000-0000-000000000010", type: "branch", config: { user_column: "plan", operator: "=", compare_value: "pro" } },
        { id: "00000000-0000-0000-0000-000000000011", type: "exit", config: {} },
        { id: "00000000-0000-0000-0000-000000000012", type: "send", config: { title: "Upgrade to Pro", body: "Get more" } },
      ],
      edges: [
        { id: "00000000-0000-0000-0000-0000000000e1", source: "00000000-0000-0000-0000-000000000010", target: "00000000-0000-0000-0000-000000000011", handle: true },
        { id: "00000000-0000-0000-0000-0000000000e2", source: "00000000-0000-0000-0000-000000000010", target: "00000000-0000-0000-0000-000000000012", handle: false },
      ],
      userAttributes: { plan: "free" },
    });

    const walker = createWalker();
    await walker.processEnrollment(enrollmentId);

    const [enrollment] = await db.select().from(workflowEnrollment).where(eq(workflowEnrollment.id, enrollmentId));
    expect(enrollment.status).toBe("completed");

    const logs = await db.select().from(communicationLog).where(eq(communicationLog.enrollmentId, enrollmentId));
    expect(logs).toHaveLength(1);
    expect(logs[0].config).toEqual({ title: "Upgrade to Pro", body: "Get more" });
  });

  it("exits when the branched attribute does not exist on the user", async () => {
    const { enrollmentId } = await seedWorkflow(db, {
      steps: [
        { id: "00000000-0000-0000-0000-000000000010", type: "branch", config: { user_column: "plan", operator: "=", compare_value: "pro" } },
        { id: "00000000-0000-0000-0000-000000000011", type: "send", config: { title: "Pro!", body: "body" } },
      ],
      edges: [
        { id: "00000000-0000-0000-0000-0000000000e1", source: "00000000-0000-0000-0000-000000000010", target: "00000000-0000-0000-0000-000000000011", handle: true },
      ],
      userAttributes: {},
    });

    const walker = createWalker();
    await walker.processEnrollment(enrollmentId);

    const logs = await db.select().from(communicationLog).where(eq(communicationLog.enrollmentId, enrollmentId));
    expect(logs).toHaveLength(0);

    const [enrollment] = await db.select().from(workflowEnrollment).where(eq(workflowEnrollment.id, enrollmentId));
    expect(enrollment.status).toBe("exited");
  });

  it("follows true edge with != operator", async () => {
    const { enrollmentId } = await seedWorkflow(db, {
      steps: [
        { id: "00000000-0000-0000-0000-000000000010", type: "branch", config: { user_column: "plan", operator: "!=", compare_value: "pro" } },
        { id: "00000000-0000-0000-0000-000000000011", type: "send", config: { title: "Not a pro user", body: "body" } },
        { id: "00000000-0000-0000-0000-000000000012", type: "exit", config: {} },
      ],
      edges: [
        { id: "00000000-0000-0000-0000-0000000000e1", source: "00000000-0000-0000-0000-000000000010", target: "00000000-0000-0000-0000-000000000011", handle: true },
        { id: "00000000-0000-0000-0000-0000000000e2", source: "00000000-0000-0000-0000-000000000010", target: "00000000-0000-0000-0000-000000000012", handle: false },
      ],
      userAttributes: { plan: "free" },
    });

    const walker = createWalker();
    await walker.processEnrollment(enrollmentId);

    const logs = await db.select().from(communicationLog).where(eq(communicationLog.enrollmentId, enrollmentId));
    expect(logs).toHaveLength(1);
    expect(logs[0].config).toEqual({ title: "Not a pro user", body: "body" });

    const [enrollment] = await db.select().from(workflowEnrollment).where(eq(workflowEnrollment.id, enrollmentId));
    expect(enrollment.status).toBe("completed");
  });

  it("follows true edge with exists operator when key is present", async () => {
    const { enrollmentId } = await seedWorkflow(db, {
      steps: [
        { id: "00000000-0000-0000-0000-000000000010", type: "branch", config: { user_column: "plan", operator: "exists" } },
        { id: "00000000-0000-0000-0000-000000000011", type: "send", config: { title: "Has a plan", body: "body" } },
      ],
      edges: [
        { id: "00000000-0000-0000-0000-0000000000e1", source: "00000000-0000-0000-0000-000000000010", target: "00000000-0000-0000-0000-000000000011", handle: true },
      ],
      userAttributes: { plan: "pro" },
    });

    const walker = createWalker();
    await walker.processEnrollment(enrollmentId);

    const logs = await db.select().from(communicationLog).where(eq(communicationLog.enrollmentId, enrollmentId));
    expect(logs).toHaveLength(1);

    const [enrollment] = await db.select().from(workflowEnrollment).where(eq(workflowEnrollment.id, enrollmentId));
    expect(enrollment.status).toBe("completed");
  });

  it("follows false edge with not_exists operator when key is present", async () => {
    const { enrollmentId } = await seedWorkflow(db, {
      steps: [
        { id: "00000000-0000-0000-0000-000000000010", type: "branch", config: { user_column: "plan", operator: "not_exists" } },
        { id: "00000000-0000-0000-0000-000000000011", type: "exit", config: {} },
        { id: "00000000-0000-0000-0000-000000000012", type: "send", config: { title: "Has plan", body: "body" } },
      ],
      edges: [
        { id: "00000000-0000-0000-0000-0000000000e1", source: "00000000-0000-0000-0000-000000000010", target: "00000000-0000-0000-0000-000000000011", handle: true },
        { id: "00000000-0000-0000-0000-0000000000e2", source: "00000000-0000-0000-0000-000000000010", target: "00000000-0000-0000-0000-000000000012", handle: false },
      ],
      userAttributes: { plan: "pro" },
    });

    const walker = createWalker();
    await walker.processEnrollment(enrollmentId);

    const logs = await db.select().from(communicationLog).where(eq(communicationLog.enrollmentId, enrollmentId));
    expect(logs).toHaveLength(1);
    expect(logs[0].config).toEqual({ title: "Has plan", body: "body" });

    const [enrollment] = await db.select().from(workflowEnrollment).where(eq(workflowEnrollment.id, enrollmentId));
    expect(enrollment.status).toBe("completed");
  });
});

// ── filter ──────────────────────────────────────────────────────────────

describe("filter step", () => {
  it("continues to send when country = UK", async () => {
    const { enrollmentId } = await seedWorkflow(db, {
      steps: [
        { id: "00000000-0000-0000-0000-000000000010", type: "filter", config: { attribute_key: "country", operator: "=", compare_value: "UK" } },
        { id: "00000000-0000-0000-0000-000000000011", type: "send", config: { title: "UK offer", body: "body" } },
      ],
      edges: [
        { id: "00000000-0000-0000-0000-0000000000e1", source: "00000000-0000-0000-0000-000000000010", target: "00000000-0000-0000-0000-000000000011", handle: null },
      ],
      userAttributes: { country: "UK" },
    });

    const walker = createWalker();
    await walker.processEnrollment(enrollmentId);

    const logs = await db.select().from(communicationLog).where(eq(communicationLog.enrollmentId, enrollmentId));
    expect(logs).toHaveLength(1);
    expect(logs[0].config).toEqual({ title: "UK offer", body: "body" });

    const [enrollment] = await db.select().from(workflowEnrollment).where(eq(workflowEnrollment.id, enrollmentId));
    expect(enrollment.status).toBe("completed");
  });

  it("exits when country does not match filter", async () => {
    const { enrollmentId } = await seedWorkflow(db, {
      steps: [
        { id: "00000000-0000-0000-0000-000000000010", type: "filter", config: { attribute_key: "country", operator: "=", compare_value: "UK" } },
        { id: "00000000-0000-0000-0000-000000000011", type: "send", config: { title: "UK offer", body: "body" } },
      ],
      edges: [
        { id: "00000000-0000-0000-0000-0000000000e1", source: "00000000-0000-0000-0000-000000000010", target: "00000000-0000-0000-0000-000000000011", handle: null },
      ],
      userAttributes: { country: "US" },
    });

    const walker = createWalker();
    await walker.processEnrollment(enrollmentId);

    const logs = await db.select().from(communicationLog).where(eq(communicationLog.enrollmentId, enrollmentId));
    expect(logs).toHaveLength(0);

    const [enrollment] = await db.select().from(workflowEnrollment).where(eq(workflowEnrollment.id, enrollmentId));
    expect(enrollment.status).toBe("exited");
  });

  it("exits when the filtered attribute does not exist on the user", async () => {
    const { enrollmentId } = await seedWorkflow(db, {
      steps: [
        { id: "00000000-0000-0000-0000-000000000010", type: "filter", config: { attribute_key: "country", operator: "=", compare_value: "UK" } },
        { id: "00000000-0000-0000-0000-000000000011", type: "send", config: { title: "UK offer", body: "body" } },
      ],
      edges: [
        { id: "00000000-0000-0000-0000-0000000000e1", source: "00000000-0000-0000-0000-000000000010", target: "00000000-0000-0000-0000-000000000011", handle: null },
      ],
      userAttributes: {},
    });

    const walker = createWalker();
    await walker.processEnrollment(enrollmentId);

    const logs = await db.select().from(communicationLog).where(eq(communicationLog.enrollmentId, enrollmentId));
    expect(logs).toHaveLength(0);

    const [enrollment] = await db.select().from(workflowEnrollment).where(eq(workflowEnrollment.id, enrollmentId));
    expect(enrollment.status).toBe("exited");
  });

  it("continues when age > 18", async () => {
    const { enrollmentId } = await seedWorkflow(db, {
      steps: [
        { id: "00000000-0000-0000-0000-000000000010", type: "filter", config: { attribute_key: "age", operator: ">", compare_value: 18 } },
        { id: "00000000-0000-0000-0000-000000000011", type: "send", config: { title: "Adult content", body: "body" } },
      ],
      edges: [
        { id: "00000000-0000-0000-0000-0000000000e1", source: "00000000-0000-0000-0000-000000000010", target: "00000000-0000-0000-0000-000000000011", handle: null },
      ],
      userAttributes: { age: 25 },
    });

    const walker = createWalker();
    await walker.processEnrollment(enrollmentId);

    const logs = await db.select().from(communicationLog).where(eq(communicationLog.enrollmentId, enrollmentId));
    expect(logs).toHaveLength(1);

    const [enrollment] = await db.select().from(workflowEnrollment).where(eq(workflowEnrollment.id, enrollmentId));
    expect(enrollment.status).toBe("completed");
  });

  it("exits when age is not < 18", async () => {
    const { enrollmentId } = await seedWorkflow(db, {
      steps: [
        { id: "00000000-0000-0000-0000-000000000010", type: "filter", config: { attribute_key: "age", operator: "<", compare_value: 18 } },
        { id: "00000000-0000-0000-0000-000000000011", type: "send", config: { title: "Minor content", body: "body" } },
      ],
      edges: [
        { id: "00000000-0000-0000-0000-0000000000e1", source: "00000000-0000-0000-0000-000000000010", target: "00000000-0000-0000-0000-000000000011", handle: null },
      ],
      userAttributes: { age: 25 },
    });

    const walker = createWalker();
    await walker.processEnrollment(enrollmentId);

    const logs = await db.select().from(communicationLog).where(eq(communicationLog.enrollmentId, enrollmentId));
    expect(logs).toHaveLength(0);

    const [enrollment] = await db.select().from(workflowEnrollment).where(eq(workflowEnrollment.id, enrollmentId));
    expect(enrollment.status).toBe("exited");
  });

  it("continues when country != UK", async () => {
    const { enrollmentId } = await seedWorkflow(db, {
      steps: [
        { id: "00000000-0000-0000-0000-000000000010", type: "filter", config: { attribute_key: "country", operator: "!=", compare_value: "UK" } },
        { id: "00000000-0000-0000-0000-000000000011", type: "send", config: { title: "Non-UK offer", body: "body" } },
      ],
      edges: [
        { id: "00000000-0000-0000-0000-0000000000e1", source: "00000000-0000-0000-0000-000000000010", target: "00000000-0000-0000-0000-000000000011", handle: null },
      ],
      userAttributes: { country: "US" },
    });

    const walker = createWalker();
    await walker.processEnrollment(enrollmentId);

    const logs = await db.select().from(communicationLog).where(eq(communicationLog.enrollmentId, enrollmentId));
    expect(logs).toHaveLength(1);

    const [enrollment] = await db.select().from(workflowEnrollment).where(eq(workflowEnrollment.id, enrollmentId));
    expect(enrollment.status).toBe("completed");
  });
});

// ── wait ────────────────────────────────────────────────────────────────

describe("wait step", () => {
  it("pauses enrollment and schedules next step 24 hours from now", async () => {
    const { enrollmentId } = await seedWorkflow(db, {
      steps: [
        { id: "00000000-0000-0000-0000-000000000010", type: "wait", config: { hours: 24 } },
        { id: "00000000-0000-0000-0000-000000000011", type: "send", config: { title: "Follow up", body: "body" } },
      ],
      edges: [
        { id: "00000000-0000-0000-0000-0000000000e1", source: "00000000-0000-0000-0000-000000000010", target: "00000000-0000-0000-0000-000000000011", handle: null },
      ],
    });

    const before = new Date();
    const walker = createWalker();
    await walker.processEnrollment(enrollmentId);

    const [enrollment] = await db.select().from(workflowEnrollment).where(eq(workflowEnrollment.id, enrollmentId));
    expect(enrollment.status).toBe("active");
    expect(enrollment.currentStepId).toBe("00000000-0000-0000-0000-000000000011");
    const hoursFromNow = (enrollment.processAt!.getTime() - before.getTime()) / (1000 * 60 * 60);
    expect(hoursFromNow).toBeGreaterThan(23.9);
    expect(hoursFromNow).toBeLessThan(24.1);

    // No communication log for wait
    const logs = await db.select().from(communicationLog).where(eq(communicationLog.enrollmentId, enrollmentId));
    expect(logs).toHaveLength(0);
  });

  it("completes when wait is the last step in the workflow", async () => {
    const { enrollmentId } = await seedWorkflow(db, {
      steps: [
        { id: "00000000-0000-0000-0000-000000000010", type: "wait", config: { hours: 24 } },
      ],
    });

    const walker = createWalker();
    await walker.processEnrollment(enrollmentId);

    const [enrollment] = await db.select().from(workflowEnrollment).where(eq(workflowEnrollment.id, enrollmentId));
    expect(enrollment.status).toBe("completed");
  });
});

// ── exit ────────────────────────────────────────────────────────────────

describe("exit step", () => {
  it("exits the enrollment immediately", async () => {
    const { enrollmentId } = await seedWorkflow(db, {
      steps: [
        { id: "00000000-0000-0000-0000-000000000010", type: "exit", config: {} },
      ],
    });

    const walker = createWalker();
    await walker.processEnrollment(enrollmentId);

    const [enrollment] = await db.select().from(workflowEnrollment).where(eq(workflowEnrollment.id, enrollmentId));
    expect(enrollment.status).toBe("exited");

    const logs = await db.select().from(communicationLog).where(eq(communicationLog.enrollmentId, enrollmentId));
    expect(logs).toHaveLength(0);
  });
});

// ── multi-step workflows ────────────────────────────────────────────────

describe("multi-step workflows", () => {
  it("filter → send: filters insured users then sends notification", async () => {
    const { enrollmentId } = await seedWorkflow(db, {
      steps: [
        { id: "00000000-0000-0000-0000-000000000010", type: "filter", config: { attribute_key: "is_insured", operator: "=", compare_value: "true" } },
        { id: "00000000-0000-0000-0000-000000000011", type: "send", config: { title: "You are insured", body: "Congrats" } },
      ],
      edges: [
        { id: "00000000-0000-0000-0000-0000000000e1", source: "00000000-0000-0000-0000-000000000010", target: "00000000-0000-0000-0000-000000000011", handle: null },
      ],
      userAttributes: { is_insured: "true" },
    });

    const walker = createWalker();
    await walker.processEnrollment(enrollmentId);

    const logs = await db.select().from(communicationLog).where(eq(communicationLog.enrollmentId, enrollmentId));
    expect(logs).toHaveLength(1);
    expect(logs[0].config).toEqual({ title: "You are insured", body: "Congrats" });

    const [enrollment] = await db.select().from(workflowEnrollment).where(eq(workflowEnrollment.id, enrollmentId));
    expect(enrollment.status).toBe("completed");
  });

  it("send → wait → send: sends welcome, waits 12h, then pauses", async () => {
    const { enrollmentId } = await seedWorkflow(db, {
      steps: [
        { id: "00000000-0000-0000-0000-000000000010", type: "send", config: { title: "Welcome!", body: "Thanks for signing up" } },
        { id: "00000000-0000-0000-0000-000000000011", type: "wait", config: { hours: 12 } },
        { id: "00000000-0000-0000-0000-000000000012", type: "send", config: { title: "How are you finding things?", body: "Let us know" } },
      ],
      edges: [
        { id: "00000000-0000-0000-0000-0000000000e1", source: "00000000-0000-0000-0000-000000000010", target: "00000000-0000-0000-0000-000000000011", handle: null },
        { id: "00000000-0000-0000-0000-0000000000e2", source: "00000000-0000-0000-0000-000000000011", target: "00000000-0000-0000-0000-000000000012", handle: null },
      ],
    });

    const walker = createWalker();
    await walker.processEnrollment(enrollmentId);

    // First send should have been logged
    const logs = await db.select().from(communicationLog).where(eq(communicationLog.enrollmentId, enrollmentId));
    expect(logs).toHaveLength(1);
    expect(logs[0].config).toEqual({ title: "Welcome!", body: "Thanks for signing up" });

    // Enrollment should be paused at step-3 (the second send)
    const [enrollment] = await db.select().from(workflowEnrollment).where(eq(workflowEnrollment.id, enrollmentId));
    expect(enrollment.status).toBe("active");
    expect(enrollment.currentStepId).toBe("00000000-0000-0000-0000-000000000012");
    expect(enrollment.processAt).toBeInstanceOf(Date);
  });

  it("returns without error when user not found", async () => {
    const { enrollmentId } = await seedWorkflow(db, {
      steps: [
        { id: "00000000-0000-0000-0000-000000000010", type: "send", config: { title: "X", body: "X" } },
      ],
    });

    // Temporarily disable FK triggers so we can point enrollment to a non-existent user
    await db.execute(sql`ALTER TABLE workflow_enrollment DISABLE TRIGGER ALL`);
    await db.execute(
      sql`UPDATE workflow_enrollment SET user_id = 'ff000000-0000-0000-0000-ffffffffffff' WHERE id = ${enrollmentId}`
    );
    await db.execute(sql`ALTER TABLE workflow_enrollment ENABLE TRIGGER ALL`);

    const walker = createWalker();
    await walker.processEnrollment(enrollmentId);

    const logs = await db.select().from(communicationLog);
    expect(logs).toHaveLength(0);

    expect(events.some((e) => e.kind === "exited" && e.reason === "missing_user")).toBe(true);
  });

  it("completes when currentStepId points to a step that no longer exists", async () => {
    const { enrollmentId } = await seedWorkflow(db, {
      steps: [
        { id: "00000000-0000-0000-0000-000000000010", type: "send", config: { title: "X", body: "X" } },
      ],
      currentStepId: "00000000-0000-0000-0000-000000000010",
    });

    // Delete the step to simulate a missing step
    await db.delete(step).where(eq(step.id, "00000000-0000-0000-0000-000000000010"));
    // Also clear the FK reference
    await db.update(workflowEnrollment).set({ currentStepId: null }).where(eq(workflowEnrollment.id, enrollmentId));

    const walker = createWalker();
    await walker.processEnrollment(enrollmentId);

    const [enrollment] = await db.select().from(workflowEnrollment).where(eq(workflowEnrollment.id, enrollmentId));
    expect(enrollment.status).toBe("completed");
  });
});

// ── config validation ───────────────────────────────────────────────────

describe("config validation", () => {
  it("throws on malformed send config", async () => {
    const { enrollmentId } = await seedWorkflow(db, {
      steps: [
        { id: "00000000-0000-0000-0000-000000000010", type: "send", config: { bad: "data" } as any },
      ],
    });

    const walker = createWalker();
    await expect(walker.processEnrollment(enrollmentId)).rejects.toThrow();
  });
});

// ── processReadyEnrollments ─────────────────────────────────────────────

describe("processReadyEnrollments", () => {
  it("returns zeros when no enrollments are ready", async () => {
    const walker = createWalker();
    const result = await walker.processReadyEnrollments();

    expect(result).toEqual({ processed: 0, failed: 0, results: [] });
  });

  it("processes only enrollments with processAt <= now", async () => {
    // Seed two enrollments: one ready, one in the future
    const customerId = "a0000000-0000-0000-0000-000000000002";
    const userId = "d0000000-0000-0000-0000-000000000002";
    const workflowId = "b0000000-0000-0000-0000-000000000002";
    const stepId = "e0000000-0000-0000-0000-000000000002";

    await db.insert(customer).values({ id: customerId, email: "batch@example.com", name: "Batch" });
    await db.insert(user).values({ id: userId, customerId, externalId: "batch", attributes: {} });
    await db.insert(workflow).values({ id: workflowId, customerId, name: "W", triggerType: "system", triggerEvent: "t", status: "active" });
    await db.insert(step).values({ id: stepId, workflowId, type: "send", config: { title: "Hi", body: "body" } });

    const readyId = "f0000000-0000-0000-0000-000000000001";
    const futureId = "f0000000-0000-0000-0000-000000000002";

    await db.insert(workflowEnrollment).values([
      { id: readyId, userId, workflowId, currentStepId: stepId, status: "active" as const, processAt: new Date(Date.now() - 1000) },
      { id: futureId, userId, workflowId, currentStepId: stepId, status: "active" as const, processAt: new Date(Date.now() + 60_000) },
    ]);

    const walker = createWalker();
    const result = await walker.processReadyEnrollments();

    expect(result.processed).toBe(1);
    expect(result.failed).toBe(0);

    // Ready one should be completed
    const [ready] = await db.select().from(workflowEnrollment).where(eq(workflowEnrollment.id, readyId));
    expect(ready.status).toBe("completed");

    // Future one should still be active
    const [future] = await db.select().from(workflowEnrollment).where(eq(workflowEnrollment.id, futureId));
    expect(future.status).toBe("active");
  });
});

// ── idempotency ─────────────────────────────────────────────────────────

describe("send idempotency", () => {
  it("happy path: claims, calls onSend once, marks row sent with tickets", async () => {
    const stepId = "00000000-0000-0000-0000-000000000010";
    const { enrollmentId } = await seedWorkflow(db, {
      steps: [
        { id: stepId, type: "send", config: { title: "Hi", body: "body" } },
      ],
    });

    const sendResult = {
      provider: "expo" as const,
      dispatches: [
        { token: "ExponentPushToken[abc]", ackId: "ticket-1" },
      ],
    };
    const walker = new EnrollmentWalker({
      db,
      onSend: async (payload) => {
        sendCalls.push(payload);
        return sendResult;
      },
      observe: (event) => { events.push(event); },
    });

    await walker.processEnrollment(enrollmentId);

    expect(sendCalls).toHaveLength(1);

    const logs = await db.select().from(communicationLog).where(eq(communicationLog.enrollmentId, enrollmentId));
    expect(logs).toHaveLength(1);
    expect(logs[0].status).toBe("dispatched");
    expect(logs[0].sentAt).toBeInstanceOf(Date);
    expect(logs[0].error).toBeNull();

    const dispatches = await db.select().from(dispatch).where(eq(dispatch.communicationLogId, logs[0].id));
    expect(dispatches).toHaveLength(1);
    expect(dispatches[0].provider).toBe("expo");
    expect(dispatches[0].token).toBe("ExponentPushToken[abc]");
    expect(dispatches[0].status).toBe("dispatched");
    expect(dispatches[0].ackId).toBe("ticket-1");
    expect(dispatches[0].error).toBeNull();
  });

  it("pre-flight ack error → dispatch row written as undelivered, dead token deleted", async () => {
    const stepId = "00000000-0000-0000-0000-000000000010";
    const { enrollmentId, userId } = await seedWorkflow(db, {
      steps: [{ id: stepId, type: "send", config: { title: "Hi", body: "body" } }],
    });

    const goodToken = "ExponentPushToken[good]";
    const badToken = "ExponentPushToken[bad]";
    await db.insert(pushToken).values([
      { userId, token: goodToken },
      { userId, token: badToken },
    ]);

    const walker = new EnrollmentWalker({
      db,
      onSend: async (payload) => {
        sendCalls.push(payload);
        return {
          provider: "expo" as const,
          dispatches: [
            { token: goodToken, ackId: "ticket-1" },
            {
              token: badToken,
              error: {
                message: "gone",
                details: { error: "DeviceNotRegistered" },
              },
            },
          ],
        };
      },
      observe: (event) => { events.push(event); },
    });

    await walker.processEnrollment(enrollmentId);

    const [log] = await db.select().from(communicationLog).where(eq(communicationLog.enrollmentId, enrollmentId));
    expect(log.status).toBe("dispatched");

    const dispatches = await db.select().from(dispatch).where(eq(dispatch.communicationLogId, log.id));
    expect(dispatches).toHaveLength(2);

    const byToken = Object.fromEntries(dispatches.map((d) => [d.token, d]));
    expect(byToken[goodToken].status).toBe("dispatched");
    expect(byToken[badToken].status).toBe("undelivered");

    const remaining = await db.select().from(pushToken).where(eq(pushToken.userId, userId));
    expect(remaining.map((t) => t.token)).toEqual([goodToken]);
  });

  it("zero tokens — log row marked dispatched, no dispatch rows", async () => {
    const stepId = "00000000-0000-0000-0000-000000000010";
    const { enrollmentId } = await seedWorkflow(db, {
      steps: [{ id: stepId, type: "send", config: { title: "Hi", body: "body" } }],
    });

    const walker = new EnrollmentWalker({
      db,
      onSend: async (payload) => { sendCalls.push(payload); return undefined; },
      observe: (event) => { events.push(event); },
    });

    await walker.processEnrollment(enrollmentId);

    const [log] = await db.select().from(communicationLog).where(eq(communicationLog.enrollmentId, enrollmentId));
    expect(log.status).toBe("dispatched");
    expect(log.sentAt).toBeInstanceOf(Date);

    const dispatches = await db.select().from(dispatch).where(eq(dispatch.communicationLogId, log.id));
    expect(dispatches).toHaveLength(0);
  });

  it("retry path: pre-existing log row makes processEnrollment skip onSend", async () => {
    const stepId = "00000000-0000-0000-0000-000000000010";
    const { enrollmentId, userId } = await seedWorkflow(db, {
      steps: [
        { id: stepId, type: "send", config: { title: "Hi", body: "body" } },
      ],
    });

    // Pre-seed a row as if a prior delivery already claimed (and sent) this step
    await db.insert(communicationLog).values({
      enrollmentId,
      stepId,
      userId,
      config: { title: "Hi", body: "body" },
      status: "dispatched",
      sentAt: new Date(),
    });

    const walker = createWalker();
    await walker.processEnrollment(enrollmentId);

    // onSend should not have been called a second time
    expect(sendCalls).toHaveLength(0);

    // Still only one row (unique constraint + on conflict do nothing)
    const logs = await db.select().from(communicationLog).where(eq(communicationLog.enrollmentId, enrollmentId));
    expect(logs).toHaveLength(1);

    // Walker still advanced past the send and completed
    const [enrollment] = await db.select().from(workflowEnrollment).where(eq(workflowEnrollment.id, enrollmentId));
    expect(enrollment.status).toBe("completed");
    expect(enrollment.currentStepId).toBeNull();
  });

  it("failure path: onSend throws → row marked failed → second invocation skips onSend", async () => {
    const stepId = "00000000-0000-0000-0000-000000000010";
    const { enrollmentId } = await seedWorkflow(db, {
      steps: [
        { id: stepId, type: "send", config: { title: "Hi", body: "body" } },
      ],
    });

    let attempts = 0;
    const walker = new EnrollmentWalker({
      db,
      onSend: async (payload) => {
        attempts++;
        sendCalls.push(payload);
        throw new Error("expo down");
      },
      observe: (event) => { events.push(event); },
    });

    await expect(walker.processEnrollment(enrollmentId)).rejects.toThrow("expo down");
    expect(attempts).toBe(1);

    const logsAfterFail = await db.select().from(communicationLog).where(eq(communicationLog.enrollmentId, enrollmentId));
    expect(logsAfterFail).toHaveLength(1);
    expect(logsAfterFail[0].status).toBe("failed");
    expect(logsAfterFail[0].error).toBe("expo down");

    // Second invocation: onSend must not be called again (at-most-once)
    await walker.processEnrollment(enrollmentId);
    expect(attempts).toBe(1);

    const logsAfterRetry = await db.select().from(communicationLog).where(eq(communicationLog.enrollmentId, enrollmentId));
    expect(logsAfterRetry).toHaveLength(1);
    expect(logsAfterRetry[0].status).toBe("failed");

    // Walker advanced past the send on the retry
    const [enrollment] = await db.select().from(workflowEnrollment).where(eq(workflowEnrollment.id, enrollmentId));
    expect(enrollment.status).toBe("completed");
  });
});

// ── observe events ──────────────────────────────────────────────────────

describe("observe events", () => {
  it("emits stepped and completed events", async () => {
    const { enrollmentId } = await seedWorkflow(db, {
      steps: [
        { id: "00000000-0000-0000-0000-000000000010", type: "send", config: { title: "Hi", body: "body" } },
      ],
    });

    const walker = createWalker();
    await walker.processEnrollment(enrollmentId);

    expect(events.some((e) => e.kind === "stepped")).toBe(true);
    expect(events.some((e) => e.kind === "completed")).toBe(true);
  });

  it("emits waiting event for wait steps", async () => {
    const { enrollmentId } = await seedWorkflow(db, {
      steps: [
        { id: "00000000-0000-0000-0000-000000000010", type: "wait", config: { hours: 1 } },
        { id: "00000000-0000-0000-0000-000000000011", type: "send", config: { title: "Later", body: "body" } },
      ],
      edges: [
        { id: "00000000-0000-0000-0000-0000000000e1", source: "00000000-0000-0000-0000-000000000010", target: "00000000-0000-0000-0000-000000000011", handle: null },
      ],
    });

    const walker = createWalker();
    await walker.processEnrollment(enrollmentId);

    expect(events.some((e) => e.kind === "waiting")).toBe(true);
  });
});
