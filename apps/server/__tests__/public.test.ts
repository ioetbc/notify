import { describe, it, expect, beforeEach, mock } from "bun:test";

// ── Mock: repository/public ──────────────────────────────────────────
const mockFindUserByExternalId = mock<any>();
const mockCreateUser = mock<any>();
const mockUpdateUserAttributes = mock<any>();
const mockCreateEvent = mock<any>();
const mockEventDefinitionsRun = mock<any>();
const mockFindActiveWorkflowsByTriggerEvent = mock<any>();
const mockFindActiveWorkflowTriggers = mock<any>();
const mockCreateWorkflowEnrollment = mock<any>();

const trackPosthogEventDeps = {
  eventDefinitions: { run: mockEventDefinitionsRun },
};

mock.module("../repository/public", () => ({
  findUserByExternalId: mockFindUserByExternalId,
  createUser: mockCreateUser,
  updateUserAttributes: mockUpdateUserAttributes,
  createEvent: mockCreateEvent,
  findActiveWorkflowsByTriggerEvent: mockFindActiveWorkflowsByTriggerEvent,
  findActiveWorkflowTriggers: mockFindActiveWorkflowTriggers,
  createWorkflowEnrollment: mockCreateWorkflowEnrollment,
}));

mock.module("../repository/public/public", () => ({
  findUserByExternalId: mockFindUserByExternalId,
  createUser: mockCreateUser,
  updateUserAttributes: mockUpdateUserAttributes,
  createEvent: mockCreateEvent,
  findActiveWorkflowsByTriggerEvent: mockFindActiveWorkflowsByTriggerEvent,
  findActiveWorkflowTriggers: mockFindActiveWorkflowTriggers,
  createWorkflowEnrollment: mockCreateWorkflowEnrollment,
}));

// ── Mock: repository/workflow ────────────────────────────────────────
const mockFindStepsByWorkflowId = mock<any>();
const mockFindEdgesByWorkflowId = mock<any>();

mock.module("../repository/workflow", () => ({
  findStepsByWorkflowId: mockFindStepsByWorkflowId,
  findEdgesByWorkflowId: mockFindEdgesByWorkflowId,
}));

// ── Import service under test (after mocks) ──────────────────────────
const {
  createUser,
  updateUserAttributes,
  trackEvent,
  trackPosthogEvent,
  enrollUser,
} = await import("../services/public/public");

// ── Helpers ──────────────────────────────────────────────────────────

const CUSTOMER_ID = "cust-1";
const USER_ID = "user-1";
const WORKFLOW_ID = "wf-1";
const STEP_ID = "step-1";

function fakeUser(overrides?: Record<string, unknown>) {
  return {
    id: USER_ID,
    customerId: CUSTOMER_ID,
    externalId: "ext-1",
    phone: null,
    gender: null,
    attributes: {},
    createdAt: new Date(),
    ...overrides,
  };
}

function fakeWorkflow(overrides?: Record<string, unknown>) {
  return {
    id: WORKFLOW_ID,
    customerId: CUSTOMER_ID,
    name: "Test Workflow",
    triggerType: "system" as const,
    triggerEvent: "user_created",
    status: "active" as const,
    createdAt: new Date(),
    ...overrides,
  };
}

function fakeStep(
  id: string,
  type: string,
  config: Record<string, unknown>
) {
  return {
    id,
    workflowId: WORKFLOW_ID,
    type,
    config,
    createdAt: new Date(),
  };
}

function fakeEdge(source: string, target: string, handle?: boolean) {
  return {
    id: `edge-${source}-${target}`,
    workflowId: WORKFLOW_ID,
    source,
    target,
    handle: handle ?? null,
  };
}

// ── Reset mocks ──────────────────────────────────────────────────────

beforeEach(() => {
  mockFindUserByExternalId.mockReset();
  mockCreateUser.mockReset();
  mockUpdateUserAttributes.mockReset();
  mockCreateEvent.mockReset();
  mockEventDefinitionsRun.mockReset();
  mockFindActiveWorkflowsByTriggerEvent.mockReset();
  mockFindActiveWorkflowTriggers.mockReset();
  mockFindActiveWorkflowTriggers.mockResolvedValue([]);
  mockCreateWorkflowEnrollment.mockReset();
  mockFindStepsByWorkflowId.mockReset();
  mockFindEdgesByWorkflowId.mockReset();
});

// ── Tests ────────────────────────────────────────────────────────────

describe("createUser", () => {
  it("creates user and enrolls into matching active workflows", async () => {
    mockFindUserByExternalId.mockResolvedValue(null);
    mockCreateUser.mockResolvedValue(fakeUser());
    mockFindActiveWorkflowsByTriggerEvent.mockResolvedValue([fakeWorkflow()]);

    // enrollUser internals
    const stepA = fakeStep(STEP_ID, "send", { title: "Hi", body: "Welcome" });
    mockFindStepsByWorkflowId.mockResolvedValue([stepA]);
    mockFindEdgesByWorkflowId.mockResolvedValue([]);
    mockCreateWorkflowEnrollment.mockResolvedValue({ id: "enr-1" });

    const result = await createUser(CUSTOMER_ID, "ext-1");

    expect(result).not.toBeNull();
    expect(mockCreateUser).toHaveBeenCalledTimes(1);
    expect(mockCreateWorkflowEnrollment).toHaveBeenCalledTimes(1);
    expect(mockCreateWorkflowEnrollment.mock.calls[0][0]).toMatchObject({
      userId: USER_ID,
      workflowId: WORKFLOW_ID,
      currentStepId: STEP_ID,
    });
  });

  it("creates user with no enrollment when no workflows match", async () => {
    mockFindUserByExternalId.mockResolvedValue(null);
    mockCreateUser.mockResolvedValue(fakeUser());
    mockFindActiveWorkflowsByTriggerEvent.mockResolvedValue([]);

    const result = await createUser(CUSTOMER_ID, "ext-1");

    expect(result).not.toBeNull();
    expect(mockCreateUser).toHaveBeenCalledTimes(1);
    expect(mockCreateWorkflowEnrollment).not.toHaveBeenCalled();
  });

  it("returns null when user already exists", async () => {
    mockFindUserByExternalId.mockResolvedValue(fakeUser());

    const result = await createUser(CUSTOMER_ID, "ext-1");

    expect(result).toBeNull();
    expect(mockCreateUser).not.toHaveBeenCalled();
    expect(mockCreateWorkflowEnrollment).not.toHaveBeenCalled();
  });
});

describe("updateUserAttributes", () => {
  it("updates attributes and enrolls into user_updated workflows", async () => {
    mockFindUserByExternalId.mockResolvedValue(fakeUser());
    mockUpdateUserAttributes.mockResolvedValue(
      fakeUser({ attributes: { plan: "pro" } })
    );
    mockFindActiveWorkflowsByTriggerEvent.mockResolvedValue([
      fakeWorkflow({ triggerEvent: "user_updated" }),
    ]);

    // enrollUser internals
    const stepA = fakeStep(STEP_ID, "send", { title: "Hi", body: "Updated" });
    mockFindStepsByWorkflowId.mockResolvedValue([stepA]);
    mockFindEdgesByWorkflowId.mockResolvedValue([]);
    mockCreateWorkflowEnrollment.mockResolvedValue({ id: "enr-1" });

    const result = await updateUserAttributes(CUSTOMER_ID, "ext-1", {
      plan: "pro",
    });

    expect(result).not.toBeNull();
    expect(mockUpdateUserAttributes).toHaveBeenCalledTimes(1);
    expect(mockCreateWorkflowEnrollment).toHaveBeenCalledTimes(1);
  });

  it("returns null when user not found", async () => {
    mockFindUserByExternalId.mockResolvedValue(null);

    const result = await updateUserAttributes(CUSTOMER_ID, "ext-1", {
      plan: "pro",
    });

    expect(result).toBeNull();
    expect(mockUpdateUserAttributes).not.toHaveBeenCalled();
    expect(mockCreateWorkflowEnrollment).not.toHaveBeenCalled();
  });
});

describe("trackEvent", () => {
  it("enrolls user into workflows matching the event name", async () => {
    mockFindUserByExternalId.mockResolvedValue(fakeUser());
    mockCreateEvent.mockResolvedValue({
      id: "evt-1",
      eventName: "purchase_completed",
      createdAt: new Date(),
    });
    mockFindActiveWorkflowsByTriggerEvent.mockResolvedValue([
      fakeWorkflow({
        triggerType: "custom",
        triggerEvent: "purchase_completed",
      }),
    ]);

    const stepA = fakeStep(STEP_ID, "send", {
      title: "Thanks",
      body: "Order received",
    });
    mockFindStepsByWorkflowId.mockResolvedValue([stepA]);
    mockFindEdgesByWorkflowId.mockResolvedValue([]);
    mockCreateWorkflowEnrollment.mockResolvedValue({ id: "enr-1" });

    const result = await trackEvent(
      CUSTOMER_ID,
      "ext-1",
      "purchase_completed"
    );

    expect(result).not.toBeNull();
    expect(result!.workflows_triggered).toBe(1);
    expect(mockCreateWorkflowEnrollment).toHaveBeenCalledTimes(1);
  });

  it("returns correct workflows_triggered count with multiple workflows", async () => {
    mockFindUserByExternalId.mockResolvedValue(fakeUser());
    mockCreateEvent.mockResolvedValue({
      id: "evt-1",
      eventName: "purchase_completed",
      createdAt: new Date(),
    });
    mockFindActiveWorkflowsByTriggerEvent.mockResolvedValue([
      fakeWorkflow({ id: "wf-1" }),
      fakeWorkflow({ id: "wf-2" }),
    ]);

    const stepA = fakeStep(STEP_ID, "send", { title: "Hi", body: "Body" });
    mockFindStepsByWorkflowId.mockResolvedValue([stepA]);
    mockFindEdgesByWorkflowId.mockResolvedValue([]);
    mockCreateWorkflowEnrollment.mockResolvedValue({ id: "enr-1" });

    const result = await trackEvent(
      CUSTOMER_ID,
      "ext-1",
      "purchase_completed"
    );

    expect(result!.workflows_triggered).toBe(2);
    expect(mockCreateWorkflowEnrollment).toHaveBeenCalledTimes(2);
  });

  it("returns null when user not found", async () => {
    mockFindUserByExternalId.mockResolvedValue(null);

    const result = await trackEvent(
      CUSTOMER_ID,
      "ext-1",
      "purchase_completed"
    );

    expect(result).toBeNull();
    expect(mockCreateEvent).not.toHaveBeenCalled();
    expect(mockCreateWorkflowEnrollment).not.toHaveBeenCalled();
  });
});

describe("trackPosthogEvent", () => {
  it("stores and enrolls when distinct_id matches a Notify user externalId", async () => {
    mockEventDefinitionsRun.mockResolvedValue({ kind: "recordSeen", id: "def-1", active: false });
    mockFindUserByExternalId.mockResolvedValue(fakeUser());
    mockCreateEvent.mockResolvedValue({
      id: "evt-1",
      eventName: "purchase_completed",
      createdAt: new Date(),
    });
    mockFindActiveWorkflowsByTriggerEvent.mockResolvedValue([
      fakeWorkflow({
        triggerType: "custom",
        triggerEvent: "purchase_completed",
      }),
    ]);

    const stepA = fakeStep(STEP_ID, "send", {
      title: "Thanks",
      body: "Order received",
    });
    mockFindStepsByWorkflowId.mockResolvedValue([stepA]);
    mockFindEdgesByWorkflowId.mockResolvedValue([]);
    mockCreateWorkflowEnrollment.mockResolvedValue({ id: "enr-1" });

    const result = await trackPosthogEvent(
      trackPosthogEventDeps,
      CUSTOMER_ID,
      "integration-1",
      "ext-1",
      "purchase_completed",
      { amount: 42 },
      "2026-05-02T10:00:00.000Z"
    );

    expect(mockEventDefinitionsRun).toHaveBeenCalledWith({
      kind: "recordSeen",
      customerId: CUSTOMER_ID,
      integrationId: "integration-1",
      provider: "posthog",
      eventName: "purchase_completed",
    });
    expect(mockCreateEvent).toHaveBeenCalledWith({
      customerId: CUSTOMER_ID,
      eventDefinitionId: "def-1",
      userId: USER_ID,
      externalId: "ext-1",
      eventName: "purchase_completed",
      properties: { amount: 42 },
      timestamp: new Date("2026-05-02T10:00:00.000Z"),
    });
    expect(result.workflows_triggered).toBe(1);
    expect(mockCreateWorkflowEnrollment).toHaveBeenCalledTimes(1);
  });

  it("stores unresolved PostHog events without enrolling", async () => {
    mockEventDefinitionsRun.mockResolvedValue({ kind: "recordSeen", id: "def-1", active: false });
    mockFindUserByExternalId.mockResolvedValue(null);
    mockCreateEvent.mockResolvedValue({
      id: "evt-1",
      eventName: "purchase_completed",
      createdAt: new Date(),
    });

    const result = await trackPosthogEvent(
      trackPosthogEventDeps,
      CUSTOMER_ID,
      "integration-1",
      "unknown-ext",
      "purchase_completed"
    );

    expect(mockCreateEvent).toHaveBeenCalledWith({
      customerId: CUSTOMER_ID,
      eventDefinitionId: "def-1",
      userId: null,
      externalId: "unknown-ext",
      eventName: "purchase_completed",
      properties: null,
      timestamp: expect.any(Date),
    });
    expect(result.user_id).toBeNull();
    expect(result.workflows_triggered).toBe(0);
    expect(mockFindActiveWorkflowsByTriggerEvent).not.toHaveBeenCalled();
    expect(mockCreateWorkflowEnrollment).not.toHaveBeenCalled();
  });

  it("stores PostHog events even when they are not selected in the catalog", async () => {
    mockEventDefinitionsRun.mockResolvedValue({ kind: "recordSeen", id: "def-1", active: false });
    mockFindUserByExternalId.mockResolvedValue(fakeUser());
    mockCreateEvent.mockResolvedValue({
      id: "evt-1",
      eventName: "paused_event",
      createdAt: new Date(),
    });
    mockFindActiveWorkflowsByTriggerEvent.mockResolvedValue([]);

    const result = await trackPosthogEvent(
      trackPosthogEventDeps,
      CUSTOMER_ID,
      "integration-1",
      "ext-1",
      "paused_event"
    );

    expect(mockEventDefinitionsRun).toHaveBeenCalledWith({
      kind: "recordSeen",
      customerId: CUSTOMER_ID,
      integrationId: "integration-1",
      provider: "posthog",
      eventName: "paused_event",
    });
    expect(mockCreateEvent).toHaveBeenCalledWith({
      customerId: CUSTOMER_ID,
      eventDefinitionId: "def-1",
      userId: USER_ID,
      externalId: "ext-1",
      eventName: "paused_event",
      properties: null,
      timestamp: expect.any(Date),
    });
    expect(result.workflows_triggered).toBe(0);
  });
});

describe("enrollUser", () => {
  it("sets currentStepId to the root step (no incoming edges)", async () => {
    const stepA = fakeStep("step-a", "send", { title: "A", body: "A" });
    const stepB = fakeStep("step-b", "send", { title: "B", body: "B" });
    // step-a → step-b: step-b has an incoming edge, step-a does not
    const edge = fakeEdge("step-a", "step-b");

    mockFindStepsByWorkflowId.mockResolvedValue([stepA, stepB]);
    mockFindEdgesByWorkflowId.mockResolvedValue([edge]);
    mockCreateWorkflowEnrollment.mockResolvedValue({ id: "enr-1" });

    await enrollUser(USER_ID, WORKFLOW_ID);

    expect(mockCreateWorkflowEnrollment).toHaveBeenCalledTimes(1);
    expect(mockCreateWorkflowEnrollment.mock.calls[0][0]).toMatchObject({
      userId: USER_ID,
      workflowId: WORKFLOW_ID,
      currentStepId: "step-a",
    });
  });

  it("returns null when workflow has no steps", async () => {
    mockFindStepsByWorkflowId.mockResolvedValue([]);
    mockFindEdgesByWorkflowId.mockResolvedValue([]);

    const result = await enrollUser(USER_ID, WORKFLOW_ID);

    expect(result).toBeNull();
    expect(mockCreateWorkflowEnrollment).not.toHaveBeenCalled();
  });
});
