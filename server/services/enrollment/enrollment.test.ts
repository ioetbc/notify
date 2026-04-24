import { describe, it, expect, beforeEach, mock } from "bun:test";
import type { Step, StepEdge, WorkflowEnrollment } from "../../db/schema";

// ── Mock: repository/enrollment ──────────────────────────────────────
const mockFindReadyEnrollments = mock<any>();
const mockFindUserById = mock<any>();
const mockFindStepsByWorkflowId = mock<any>();
const mockFindEdgesByWorkflowId = mock<any>();
const mockUpdateEnrollment = mock<any>();
const mockInsertCommunicationLog = mock<any>();

mock.module("../../repository/enrollment", () => ({
  findReadyEnrollments: mockFindReadyEnrollments,
  findUserById: mockFindUserById,
  findStepsByWorkflowId: mockFindStepsByWorkflowId,
  findEdgesByWorkflowId: mockFindEdgesByWorkflowId,
  updateEnrollment: mockUpdateEnrollment,
  insertCommunicationLog: mockInsertCommunicationLog,
}));

// ── Import service under test (after mocks) ──────────────────────────
import {
  processEnrollment,
  processReadyEnrollments,
} from "./enrollment";

// ── Shared setup ─────────────────────────────────────────────────────

function setupMocks({
  steps,
  edges,
  userAttributes = {},
}: {
  steps: Step[];
  edges: StepEdge[];
  userAttributes?: Record<string, string | number | boolean>;
}) {
  mockFindUserById.mockResolvedValue({
    id: "user-1",
    customerId: "cust-1",
    externalId: "ext-1",
    phone: null,
    gender: null,
    attributes: userAttributes,
    createdAt: new Date(),
  });
  mockFindStepsByWorkflowId.mockResolvedValue(steps);
  mockFindEdgesByWorkflowId.mockResolvedValue(edges);
  mockUpdateEnrollment.mockResolvedValue({});
  mockInsertCommunicationLog.mockResolvedValue({});
}

const enrollment: WorkflowEnrollment = {
  id: "enr-1",
  userId: "user-1",
  workflowId: "wf-1",
  currentStepId: "step-1",
  status: "active",
  processAt: new Date(),
  createdAt: new Date(),
};

beforeEach(() => {
  mockFindReadyEnrollments.mockReset();
  mockFindUserById.mockReset();
  mockFindStepsByWorkflowId.mockReset();
  mockFindEdgesByWorkflowId.mockReset();
  mockUpdateEnrollment.mockReset();
  mockInsertCommunicationLog.mockReset();
});

// ── send ─────────────────────────────────────────────────────────────

describe("send step", () => {
  it("completes when send is the last step in the workflow", async () => {
    setupMocks({
      steps: [
        {
          id: "step-1",
          workflowId: "wf-1",
          type: "send",
          config: { title: "Your order shipped", body: "Track it here" },
          createdAt: new Date(),
        },
      ],
      edges: [],
    });

    await processEnrollment(enrollment);

    expect(mockInsertCommunicationLog).toHaveBeenCalledWith({
      enrollmentId: "enr-1",
      stepId: "step-1",
      userId: "user-1",
      config: { title: "Your order shipped", body: "Track it here" },
    });

    expect(mockUpdateEnrollment).toHaveBeenCalledWith("enr-1", {
      currentStepId: null,
      processAt: null,
      status: "completed",
    });
  });
});

// ── branch ───────────────────────────────────────────────────────────

describe("branch step", () => {
  it("follows true edge when user plan = pro", async () => {
    setupMocks({
      steps: [
        {
          id: "step-1",
          workflowId: "wf-1",
          type: "branch",
          config: { user_column: "plan", operator: "=", compare_value: "pro" },
          createdAt: new Date(),
        },
        {
          id: "step-2",
          workflowId: "wf-1",
          type: "send",
          config: { title: "Welcome to Pro!", body: "Enjoy your benefits" },
          createdAt: new Date(),
        },
        {
          id: "step-3",
          workflowId: "wf-1",
          type: "exit",
          config: {},
          createdAt: new Date(),
        },
      ],
      edges: [
        {
          id: "edge-1",
          workflowId: "wf-1",
          source: "step-1",
          target: "step-2",
          handle: true,
        },
        {
          id: "edge-2",
          workflowId: "wf-1",
          source: "step-1",
          target: "step-3",
          handle: false,
        },
      ],
      userAttributes: { plan: "pro" },
    });

    await processEnrollment(enrollment);

    expect(mockUpdateEnrollment).toHaveBeenCalledWith("enr-1", {
      currentStepId: null,
      processAt: null,
      status: "completed",
    });

    expect(mockInsertCommunicationLog).toHaveBeenCalledWith({
      enrollmentId: "enr-1",
      stepId: "step-2",
      userId: "user-1",
      config: { title: "Welcome to Pro!", body: "Enjoy your benefits" },
    });
  });

  it("follows false edge when user plan does not match", async () => {
    setupMocks({
      steps: [
        {
          id: "step-1",
          workflowId: "wf-1",
          type: "branch",
          config: { user_column: "plan", operator: "=", compare_value: "pro" },
          createdAt: new Date(),
        },
        {
          id: "step-2",
          workflowId: "wf-1",
          type: "exit",
          config: {},
          createdAt: new Date(),
        },
        {
          id: "step-3",
          workflowId: "wf-1",
          type: "send",
          config: { title: "Upgrade to Pro", body: "Get more" },
          createdAt: new Date(),
        },
      ],
      edges: [
        {
          id: "edge-1",
          workflowId: "wf-1",
          source: "step-1",
          target: "step-2",
          handle: true,
        },
        {
          id: "edge-2",
          workflowId: "wf-1",
          source: "step-1",
          target: "step-3",
          handle: false,
        },
      ],
      userAttributes: { plan: "free" },
    });

    await processEnrollment(enrollment);

    expect(mockUpdateEnrollment).toHaveBeenCalledWith("enr-1", {
      currentStepId: null,
      processAt: null,
      status: "completed",
    });

    expect(mockInsertCommunicationLog).toHaveBeenCalledWith({
      enrollmentId: "enr-1",
      stepId: "step-3",
      userId: "user-1",
      config: { title: "Upgrade to Pro", body: "Get more" },
    });
  });

  it("exits when the branched attribute does not exist on the user", async () => {
    setupMocks({
      steps: [
        {
          id: "step-1",
          workflowId: "wf-1",
          type: "branch",
          config: { user_column: "plan", operator: "=", compare_value: "pro" },
          createdAt: new Date(),
        },
        {
          id: "step-2",
          workflowId: "wf-1",
          type: "send",
          config: { title: "Pro!", body: "body" },
          createdAt: new Date(),
        },
      ],
      edges: [
        {
          id: "edge-1",
          workflowId: "wf-1",
          source: "step-1",
          target: "step-2",
          handle: true,
        },
      ],
      userAttributes: {},
    });

    await processEnrollment(enrollment);

    expect(mockInsertCommunicationLog).not.toHaveBeenCalled();

    expect(mockUpdateEnrollment).toHaveBeenCalledWith("enr-1", {
      currentStepId: null,
      processAt: null,
      status: "exited",
    });
  });

  it("follows true edge with != operator (plan is free, != pro)", async () => {
    setupMocks({
      steps: [
        {
          id: "step-1",
          workflowId: "wf-1",
          type: "branch",
          config: { user_column: "plan", operator: "!=", compare_value: "pro" },
          createdAt: new Date(),
        },
        {
          id: "step-2",
          workflowId: "wf-1",
          type: "send",
          config: { title: "Not a pro user", body: "body" },
          createdAt: new Date(),
        },
        {
          id: "step-3",
          workflowId: "wf-1",
          type: "exit",
          config: {},
          createdAt: new Date(),
        },
      ],
      edges: [
        {
          id: "edge-1",
          workflowId: "wf-1",
          source: "step-1",
          target: "step-2",
          handle: true,
        },
        {
          id: "edge-2",
          workflowId: "wf-1",
          source: "step-1",
          target: "step-3",
          handle: false,
        },
      ],
      userAttributes: { plan: "free" },
    });

    await processEnrollment(enrollment);

    expect(mockInsertCommunicationLog).toHaveBeenCalledWith({
      enrollmentId: "enr-1",
      stepId: "step-2",
      userId: "user-1",
      config: { title: "Not a pro user", body: "body" },
    });

    // Took the true branch (send) → completed, not the false branch (exit)
    expect(mockUpdateEnrollment).toHaveBeenCalledWith("enr-1", {
      currentStepId: null,
      processAt: null,
      status: "completed",
    });
  });

  it("follows true edge with exists operator when key is present", async () => {
    setupMocks({
      steps: [
        {
          id: "step-1",
          workflowId: "wf-1",
          type: "branch",
          config: { user_column: "plan", operator: "exists" },
          createdAt: new Date(),
        },
        {
          id: "step-2",
          workflowId: "wf-1",
          type: "send",
          config: { title: "Has a plan", body: "body" },
          createdAt: new Date(),
        },
      ],
      edges: [
        {
          id: "edge-1",
          workflowId: "wf-1",
          source: "step-1",
          target: "step-2",
          handle: true,
        },
      ],
      userAttributes: { plan: "pro" },
    });

    await processEnrollment(enrollment);

    expect(mockInsertCommunicationLog).toHaveBeenCalledWith({
      enrollmentId: "enr-1",
      stepId: "step-2",
      userId: "user-1",
      config: { title: "Has a plan", body: "body" },
    });

    expect(mockUpdateEnrollment).toHaveBeenCalledWith("enr-1", {
      currentStepId: null,
      processAt: null,
      status: "completed",
    });
  });

  it("follows false edge with not_exists operator when key is present", async () => {
    setupMocks({
      steps: [
        {
          id: "step-1",
          workflowId: "wf-1",
          type: "branch",
          config: { user_column: "plan", operator: "not_exists" },
          createdAt: new Date(),
        },
        {
          id: "step-2",
          workflowId: "wf-1",
          type: "exit",
          config: {},
          createdAt: new Date(),
        },
        {
          id: "step-3",
          workflowId: "wf-1",
          type: "send",
          config: { title: "Has plan", body: "body" },
          createdAt: new Date(),
        },
      ],
      edges: [
        {
          id: "edge-1",
          workflowId: "wf-1",
          source: "step-1",
          target: "step-2",
          handle: true,
        },
        {
          id: "edge-2",
          workflowId: "wf-1",
          source: "step-1",
          target: "step-3",
          handle: false,
        },
      ],
      userAttributes: { plan: "pro" },
    });

    await processEnrollment(enrollment);

    expect(mockInsertCommunicationLog).toHaveBeenCalledWith({
      enrollmentId: "enr-1",
      stepId: "step-3",
      userId: "user-1",
      config: { title: "Has plan", body: "body" },
    });

    // Took the false branch (send) → completed, not the true branch (exit)
    expect(mockUpdateEnrollment).toHaveBeenCalledWith("enr-1", {
      currentStepId: null,
      processAt: null,
      status: "completed",
    });
  });
});

// ── filter ───────────────────────────────────────────────────────────

describe("filter step", () => {
  it("continues to send when country = UK", async () => {
    setupMocks({
      steps: [
        {
          id: "step-1",
          workflowId: "wf-1",
          type: "filter",
          config: { attribute_key: "country", operator: "=", compare_value: "UK" },
          createdAt: new Date(),
        },
        {
          id: "step-2",
          workflowId: "wf-1",
          type: "send",
          config: { title: "UK offer", body: "body" },
          createdAt: new Date(),
        },
      ],
      edges: [
        {
          id: "edge-1",
          workflowId: "wf-1",
          source: "step-1",
          target: "step-2",
          handle: null,
        },
      ],
      userAttributes: { country: "UK" },
    });

    await processEnrollment(enrollment);

    expect(mockInsertCommunicationLog).toHaveBeenCalledWith({
      enrollmentId: "enr-1",
      stepId: "step-2",
      userId: "user-1",
      config: { title: "UK offer", body: "body" },
    });

    expect(mockUpdateEnrollment).toHaveBeenCalledWith("enr-1", {
      currentStepId: null,
      processAt: null,
      status: "completed",
    });
  });

  it("exits when country does not match filter", async () => {
    setupMocks({
      steps: [
        {
          id: "step-1",
          workflowId: "wf-1",
          type: "filter",
          config: { attribute_key: "country", operator: "=", compare_value: "UK" },
          createdAt: new Date(),
        },
        {
          id: "step-2",
          workflowId: "wf-1",
          type: "send",
          config: { title: "UK offer", body: "body" },
          createdAt: new Date(),
        },
      ],
      edges: [
        {
          id: "edge-1",
          workflowId: "wf-1",
          source: "step-1",
          target: "step-2",
          handle: null,
        },
      ],
      userAttributes: { country: "US" },
    });

    await processEnrollment(enrollment);

    expect(mockInsertCommunicationLog).not.toHaveBeenCalled();

    expect(mockUpdateEnrollment).toHaveBeenCalledWith("enr-1", {
      currentStepId: null,
      processAt: null,
      status: "exited",
    });
  });

  it("exits when the filtered attribute does not exist on the user", async () => {
    setupMocks({
      steps: [
        {
          id: "step-1",
          workflowId: "wf-1",
          type: "filter",
          config: { attribute_key: "country", operator: "=", compare_value: "UK" },
          createdAt: new Date(),
        },
        {
          id: "step-2",
          workflowId: "wf-1",
          type: "send",
          config: { title: "UK offer", body: "body" },
          createdAt: new Date(),
        },
      ],
      edges: [
        {
          id: "edge-1",
          workflowId: "wf-1",
          source: "step-1",
          target: "step-2",
          handle: null,
        },
      ],
      userAttributes: {},
    });

    await processEnrollment(enrollment);

    expect(mockInsertCommunicationLog).not.toHaveBeenCalled();

    expect(mockUpdateEnrollment).toHaveBeenCalledWith("enr-1", {
      currentStepId: null,
      processAt: null,
      status: "exited",
    });
  });

  it("continues when age > 18", async () => {
    setupMocks({
      steps: [
        {
          id: "step-1",
          workflowId: "wf-1",
          type: "filter",
          config: { attribute_key: "age", operator: ">", compare_value: 18 },
          createdAt: new Date(),
        },
        {
          id: "step-2",
          workflowId: "wf-1",
          type: "send",
          config: { title: "Adult content", body: "body" },
          createdAt: new Date(),
        },
      ],
      edges: [
        {
          id: "edge-1",
          workflowId: "wf-1",
          source: "step-1",
          target: "step-2",
          handle: null,
        },
      ],
      userAttributes: { age: 25 },
    });

    await processEnrollment(enrollment);

    expect(mockInsertCommunicationLog).toHaveBeenCalledWith({
      enrollmentId: "enr-1",
      stepId: "step-2",
      userId: "user-1",
      config: { title: "Adult content", body: "body" },
    });

    expect(mockUpdateEnrollment).toHaveBeenCalledWith("enr-1", {
      currentStepId: null,
      processAt: null,
      status: "completed",
    });
  });

  it("exits when age is not < 18", async () => {
    setupMocks({
      steps: [
        {
          id: "step-1",
          workflowId: "wf-1",
          type: "filter",
          config: { attribute_key: "age", operator: "<", compare_value: 18 },
          createdAt: new Date(),
        },
        {
          id: "step-2",
          workflowId: "wf-1",
          type: "send",
          config: { title: "Minor content", body: "body" },
          createdAt: new Date(),
        },
      ],
      edges: [
        {
          id: "edge-1",
          workflowId: "wf-1",
          source: "step-1",
          target: "step-2",
          handle: null,
        },
      ],
      userAttributes: { age: 25 },
    });

    await processEnrollment(enrollment);

    expect(mockInsertCommunicationLog).not.toHaveBeenCalled();

    expect(mockUpdateEnrollment).toHaveBeenCalledWith("enr-1", {
      currentStepId: null,
      processAt: null,
      status: "exited",
    });
  });

  it("continues when country != UK", async () => {
    setupMocks({
      steps: [
        {
          id: "step-1",
          workflowId: "wf-1",
          type: "filter",
          config: { attribute_key: "country", operator: "!=", compare_value: "UK" },
          createdAt: new Date(),
        },
        {
          id: "step-2",
          workflowId: "wf-1",
          type: "send",
          config: { title: "Non-UK offer", body: "body" },
          createdAt: new Date(),
        },
      ],
      edges: [
        {
          id: "edge-1",
          workflowId: "wf-1",
          source: "step-1",
          target: "step-2",
          handle: null,
        },
      ],
      userAttributes: { country: "US" },
    });

    await processEnrollment(enrollment);

    expect(mockInsertCommunicationLog).toHaveBeenCalledWith({
      enrollmentId: "enr-1",
      stepId: "step-2",
      userId: "user-1",
      config: { title: "Non-UK offer", body: "body" },
    });

    expect(mockUpdateEnrollment).toHaveBeenCalledWith("enr-1", {
      currentStepId: null,
      processAt: null,
      status: "completed",
    });
  });
});

// ── wait ─────────────────────────────────────────────────────────────

describe("wait step", () => {
  it("pauses enrollment and schedules next step 24 hours from now", async () => {
    setupMocks({
      steps: [
        {
          id: "step-1",
          workflowId: "wf-1",
          type: "wait",
          config: { hours: 24 },
          createdAt: new Date(),
        },
        {
          id: "step-2",
          workflowId: "wf-1",
          type: "send",
          config: { title: "Follow up", body: "body" },
          createdAt: new Date(),
        },
      ],
      edges: [
        {
          id: "edge-1",
          workflowId: "wf-1",
          source: "step-1",
          target: "step-2",
          handle: null,
        },
      ],
    });

    const before = new Date();
    await processEnrollment(enrollment);

    expect(mockUpdateEnrollment).toHaveBeenCalledTimes(1);
    const call = mockUpdateEnrollment.mock.calls[0];
    expect(call[1].status).toBe("active");
    expect(call[1].currentStepId).toBe("step-2");
    const processAt = call[1].processAt as Date;
    const hoursFromNow = (processAt.getTime() - before.getTime()) / (1000 * 60 * 60);
    expect(hoursFromNow).toBeGreaterThan(23.9);
    expect(hoursFromNow).toBeLessThan(24.1);

    expect(mockInsertCommunicationLog).not.toHaveBeenCalled();
  });

  it("completes when wait is the last step in the workflow", async () => {
    setupMocks({
      steps: [
        {
          id: "step-1",
          workflowId: "wf-1",
          type: "wait",
          config: { hours: 24 },
          createdAt: new Date(),
        },
      ],
      edges: [],
    });

    await processEnrollment(enrollment);

    expect(mockInsertCommunicationLog).not.toHaveBeenCalled();

    expect(mockUpdateEnrollment).toHaveBeenCalledWith("enr-1", {
      currentStepId: null,
      processAt: null,
      status: "completed",
    });
  });
});

// ── exit ─────────────────────────────────────────────────────────────

describe("exit step", () => {
  it("exits the enrollment immediately", async () => {
    setupMocks({
      steps: [
        {
          id: "step-1",
          workflowId: "wf-1",
          type: "exit",
          config: {},
          createdAt: new Date(),
        },
      ],
      edges: [],
    });

    await processEnrollment(enrollment);

    expect(mockInsertCommunicationLog).not.toHaveBeenCalled();

    expect(mockUpdateEnrollment).toHaveBeenCalledWith("enr-1", {
      currentStepId: null,
      processAt: null,
      status: "exited",
    });
  });
});

// ── multi-step workflows ─────────────────────────────────────────────

describe("multi-step workflows", () => {
  it("filter → send: filters insured users then sends notification", async () => {
    setupMocks({
      steps: [
        {
          id: "step-1",
          workflowId: "wf-1",
          type: "filter",
          config: { attribute_key: "is_insured", operator: "=", compare_value: "true" },
          createdAt: new Date(),
        },
        {
          id: "step-2",
          workflowId: "wf-1",
          type: "send",
          config: { title: "You are insured", body: "Congrats" },
          createdAt: new Date(),
        },
      ],
      edges: [
        {
          id: "edge-1",
          workflowId: "wf-1",
          source: "step-1",
          target: "step-2",
          handle: null,
        },
      ],
      userAttributes: { is_insured: "true" },
    });

    await processEnrollment(enrollment);

    expect(mockInsertCommunicationLog).toHaveBeenCalledWith({
      enrollmentId: "enr-1",
      stepId: "step-2",
      userId: "user-1",
      config: { title: "You are insured", body: "Congrats" },
    });

    expect(mockUpdateEnrollment).toHaveBeenCalledWith("enr-1", {
      currentStepId: null,
      processAt: null,
      status: "completed",
    });
  });

  it("send → wait → send: sends welcome, waits 12h, then sends follow-up", async () => {
    setupMocks({
      steps: [
        {
          id: "step-1",
          workflowId: "wf-1",
          type: "send",
          config: { title: "Welcome!", body: "Thanks for signing up" },
          createdAt: new Date(),
        },
        {
          id: "step-2",
          workflowId: "wf-1",
          type: "wait",
          config: { hours: 12 },
          createdAt: new Date(),
        },
        {
          id: "step-3",
          workflowId: "wf-1",
          type: "send",
          config: { title: "How are you finding things?", body: "Let us know" },
          createdAt: new Date(),
        },
      ],
      edges: [
        {
          id: "edge-1",
          workflowId: "wf-1",
          source: "step-1",
          target: "step-2",
          handle: null,
        },
        {
          id: "edge-2",
          workflowId: "wf-1",
          source: "step-2",
          target: "step-3",
          handle: null,
        },
      ],
    });

    await processEnrollment(enrollment);

    expect(mockInsertCommunicationLog).toHaveBeenCalledTimes(1);
    expect(mockInsertCommunicationLog).toHaveBeenCalledWith({
      enrollmentId: "enr-1",
      stepId: "step-1",
      userId: "user-1",
      config: { title: "Welcome!", body: "Thanks for signing up" },
    });

    expect(mockUpdateEnrollment).toHaveBeenCalledTimes(1);
    const call = mockUpdateEnrollment.mock.calls[0];
    expect(call[1].status).toBe("active");
    expect(call[1].currentStepId).toBe("step-3");
    expect(call[1].processAt).toBeInstanceOf(Date);
  });

  it("returns without error when user not found", async () => {
    mockFindUserById.mockResolvedValue(null);
    mockFindStepsByWorkflowId.mockResolvedValue([]);
    mockFindEdgesByWorkflowId.mockResolvedValue([]);

    await processEnrollment(enrollment);

    expect(mockInsertCommunicationLog).not.toHaveBeenCalled();
    expect(mockUpdateEnrollment).not.toHaveBeenCalled();
  });

  it("completes when currentStepId points to a step that no longer exists", async () => {
    setupMocks({
      steps: [
        {
          id: "step-99",
          workflowId: "wf-1",
          type: "send",
          config: { title: "X", body: "X" },
          createdAt: new Date(),
        },
      ],
      edges: [],
    });

    await processEnrollment({ ...enrollment, currentStepId: "step-deleted" });

    expect(mockInsertCommunicationLog).not.toHaveBeenCalled();

    expect(mockUpdateEnrollment).toHaveBeenCalledWith("enr-1", {
      currentStepId: null,
      processAt: null,
      status: "completed",
    });
  });
});

// ── processReadyEnrollments ──────────────────────────────────────────

describe("processReadyEnrollments", () => {
  it("returns zeros when no enrollments are ready", async () => {
    mockFindReadyEnrollments.mockResolvedValue([]);

    const result = await processReadyEnrollments();

    expect(result).toEqual({ processed: 0, failed: 0, results: [] });
  });

  it("locks each enrollment to processing before walking it", async () => {
    mockFindReadyEnrollments.mockResolvedValue([
      { ...enrollment, id: "enr-1" },
      { ...enrollment, id: "enr-2" },
    ]);
    mockUpdateEnrollment.mockResolvedValue({});
    mockFindUserById.mockResolvedValue({
      id: "user-1",
      customerId: "cust-1",
      externalId: "ext-1",
      phone: null,
      gender: null,
      attributes: {},
      createdAt: new Date(),
    });
    mockFindStepsByWorkflowId.mockResolvedValue([
      {
        id: "step-1",
        workflowId: "wf-1",
        type: "send",
        config: { title: "Hi", body: "body" },
        createdAt: new Date(),
      },
    ]);
    mockFindEdgesByWorkflowId.mockResolvedValue([]);

    const result = await processReadyEnrollments();

    expect(result.processed).toBe(2);
    expect(result.failed).toBe(0);

    const lockCalls = mockUpdateEnrollment.mock.calls.filter(
      (c: any) => c[1].status === "processing"
    );
    expect(lockCalls.length).toBe(2);
  });
});
