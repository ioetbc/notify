import { addHours } from "date-fns";
import { match } from "ts-pattern";
import { eq, and, lte } from "drizzle-orm";
import type { Db } from "../../db";
import {
  user,
  step,
  stepEdge,
  workflowEnrollment,
  communicationLog,
  WaitConfigSchema,
  BranchConfigSchema,
  SendConfigSchema,
  FilterConfigSchema,
  ExitConfigSchema,
} from "../../db/schema";
import type {
  Step,
  StepEdge,
  SendConfig,
} from "../../db/schema";

type UserAttributes = Record<string, string | number | boolean>;

type SendHandler = (payload: {
  userId: string;
  enrollmentId: string;
  stepId: string;
  config: SendConfig;
}) => Promise<unknown[] | undefined | void>;

type WalkResult =
  | { action: "continue"; nextStepId: string }
  | { action: "wait"; nextStepId: string; processAt: Date }
  | { action: "exit" }
  | { action: "complete" };

type StepType = Step["type"];

export type StepEvent =
  | { kind: "stepped"; stepId: string; type: StepType; result: WalkResult }
  | { kind: "exited"; reason: "filter" | "branch" | "missing_user" }
  | { kind: "completed" }
  | { kind: "waiting"; until: Date };

type WalkObserver = (event: StepEvent) => void;

export interface EnrollmentWalkerDeps {
  db: Db;
  onSend: SendHandler;
  observe?: WalkObserver;
}

function evaluateBranchCondition(
  config: { user_column: string; operator: "=" | "!=" | "exists" | "not_exists"; compare_value?: string },
  attributes: UserAttributes
): boolean | null {
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
  config: { attribute_key: string; operator: "=" | "!=" | ">" | "<"; compare_value: string | number | boolean },
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

function walkStep(
  currentStep: Step,
  edges: StepEdge[],
  attributes: UserAttributes
): WalkResult {
  return match(currentStep.type)
    .with("send", () => {
      SendConfigSchema.parse(currentStep.config);
      const edge = findOutgoingEdge(currentStep.id, edges);
      return edge
        ? { action: "continue" as const, nextStepId: edge.target }
        : { action: "complete" as const };
    })
    .with("branch", () => {
      const config = BranchConfigSchema.parse(currentStep.config);
      const result = evaluateBranchCondition(config, attributes);

      if (result === null) return { action: "exit" as const };

      const edge = findOutgoingEdge(currentStep.id, edges, result);

      return edge
        ? { action: "continue" as const, nextStepId: edge.target }
        : { action: "complete" as const };
    })
    .with("filter", () => {
      const config = FilterConfigSchema.parse(currentStep.config);
      const passes = evaluateFilterCondition(config, attributes);

      if (!passes) return { action: "exit" as const };

      const edge = findOutgoingEdge(currentStep.id, edges);
      return edge
        ? { action: "continue" as const, nextStepId: edge.target }
        : { action: "complete" as const };
    })
    .with("wait", () => {
      const config = WaitConfigSchema.parse(currentStep.config);
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
      ExitConfigSchema.parse(currentStep.config);

      return { action: "exit" as const };
    })
    .exhaustive();
}

export class EnrollmentWalker {
  private db: Db;
  private onSend: SendHandler;
  private observe?: WalkObserver;

  constructor(deps: EnrollmentWalkerDeps) {
    this.db = deps.db;
    this.onSend = deps.onSend;
    this.observe = deps.observe;
  }

  private emit(event: StepEvent) {
    this.observe?.(event);
  }

  private async findReadyEnrollments() {
    return this.db
      .select()
      .from(workflowEnrollment)
      .where(
        and(
          eq(workflowEnrollment.status, "active"),
          lte(workflowEnrollment.processAt, new Date())
        )
      );
  }

  private async findEnrollmentById(enrollmentId: string) {
    const rows = await this.db
      .select()
      .from(workflowEnrollment)
      .where(eq(workflowEnrollment.id, enrollmentId));
    return rows[0] ?? null;
  }

  private async findUserById(userId: string) {
    const rows = await this.db.select().from(user).where(eq(user.id, userId));
    return rows[0] ?? null;
  }

  private async findStepsByWorkflowId(workflowId: string) {
    return this.db.select().from(step).where(eq(step.workflowId, workflowId));
  }

  private async findEdgesByWorkflowId(workflowId: string) {
    return this.db.select().from(stepEdge).where(eq(stepEdge.workflowId, workflowId));
  }

  private async updateEnrollment(
    enrollmentId: string,
    values: Partial<{
      currentStepId: string | null;
      processAt: Date | null;
      status: "active" | "processing" | "completed" | "exited";
    }>
  ) {
    const [updated] = await this.db
      .update(workflowEnrollment)
      .set(values)
      .where(eq(workflowEnrollment.id, enrollmentId))
      .returning();
    return updated;
  }

  private async claimCommunicationLog(values: {
    enrollmentId: string;
    stepId: string;
    userId: string;
    config: SendConfig;
  }) {
    const rows = await this.db
      .insert(communicationLog)
      .values({ ...values, status: "claimed" })
      .onConflictDoNothing({
        target: [communicationLog.enrollmentId, communicationLog.stepId],
      })
      .returning({ id: communicationLog.id });
    return rows[0] ?? null;
  }

  private async markCommunicationLogSent(logId: string, tickets: unknown[] | undefined) {
    await this.db
      .update(communicationLog)
      .set({
        status: "sent",
        expoTickets: tickets ?? null,
        sentAt: new Date(),
      })
      .where(eq(communicationLog.id, logId));
  }

  private async markCommunicationLogFailed(logId: string, error: string) {
    await this.db
      .update(communicationLog)
      .set({ status: "failed", error })
      .where(eq(communicationLog.id, logId));
  }

  async processEnrollment(enrollmentId: string) {
    const enrollment = await this.findEnrollmentById(enrollmentId);

    if (!enrollment) return;

    const user = await this.findUserById(enrollment.userId);

    if (!user) {
      this.emit({ kind: "exited", reason: "missing_user" });
      return;
    }

    const steps = await this.findStepsByWorkflowId(enrollment.workflowId);
    const edges = await this.findEdgesByWorkflowId(enrollment.workflowId);

    const stepMap = new Map(steps.map((s) => [s.id, s]));
    
    let currentStepId = enrollment.currentStepId;

    while (currentStepId) {
      const currentStep = stepMap.get(currentStepId);

      if (!currentStep) break;

      if (currentStep.type === "send") {
        const config = SendConfigSchema.parse(currentStep.config);

        const claimed = await this.claimCommunicationLog({
          enrollmentId: enrollment.id,
          stepId: currentStep.id,
          userId: enrollment.userId,
          config,
        });

        if (claimed) {
          try {
            const result = await this.onSend({
              userId: enrollment.userId,
              enrollmentId: enrollment.id,
              stepId: currentStep.id,
              config,
            });
            const tickets = Array.isArray(result) ? result : undefined;
            await this.markCommunicationLogSent(claimed.id, tickets);
          } catch (err) {
            await this.markCommunicationLogFailed(
              claimed.id,
              err instanceof Error ? err.message : String(err)
            );
            throw err;
          }
        }
      }

      const result = walkStep(
        currentStep,
        edges,
        user.attributes as UserAttributes
      );

      this.emit({ kind: "stepped", stepId: currentStep.id, type: currentStep.type, result });

      const terminal = await match(result)
        .with({ action: "continue" }, (r) => {
          currentStepId = r.nextStepId;
          return false;
        })
        .with({ action: "wait" }, async (r) => {
          await this.updateEnrollment(enrollment.id, {
            currentStepId: r.nextStepId,
            processAt: r.processAt,
            status: "active",
          });
          this.emit({ kind: "waiting", until: r.processAt });
          return true;
        })
        .with({ action: "exit" }, async () => {
          await this.updateEnrollment(enrollment.id, {
            currentStepId: null,
            processAt: null,
            status: "exited",
          });
          return true;
        })
        .with({ action: "complete" }, async () => {
          await this.updateEnrollment(enrollment.id, {
            currentStepId: null,
            processAt: null,
            status: "completed",
          });
          this.emit({ kind: "completed" });
          return true;
        })
        .exhaustive();

      if (terminal) return;
    }

    await this.updateEnrollment(enrollment.id, {
      currentStepId: null,
      processAt: null,
      status: "completed",
    });

    this.emit({ kind: "completed" });
  }

  async processReadyEnrollments() {
    const enrollments = await this.findReadyEnrollments();

    const results: { id: string; status: "processed" | "failed"; error?: string }[] = [];

    for (const enrollment of enrollments) {
      await this.updateEnrollment(enrollment.id, { status: "processing" });

      try {
        await this.processEnrollment(enrollment.id);
        results.push({ id: enrollment.id, status: "processed" });
      } catch (error) {
        try {
          await this.updateEnrollment(enrollment.id, { status: "active" });
        } catch {
          // stuck in processing — nothing we can do here
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
}
