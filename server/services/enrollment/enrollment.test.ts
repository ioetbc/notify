import { describe, it, expect, beforeEach, mock } from "bun:test";
import type { Step, StepEdge, WorkflowEnrollment, WaitConfig, BranchConfig, SendConfig, FilterConfig, ExitConfig } from "../../db/schema";

// ── Mock: repository/enrollment ──────────────────────────────────────
const mockFindReadyEnrollments = mock<any>();
const mockFindUserById = mock<any>();
const mockFindStepsByWorkflowId = mock<any>();
const mockFindEdgesByWorkflowId = mock<any>();
const mockUpdateEnrollment = mock<any>();

mock.module("../../repository/enrollment", () => ({
  findReadyEnrollments: mockFindReadyEnrollments,
  findUserById: mockFindUserById,
  findStepsByWorkflowId: mockFindStepsByWorkflowId,
  findEdgesByWorkflowId: mockFindEdgesByWorkflowId,
  updateEnrollment: mockUpdateEnrollment,
}));

// ── Import service under test (after mocks) ──────────────────────────
import {
  processEnrollment,
  processReadyEnrollments,
} from "./enrollment";

// ── Helpers ──────────────────────────────────────────────────────────

const WORKFLOW_ID = "wf-1";
const USER_ID = "user-1";

type StepConfigMap = {
  wait: WaitConfig;
  branch: BranchConfig;
  send: SendConfig;
  filter: FilterConfig;
  exit: ExitConfig;
};

function makeStep<T extends keyof StepConfigMap>(id: string, type: T, config: StepConfigMap[T]): Step {
  return { id, workflowId: WORKFLOW_ID, type, config, createdAt: new Date() };
}

function makeEdge(source: string, target: string, handle?: boolean): StepEdge {
  return {
    id: `edge-${source}-${target}`,
    workflowId: WORKFLOW_ID,
    source,
    target,
    handle: handle ?? null,
  };
}

function makeEnrollment(overrides?: Partial<WorkflowEnrollment>): WorkflowEnrollment {
  return {
    id: "enr-1",
    userId: USER_ID,
    workflowId: WORKFLOW_ID,
    currentStepId: "step-1",
    status: "active",
    processAt: new Date(),
    createdAt: new Date(),
    ...overrides,
  };
}

function makeUser(attributes: Record<string, string | number | boolean> = {}) {
  return {
    id: USER_ID,
    customerId: "cust-1",
    externalId: "ext-1",
    phone: null,
    gender: null,
    attributes,
    createdAt: new Date(),
  };
}

/** Set up repository mocks for a given step/edge graph and user attributes */
function setupGraph(
  steps: Step[],
  edges: StepEdge[],
  attributes: Record<string, string | number | boolean> = {}
) {
  mockFindUserById.mockResolvedValue(makeUser(attributes));
  mockFindStepsByWorkflowId.mockResolvedValue(steps);
  mockFindEdgesByWorkflowId.mockResolvedValue(edges);
  mockUpdateEnrollment.mockResolvedValue({});
}

// ── Reset mocks ──────────────────────────────────────────────────────

beforeEach(() => {
  mockFindReadyEnrollments.mockReset();
  mockFindUserById.mockReset();
  mockFindStepsByWorkflowId.mockReset();
  mockFindEdgesByWorkflowId.mockReset();
  mockUpdateEnrollment.mockReset();
});

// ── walkStep tests (via processEnrollment) ───────────────────────────

describe("walkStep — send", () => {
  it("continues to next step when outgoing edge exists", async () => {
    const steps = [
      makeStep("step-1", "filter", { attribute_key: 'is_insured', compare_value: 'true', operator: '=' }),
      makeStep("step-2", "send", { title: "You are insured congrats", body: "Done" }),
    ];
    
    const edges = [makeEdge("step-1", "step-2")];

    setupGraph(steps, edges, { is_insured: "true" });

    await processEnrollment(makeEnrollment({ currentStepId: "step-1" }));

    expect(mockUpdateEnrollment).toHaveBeenCalledWith("enr-1", {
      currentStepId: null,
      processAt: null,
      status: "completed",
    });
  });

  it("completes when send has no outgoing edge", async () => {
    const steps = [makeStep("step-1", "send", { title: "Hi", body: "Bye" })];
    const edges: StepEdge[] = [];

    setupGraph(steps, edges);

    await processEnrollment(makeEnrollment({ currentStepId: "step-1" }));

    expect(mockUpdateEnrollment).toHaveBeenCalledWith("enr-1", {
      currentStepId: null,
      processAt: null,
      status: "completed",
    });
  });
});

describe("walkStep — branch", () => {
  it.only("follows true branch when condition matches (= operator)", async () => {
    const steps = [
      makeStep("step-1", "branch", {
        user_column: "plan",
        operator: "=",
        compare_value: "pro",
      }),
      makeStep("step-true", "send", { title: "Pro!", body: "Welcome pro" }),
      makeStep("step-false", "send", { title: "Free", body: "Upgrade?" }),
    ];
    const edges = [
      makeEdge("step-1", "step-true", true),
      makeEdge("step-1", "step-false", false),
    ];

    setupGraph(steps, edges, { plan: "pro" });

    await processEnrollment(makeEnrollment({ currentStepId: "step-1" }));

    expect(mockUpdateEnrollment).toHaveBeenCalledWith("enr-1", {
      currentStepId: null,
      processAt: null,
      status: "completed",
    });

    const calls = mockUpdateEnrollment.mock.calls;
    const statuses = calls.map((c: any) => c[1].status);
    expect(statuses).not.toContain("exited");
  });

  it("follows false branch when condition does not match", async () => {
    const steps = [
      makeStep("step-1", "branch", {
        user_column: "plan",
        operator: "=",
        compare_value: "pro",
      }),
      makeStep("step-true", "send", { title: "Pro!", body: "Welcome pro" }),
      makeStep("step-false", "send", { title: "Free", body: "Upgrade?" }),
    ];
    const edges = [
      makeEdge("step-1", "step-true", true),
      makeEdge("step-1", "step-false", false),
    ];

    setupGraph(steps, edges, { plan: "free" });

    await processEnrollment(makeEnrollment({ currentStepId: "step-1" }));

    expect(mockUpdateEnrollment).toHaveBeenCalledWith("enr-1", {
      currentStepId: null,
      processAt: null,
      status: "completed",
    });
  });

  it("exits when attribute key is missing from user", async () => {
    const steps = [
      makeStep("step-1", "branch", {
        user_column: "plan",
        operator: "=",
        compare_value: "pro",
      }),
      makeStep("step-true", "send", { title: "Pro!", body: "body" }),
    ];
    const edges = [makeEdge("step-1", "step-true", true)];

    setupGraph(steps, edges, {});

    await processEnrollment(makeEnrollment({ currentStepId: "step-1" }));

    expect(mockUpdateEnrollment).toHaveBeenCalledWith("enr-1", {
      currentStepId: null,
      processAt: null,
      status: "exited",
    });
  });

  it("handles != operator correctly", async () => {
    const steps = [
      makeStep("step-1", "branch", {
        user_column: "plan",
        operator: "!=",
        compare_value: "pro",
      }),
      makeStep("step-true", "send", { title: "Not pro", body: "body" }),
      makeStep("step-false", "send", { title: "Is pro", body: "body" }),
    ];
    const edges = [
      makeEdge("step-1", "step-true", true),
      makeEdge("step-1", "step-false", false),
    ];

    // plan is "free" which != "pro" → true branch
    setupGraph(steps, edges, { plan: "free" });

    await processEnrollment(makeEnrollment({ currentStepId: "step-1" }));

    expect(mockUpdateEnrollment).toHaveBeenCalledWith("enr-1", {
      currentStepId: null,
      processAt: null,
      status: "completed",
    });
  });

  it("handles exists operator — key present → true branch", async () => {
    const steps = [
      makeStep("step-1", "branch", {
        user_column: "plan",
        operator: "exists",
      }),
      makeStep("step-true", "send", { title: "Has plan", body: "body" }),
    ];
    const edges = [makeEdge("step-1", "step-true", true)];

    setupGraph(steps, edges, { plan: "anything" });

    await processEnrollment(makeEnrollment({ currentStepId: "step-1" }));

    expect(mockUpdateEnrollment).toHaveBeenCalledWith("enr-1", {
      currentStepId: null,
      processAt: null,
      status: "completed",
    });
  });

  it("handles not_exists operator — key present → false branch", async () => {
    const steps = [
      makeStep("step-1", "branch", {
        user_column: "plan",
        operator: "not_exists",
      }),
      makeStep("step-true", "send", { title: "No plan", body: "body" }),
      makeStep("step-false", "send", { title: "Has plan", body: "body" }),
    ];
    const edges = [
      makeEdge("step-1", "step-true", true),
      makeEdge("step-1", "step-false", false),
    ];

    // User HAS the "plan" key → not_exists is false → false branch
    setupGraph(steps, edges, { plan: "pro" });

    await processEnrollment(makeEnrollment({ currentStepId: "step-1" }));

    expect(mockUpdateEnrollment).toHaveBeenCalledWith("enr-1", {
      currentStepId: null,
      processAt: null,
      status: "completed",
    });
  });
});

describe("walkStep — filter", () => {
  it("continues when = filter passes", async () => {
    const steps = [
      makeStep("step-1", "filter", {
        attribute_key: "country",
        operator: "=",
        compare_value: "UK",
      }),
      makeStep("step-2", "send", { title: "UK user", body: "body" }),
    ];
    const edges = [makeEdge("step-1", "step-2")];

    setupGraph(steps, edges, { country: "UK" });

    await processEnrollment(makeEnrollment({ currentStepId: "step-1" }));

    expect(mockUpdateEnrollment).toHaveBeenCalledWith("enr-1", {
      currentStepId: null,
      processAt: null,
      status: "completed",
    });
  });

  it("exits when = filter fails", async () => {
    const steps = [
      makeStep("step-1", "filter", {
        attribute_key: "country",
        operator: "=",
        compare_value: "UK",
      }),
      makeStep("step-2", "send", { title: "UK user", body: "body" }),
    ];
    const edges = [makeEdge("step-1", "step-2")];

    setupGraph(steps, edges, { country: "US" });

    await processEnrollment(makeEnrollment({ currentStepId: "step-1" }));

    expect(mockUpdateEnrollment).toHaveBeenCalledWith("enr-1", {
      currentStepId: null,
      processAt: null,
      status: "exited",
    });
  });

  it("exits when attribute key is missing", async () => {
    const steps = [
      makeStep("step-1", "filter", {
        attribute_key: "country",
        operator: "=",
        compare_value: "UK",
      }),
      makeStep("step-2", "send", { title: "UK user", body: "body" }),
    ];
    const edges = [makeEdge("step-1", "step-2")];

    setupGraph(steps, edges, {});

    await processEnrollment(makeEnrollment({ currentStepId: "step-1" }));

    expect(mockUpdateEnrollment).toHaveBeenCalledWith("enr-1", {
      currentStepId: null,
      processAt: null,
      status: "exited",
    });
  });

  it("handles > numeric comparison", async () => {
    const steps = [
      makeStep("step-1", "filter", {
        attribute_key: "age",
        operator: ">",
        compare_value: 18,
      }),
      makeStep("step-2", "send", { title: "Adult", body: "body" }),
    ];
    const edges = [makeEdge("step-1", "step-2")];

    setupGraph(steps, edges, { age: 25 });

    await processEnrollment(makeEnrollment({ currentStepId: "step-1" }));

    expect(mockUpdateEnrollment).toHaveBeenCalledWith("enr-1", {
      currentStepId: null,
      processAt: null,
      status: "completed",
    });
  });

  it("handles < numeric comparison — exits when condition fails", async () => {
    const steps = [
      makeStep("step-1", "filter", {
        attribute_key: "age",
        operator: "<",
        compare_value: 18,
      }),
      makeStep("step-2", "send", { title: "Minor", body: "body" }),
    ];
    const edges = [makeEdge("step-1", "step-2")];

    setupGraph(steps, edges, { age: 25 });

    await processEnrollment(makeEnrollment({ currentStepId: "step-1" }));

    expect(mockUpdateEnrollment).toHaveBeenCalledWith("enr-1", {
      currentStepId: null,
      processAt: null,
      status: "exited",
    });
  });

  it("handles != filter", async () => {
    const steps = [
      makeStep("step-1", "filter", {
        attribute_key: "country",
        operator: "!=",
        compare_value: "UK",
      }),
      makeStep("step-2", "send", { title: "Non-UK", body: "body" }),
    ];
    const edges = [makeEdge("step-1", "step-2")];

    setupGraph(steps, edges, { country: "US" });

    await processEnrollment(makeEnrollment({ currentStepId: "step-1" }));

    expect(mockUpdateEnrollment).toHaveBeenCalledWith("enr-1", {
      currentStepId: null,
      processAt: null,
      status: "completed",
    });
  });
});

describe("walkStep — wait", () => {
  it("pauses with future processAt when outgoing edge exists", async () => {
    const steps = [
      makeStep("step-1", "wait", { hours: 24 }),
      makeStep("step-2", "send", { title: "After wait", body: "body" }),
    ];
    const edges = [makeEdge("step-1", "step-2")];

    setupGraph(steps, edges);

    const before = new Date();
    await processEnrollment(makeEnrollment({ currentStepId: "step-1" }));

    expect(mockUpdateEnrollment).toHaveBeenCalledTimes(1);
    const call = mockUpdateEnrollment.mock.calls[0];
    expect(call[1].status).toBe("active");
    expect(call[1].currentStepId).toBe("step-2");
    // processAt should be ~24 hours from now
    const processAt = call[1].processAt as Date;
    const hoursFromNow =
      (processAt.getTime() - before.getTime()) / (1000 * 60 * 60);
    expect(hoursFromNow).toBeGreaterThan(23.9);
    expect(hoursFromNow).toBeLessThan(24.1);
  });

  it("completes when wait has no outgoing edge", async () => {
    const steps = [makeStep("step-1", "wait", { hours: 24 })];
    const edges: StepEdge[] = [];

    setupGraph(steps, edges);

    await processEnrollment(makeEnrollment({ currentStepId: "step-1" }));

    expect(mockUpdateEnrollment).toHaveBeenCalledWith("enr-1", {
      currentStepId: null,
      processAt: null,
      status: "completed",
    });
  });
});

describe("walkStep — exit", () => {
  it("exits the enrollment immediately", async () => {
    const steps = [makeStep("step-1", "exit", {})];
    const edges: StepEdge[] = [];

    setupGraph(steps, edges);

    await processEnrollment(makeEnrollment({ currentStepId: "step-1" }));

    expect(mockUpdateEnrollment).toHaveBeenCalledWith("enr-1", {
      currentStepId: null,
      processAt: null,
      status: "exited",
    });
  });
});

// ── processEnrollment multi-step workflows ───────────────────────────

describe("processEnrollment", () => {
  it("walks linear send → send → end and completes", async () => {
    const steps = [
      makeStep("step-1", "send", { title: "First", body: "body" }),
      makeStep("step-2", "send", { title: "Second", body: "body" }),
    ];
    const edges = [makeEdge("step-1", "step-2")];

    setupGraph(steps, edges);

    await processEnrollment(makeEnrollment({ currentStepId: "step-1" }));

    expect(mockUpdateEnrollment).toHaveBeenCalledTimes(1);
    expect(mockUpdateEnrollment).toHaveBeenCalledWith("enr-1", {
      currentStepId: null,
      processAt: null,
      status: "completed",
    });
  });

  it("walks filter → send when filter passes", async () => {
    const steps = [
      makeStep("step-1", "filter", {
        attribute_key: "plan",
        operator: "=",
        compare_value: "pro",
      }),
      makeStep("step-2", "send", { title: "Pro msg", body: "body" }),
    ];
    const edges = [makeEdge("step-1", "step-2")];

    setupGraph(steps, edges, { plan: "pro" });

    await processEnrollment(makeEnrollment({ currentStepId: "step-1" }));

    expect(mockUpdateEnrollment).toHaveBeenCalledWith("enr-1", {
      currentStepId: null,
      processAt: null,
      status: "completed",
    });
  });

  it("walks send → wait → send and pauses at wait", async () => {
    const steps = [
      makeStep("step-1", "send", { title: "First", body: "body" }),
      makeStep("step-2", "wait", { hours: 12 }),
      makeStep("step-3", "send", { title: "After wait", body: "body" }),
    ];
    const edges = [makeEdge("step-1", "step-2"), makeEdge("step-2", "step-3")];

    setupGraph(steps, edges);

    await processEnrollment(makeEnrollment({ currentStepId: "step-1" }));

    // Should pause at the wait step, not complete
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

    await processEnrollment(makeEnrollment({ currentStepId: "step-1" }));

    expect(mockUpdateEnrollment).not.toHaveBeenCalled();
  });

  it("completes when currentStepId points to nonexistent step", async () => {
    setupGraph(
      [makeStep("step-99", "send", { title: "X", body: "X" })],
      []
    );

    await processEnrollment(
      makeEnrollment({ currentStepId: "step-missing" })
    );

    expect(mockUpdateEnrollment).toHaveBeenCalledWith("enr-1", {
      currentStepId: null,
      processAt: null,
      status: "completed",
    });
  });
});

// ── processReadyEnrollments orchestration ────────────────────────────

describe("processReadyEnrollments", () => {
  it("returns zeros when no ready enrollments", async () => {
    mockFindReadyEnrollments.mockResolvedValue([]);

    const result = await processReadyEnrollments();

    expect(result).toEqual({ processed: 0, failed: 0, results: [] });
  });

  it("processes multiple enrollments and locks each to processing", async () => {
    const enrollments = [
      makeEnrollment({ id: "enr-1", currentStepId: "step-1" }),
      makeEnrollment({ id: "enr-2", currentStepId: "step-1" }),
    ];
    mockFindReadyEnrollments.mockResolvedValue(enrollments);
    mockUpdateEnrollment.mockResolvedValue({});

    // Both enrollments will process the same simple workflow
    const steps = [makeStep("step-1", "send", { title: "Hi", body: "body" })];
    mockFindUserById.mockResolvedValue(makeUser());
    mockFindStepsByWorkflowId.mockResolvedValue(steps);
    mockFindEdgesByWorkflowId.mockResolvedValue([]);

    const result = await processReadyEnrollments();

    expect(result.processed).toBe(2);
    expect(result.failed).toBe(0);

    // Verify both were locked to "processing"
    const lockCalls = mockUpdateEnrollment.mock.calls.filter(
      (c: any) => c[1].status === "processing"
    );
    expect(lockCalls.length).toBe(2);
  });
});
