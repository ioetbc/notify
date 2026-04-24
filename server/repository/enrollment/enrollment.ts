import { eq, and, lte } from "drizzle-orm";
import {
  db,
  user,
  step,
  stepEdge,
  workflowEnrollment,
  communicationLog,
} from "../../db";
import type { SendConfig } from "../../db/schema";

export async function findReadyEnrollments() {
  return db
    .select()
    .from(workflowEnrollment)
    .where(
      and(
        eq(workflowEnrollment.status, "active"),
        lte(workflowEnrollment.processAt, new Date())
      )
    );
}

export async function findUserById(userId: string) {
  return db.query.user.findFirst({
    where: eq(user.id, userId),
  });
}

export async function findStepsByWorkflowId(workflowId: string) {
  return db.select().from(step).where(eq(step.workflowId, workflowId));
}

export async function findEdgesByWorkflowId(workflowId: string) {
  return db.select().from(stepEdge).where(eq(stepEdge.workflowId, workflowId));
}

export async function updateEnrollment(
  enrollmentId: string,
  values: Partial<{
    currentStepId: string | null;
    processAt: Date | null;
    status: "active" | "processing" | "completed" | "exited";
  }>
) {
  const [updated] = await db
    .update(workflowEnrollment)
    .set(values)
    .where(eq(workflowEnrollment.id, enrollmentId))
    .returning();
  return updated;
}

export async function insertCommunicationLog(values: {
  enrollmentId: string;
  stepId: string;
  userId: string;
  config: SendConfig;
}) {
  const [row] = await db
    .insert(communicationLog)
    .values(values)
    .returning();
  return row;
}

export async function findCommunicationLogsByEnrollmentId(enrollmentId: string) {
  return db
    .select()
    .from(communicationLog)
    .where(eq(communicationLog.enrollmentId, enrollmentId));
}
