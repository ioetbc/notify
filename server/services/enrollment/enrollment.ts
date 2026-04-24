import { addHours } from "date-fns";
import { match } from "ts-pattern";
import * as repository from "../../repository/enrollment";
import type {
  Step,
  StepEdge,
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
    .exhaustive();
}

export async function processEnrollment(enrollmentId: string) {
  const enrollment = await repository.findEnrollmentById(enrollmentId);
  if (!enrollment || enrollment.status !== "active") return;

  const userData = await repository.findUserById(enrollment.userId);
  if (!userData) return;

  const steps = await repository.findStepsByWorkflowId(enrollment.workflowId);
  const edges = await repository.findEdgesByWorkflowId(enrollment.workflowId);

  const stepMap = new Map(steps.map((s) => [s.id, s]));
  let currentStepId = enrollment.currentStepId;

  while (currentStepId) {
    const currentStep = stepMap.get(currentStepId);
    if (!currentStep) break;

    const result = walkStep(
      currentStep,
      edges,
      userData.attributes as UserAttributes
    );

    const terminal = await match(result)
      .with({ action: "continue" }, (r) => {
        currentStepId = r.nextStepId;
        return false;
      })
      .with({ action: "wait" }, async (r) => {
        await repository.updateEnrollment(enrollmentId, {
          currentStepId: r.nextStepId,
          processAt: r.processAt,
          status: "active",
        });
        return true;
      })
      .with({ action: "exit" }, async () => {
        await repository.updateEnrollment(enrollmentId, {
          currentStepId: null,
          status: "exited",
        });
        return true;
      })
      .with({ action: "complete" }, async () => {
        await repository.updateEnrollment(enrollmentId, {
          currentStepId: null,
          status: "completed",
        });
        return true;
      })
      .exhaustive();

    if (terminal) return;
  }

  // Reached end of chain without explicit terminal
  await repository.updateEnrollment(enrollmentId, {
    currentStepId: null,
    status: "completed",
  });
}

export async function processReadyEnrollments() {
  const ready = await repository.findReadyEnrollments();

  for (const enrollment of ready) {
    await processEnrollment(enrollment.id);
  }

  return { processed: ready.length };
}
