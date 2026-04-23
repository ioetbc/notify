import * as repository from "../../repository/workflow";
import type { CreateWorkflowInput, UpdateWorkflowInput, CanvasStep, CanvasEdge } from "./workflow.types";

function toStepInputs(workflowId: string, steps: CanvasStep[]) {
  return steps.map((s) => ({
    id: s.id,
    workflowId,
    type: s.type,
    config: s.config,
  }));
}

function toEdgeInputs(workflowId: string, edges: CanvasEdge[]) {
  return edges.map((e) => ({
    workflowId,
    source: e.source,
    target: e.target,
    handle: e.handle ?? null,
  }));
}

export async function getWorkflow(workflowId: string) {
  const workflow = await repository.findWorkflowById(workflowId);

  if (!workflow) return null;

  const steps = await repository.findStepsByWorkflowId(workflowId);
  const edges = await repository.findEdgesByWorkflowId(workflowId);

  return { workflow, steps, edges };
}

export async function listWorkflows() {
  return repository.listWorkflows();
}

export async function createWorkflow(customerId: string, input: CreateWorkflowInput) {
  const workflow = await repository.createWorkflow({
    customerId,
    name: input.name,
    triggerEvent: input.trigger_event,
    status: "active",
  });

  await repository.insertSteps(toStepInputs(workflow.id, input.steps));
  await repository.insertEdges(toEdgeInputs(workflow.id, input.edges));

  return workflow;
}

export async function updateWorkflow(workflowId: string, input: UpdateWorkflowInput) {
  const updatedWorkflow = await repository.updateWorkflow(workflowId, {
    name: input.name,
    triggerEvent: input.trigger_event,
  });

  if (!updatedWorkflow) return null;

  await repository.deleteStepsByWorkflowId(workflowId);
  await repository.insertSteps(toStepInputs(workflowId, input.steps));
  await repository.insertEdges(toEdgeInputs(workflowId, input.edges));

  return updatedWorkflow;
}
