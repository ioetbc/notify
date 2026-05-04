import { describe, it, expect, beforeEach, mock } from "bun:test";

// ── Mock: repository/public ──────────────────────────────────────────
const mockFindUserByExternalId = mock<any>();
const mockCreateUser = mock<any>();
const mockUpdateUserAttributes = mock<any>();
const mockCreateEvent = mock<any>();
const mockFindActiveWorkflowsByTriggerEvent = mock<any>();
const mockCreateWorkflowEnrollment = mock<any>();
const mockUpsertEventDefinition = mock<any>();
const mockFindEventDefinitionsByCustomer = mock<any>();
const mockFindEventDefinitionByName = mock<any>();

mock.module("../repository/public", () => ({
  findUserByExternalId: mockFindUserByExternalId,
  createUser: mockCreateUser,
  updateUserAttributes: mockUpdateUserAttributes,
  createEvent: mockCreateEvent,
  findActiveWorkflowsByTriggerEvent: mockFindActiveWorkflowsByTriggerEvent,
  createWorkflowEnrollment: mockCreateWorkflowEnrollment,
  upsertEventDefinition: mockUpsertEventDefinition,
  findEventDefinitionsByCustomer: mockFindEventDefinitionsByCustomer,
  findEventDefinitionByName: mockFindEventDefinitionByName,
}));

// ── Mock: repository/workflow ────────────────────────────────────────
const mockFindStepsByWorkflowId = mock<any>();
const mockFindEdgesByWorkflowId = mock<any>();

mock.module("../repository/workflow", () => ({
  findStepsByWorkflowId: mockFindStepsByWorkflowId,
  findEdgesByWorkflowId: mockFindEdgesByWorkflowId,
}));

// ── Import service under test (after mocks) ──────────────────────────
import {
  createUser,
  updateUserAttributes,
  trackEvent,
  enrollUser,
} from "../services/public/public";

// ── Helpers ──────────────────────────────────────────────────────────

const CUSTOMER_ID = "cust-1";
const USER_ID = "user-1";
const WORKFLOW_ID = "wf-1";
const STEP_ID = "step-1";
const DEFINITION_ID = "def-1";

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

function fakeDefinition(overrides?: Record<string, unknown>) {
  return {
    id: DEFINITION_ID,
    customerId: CUSTOMER_ID,
    name: "user_created",
    source: "customer_api" as const,
    enabledAsTrigger: true,
    firstSeenAt: new Date(),
    lastSeenAt: new Date(),
    ...overrides,
  };
}

function fakeWorkflow(overrides?: Record<string, unknown>) {
  return {
    id: WORKFLOW_ID,
    customerId: CUSTOMER_ID,
    name: "Test Workflow",
    triggerType: "system" as const,
    triggerEventDefinitionId: DEFINITION_ID,
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
  mockFindActiveWorkflowsByTriggerEvent.mockReset();
  mockCreateWorkflowEnrollment.mockReset();
  mockUpsertEventDefinition.mockReset();
  mockFindEventDefinitionsByCustomer.mockReset();
  mockFindEventDefinitionByName.mockReset();
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
  it("upserts event definition and enrolls user into matching workflows", async () => {
    const def = fakeDefinition({ name: "purchase_completed" });
    mockFindUserByExternalId.mockResolvedValue(fakeUser());
    mockUpsertEventDefinition.mockResolvedValue(def);
    mockCreateEvent.mockResolvedValue({
      id: "evt-1",
      eventName: "purchase_completed",
      source: "customer_api",
      eventDefinitionId: def.id,
      createdAt: new Date(),
    });
    mockFindActiveWorkflowsByTriggerEvent.mockResolvedValue([
      fakeWorkflow({
        triggerType: "custom",
        triggerEventDefinitionId: def.id,
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
    expect(mockUpsertEventDefinition).toHaveBeenCalledWith(
      CUSTOMER_ID,
      "purchase_completed",
      "customer_api"
    );
    expect(mockCreateEvent).toHaveBeenCalledTimes(1);
    const eventArg = mockCreateEvent.mock.calls[0][0] as Record<string, unknown>;
    expect(eventArg.source).toBe("customer_api");
    expect(eventArg.eventDefinitionId).toBe(def.id);
    expect(mockCreateWorkflowEnrollment).toHaveBeenCalledTimes(1);
  });

  it("returns correct workflows_triggered count with multiple workflows", async () => {
    const def = fakeDefinition({ name: "purchase_completed" });
    mockFindUserByExternalId.mockResolvedValue(fakeUser());
    mockUpsertEventDefinition.mockResolvedValue(def);
    mockCreateEvent.mockResolvedValue({
      id: "evt-1",
      eventName: "purchase_completed",
      source: "customer_api",
      eventDefinitionId: def.id,
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
    expect(mockUpsertEventDefinition).not.toHaveBeenCalled();
    expect(mockCreateEvent).not.toHaveBeenCalled();
    expect(mockCreateWorkflowEnrollment).not.toHaveBeenCalled();
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

// ── Crypto module tests ─────────────────────────────────────────────

import { encrypt, decrypt } from "../services/crypto";

const TEST_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("crypto", () => {
  it("round-trips plaintext through encrypt/decrypt", () => {
    const plaintext = "phx_my_secret_token_12345";
    const encrypted = encrypt(plaintext, TEST_KEY);
    const decrypted = decrypt(encrypted, TEST_KEY);
    expect(decrypted).toBe(plaintext);
  });

  it("produces different ciphertext for same plaintext (random IV)", () => {
    const a = encrypt("same_input", TEST_KEY);
    const b = encrypt("same_input", TEST_KEY);
    expect(a).not.toBe(b);
  });

  it("ciphertext has three base64 parts separated by colons", () => {
    const encrypted = encrypt("hello", TEST_KEY);
    const parts = encrypted.split(":");
    expect(parts).toHaveLength(3);
  });

  it("throws on tampered ciphertext", () => {
    const encrypted = encrypt("sensitive", TEST_KEY);
    const parts = encrypted.split(":");
    parts[1] = Buffer.from("tampered").toString("base64");
    expect(() => decrypt(parts.join(":"), TEST_KEY)).toThrow();
  });

  it("throws with wrong key", () => {
    const encrypted = encrypt("secret", TEST_KEY);
    const wrongKey =
      "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
    expect(() => decrypt(encrypted, wrongKey)).toThrow();
  });
});
