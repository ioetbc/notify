import { eq, desc } from "drizzle-orm";
import { db, workflow, step, stepEdge } from "../../db";
import type { NewWorkflow, Workflow } from "../../db";
import type { StepInput, EdgeInput } from "./workflow.types";

export async function findWorkflowById(workflowId: string) {
  return db.query.workflow.findFirst({
    where: eq(workflow.id, workflowId),
  });
}

export async function listWorkflows(limit = 10) {
  return db
    .select()
    .from(workflow)
    .orderBy(desc(workflow.createdAt))
    .limit(limit);
}

export async function createWorkflow(values: NewWorkflow) {
  const [created] = await db.insert(workflow).values(values).returning();
  return created;
}

export async function updateWorkflow(
  workflowId: string,
  values: Partial<Pick<Workflow, "name" | "triggerEvent" | "status">>
) {
  const [updated] = await db
    .update(workflow)
    .set(values)
    .where(eq(workflow.id, workflowId))
    .returning();
  return updated;
}

export async function findStepsByWorkflowId(workflowId: string) {
  return db.select().from(step).where(eq(step.workflowId, workflowId));
}

export async function findEdgesByWorkflowId(workflowId: string) {
  return db
    .select()
    .from(stepEdge)
    .where(eq(stepEdge.workflowId, workflowId));
}

export async function insertSteps(steps: StepInput[]) {
  if (!steps.length) return;
  await db.insert(step).values(steps);
}

export async function insertEdges(edges: EdgeInput[]) {
  if (!edges.length) return;
  await db.insert(stepEdge).values(edges);
}

export async function deleteStepsByWorkflowId(workflowId: string) {
  await db.delete(step).where(eq(step.workflowId, workflowId));
}
