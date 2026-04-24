import { addHours } from "date-fns";
import { match } from "ts-pattern";
import * as repository from "../../repository/enrollment";
import type {
  Step,
  StepEdge,
  WorkflowEnrollment,
  WaitConfig,
  BranchConfig,
  SendConfig,
  FilterConfig,
} from "../../db/schema";

type UserAttributes = Record<string, string | number | boolean>;

function evaluateBranchCondition(
  config: BranchConfig,
  attributes: UserAttributes
): boolean | null {
  // If the attribute key doesn't exist, return null to signal exit
  if (!(config.user_column in attributes)) return null;

  const value = attributes[config.user_column];

  return match(config.operator)
    .with("=", () => String(value) === String(config.compare_value))
    .with("!=", () => String(value) !== String(config.compare_value))
    .with("exists", () => config.user_column in attributes)
    .with("not_exists", () => !(config.user_column in attributes))
    .exhaustive();
}

function evaluateFilterCondition(
  config: FilterConfig,
  attributes: UserAttributes
): boolean {
  console.log(`[step-walker] Filter config:`, JSON.stringify(config));
  console.log(`[step-walker] User attributes:`, JSON.stringify(attributes));
  console.log(`[step-walker] Checking attribute_key "${config.attribute_key}" in attributes: ${config.attribute_key in attributes}`);
  if (!(config.attribute_key in attributes)) return false;

  const value = attributes[config.attribute_key];

  return match(config.operator)
    .with("=", () => String(value) === String(config.compare_value))
    .with("!=", () => String(value) !== String(config.compare_value))
    .with(">", () => Number(value) > Number(config.compare_value))
    .with("<", () => Number(value) < Number(config.compare_value))
    .exhaustive();
}

function findOutgoingEdge(
  stepId: string,
  edges: StepEdge[],
  handleMatch?: boolean
): StepEdge | undefined {
  if (handleMatch !== undefined) {
    return edges.find((e) => e.source === stepId && e.handle === handleMatch);
  }
  return edges.find((e) => e.source === stepId);
}

type WalkResult =
  | { action: "continue"; nextStepId: string }
  | { action: "wait"; nextStepId: string; processAt: Date }
  | { action: "exit" }
  | { action: "complete" };

function walkStep(
  currentStep: Step,
  edges: StepEdge[],
  attributes: UserAttributes
): WalkResult {
  return match(currentStep.type)
    .with("send", () => {
      const config = currentStep.config as SendConfig;
      console.log(
        `[step-walker] SEND to user: "${config.title}" — "${config.body}"`
      );

      const edge = findOutgoingEdge(currentStep.id, edges);

      return edge
        ? { action: "continue" as const, nextStepId: edge.target }
        : { action: "complete" as const };
    })
    .with("branch", () => {
      const config = currentStep.config as BranchConfig;
      const result = evaluateBranchCondition(config, attributes);

      if (result === null) return { action: "exit" as const };

      const edge = findOutgoingEdge(currentStep.id, edges, result);
      return edge
        ? { action: "continue" as const, nextStepId: edge.target }
        : { action: "complete" as const };
    })
    .with("filter", () => {
      const config = currentStep.config as FilterConfig;
      const passes = evaluateFilterCondition(config, attributes);

      if (!passes) return { action: "exit" as const };

      const edge = findOutgoingEdge(currentStep.id, edges);
      return edge
        ? { action: "continue" as const, nextStepId: edge.target }
        : { action: "complete" as const };
    })
    .with("wait", () => {
      const config = currentStep.config as WaitConfig;
      const edge = findOutgoingEdge(currentStep.id, edges);

      if (!edge) return { action: "complete" as const };

      const processAt = addHours(new Date(), config.hours);
      return {
        action: "wait" as const,
        nextStepId: edge.target,
        processAt,
      };
    })
    .with("exit", () => {
      return { action: "exit" as const };
    })
    .exhaustive();
}

export async function processEnrollment(enrollment: WorkflowEnrollment) {
  console.log(`[step-walker] Processing enrollment ${enrollment.id} (workflow: ${enrollment.workflowId}, user: ${enrollment.userId})`);

  const user = await repository.findUserById(enrollment.userId);

  if (!user) {
    console.log(`[step-walker] User ${enrollment.userId} not found — skipping`);
    return;
  }

  const steps = await repository.findStepsByWorkflowId(enrollment.workflowId);
  const edges = await repository.findEdgesByWorkflowId(enrollment.workflowId);

  console.log(`[step-walker] Loaded ${steps.length} steps and ${edges.length} edges`);

  const stepMap = new Map(steps.map((s) => [s.id, s]));

  let currentStepId = enrollment.currentStepId;

  while (currentStepId) {
    const currentStep = stepMap.get(currentStepId);

    if (!currentStep) {
      console.log(`[step-walker] Step ${currentStepId} not found in workflow — ending`);
      break;
    }

    console.log(`[step-walker] Walking step ${currentStep.id} (type: ${currentStep.type})`);

    if (currentStep.type === "send") {
      await repository.insertCommunicationLog({
        enrollmentId: enrollment.id,
        stepId: currentStep.id,
        userId: enrollment.userId,
        config: currentStep.config as SendConfig,
      });
    }

    const result = walkStep(
      currentStep,
      edges,
      user.attributes as UserAttributes
    );

    console.log(`[step-walker] Step result: ${result.action}`);

    const terminal = await match(result)
      .with({ action: "continue" }, (r) => {
        console.log(`[step-walker] Continuing to step ${r.nextStepId}`);
        currentStepId = r.nextStepId;
        return false;
      })
      .with({ action: "wait" }, async (r) => {
        console.log(`[step-walker] Waiting until ${r.processAt.toISOString()} — next step ${r.nextStepId}`);
        await repository.updateEnrollment(enrollment.id, {
          currentStepId: r.nextStepId,
          processAt: r.processAt,
          status: "active",
        });
        return true;
      })
      .with({ action: "exit" }, async () => {
        console.log(`[step-walker] User exited workflow (failed branch/filter condition)`);
        await repository.updateEnrollment(enrollment.id, {
          currentStepId: null,
          processAt: null,
          status: "exited",
        });
        return true;
      })
      .with({ action: "complete" }, async () => {
        console.log(`[step-walker] Workflow complete — no more steps`);
        await repository.updateEnrollment(enrollment.id, {
          currentStepId: null,
          processAt: null,
          status: "completed",
        });
        return true;
      })
      .exhaustive();

    if (terminal) return;
  }

  console.log(`[step-walker] Reached end of chain — marking completed`);
  await repository.updateEnrollment(enrollment.id, {
    currentStepId: null,
    processAt: null,
    status: "completed",
  });
}

export async function processReadyEnrollments() {
  const enrollments = await repository.findReadyEnrollments();
  console.log(`[step-walker] Found ${enrollments.length} ready enrollments`);

  const results: { id: string; status: "processed" | "failed"; error?: string }[] = [];

  for (const enrollment of enrollments) {
    console.log(`[step-walker] Locking enrollment ${enrollment.id} → processing`);
    await repository.updateEnrollment(enrollment.id, { status: "processing" });

    try {
      await processEnrollment(enrollment);
      results.push({ id: enrollment.id, status: "processed" });
    } catch (error) {
      console.error(`[step-walker] Failed to process enrollment ${enrollment.id}:`, error);

      try {
        await repository.updateEnrollment(enrollment.id, { status: "active" });
      } catch (recoveryError) {
        console.error(`[step-walker] CRITICAL: Failed to reset enrollment ${enrollment.id} to active — stuck in processing:`, recoveryError);
      }

      results.push({
        id: enrollment.id,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    processed: results.filter((r) => r.status === "processed").length,
    failed: results.filter((r) => r.status === "failed").length,
    results,
  };
}
