import * as repository from "../../repository/workflow";
import * as publicRepo from "../../repository/public";
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
  const result = await repository.findWorkflowById(workflowId);

  if (!result) return null;

  const { triggerEventDefinition, ...workflowRow } = result;

  const workflow = {
    ...workflowRow,
    triggerEvent: triggerEventDefinition.name,
  };

  const steps = await repository.findStepsByWorkflowId(workflowId);
  const edges = await repository.findEdgesByWorkflowId(workflowId);

  return { workflow, steps, edges };
}

export async function listWorkflows() {
  return repository.listWorkflows();
}

export async function createWorkflow(customerId: string, input: CreateWorkflowInput) {
  const definition = await publicRepo.upsertEventDefinition(
    customerId,
    input.trigger_event,
    "customer_api"
  );

  const workflow = await repository.createWorkflow({
    customerId,
    name: input.name,
    triggerType: input.trigger_type,
    triggerEventDefinitionId: definition.id,
    status: "draft",
  });

  await repository.insertSteps(toStepInputs(workflow.id, input.steps));
  await repository.insertEdges(toEdgeInputs(workflow.id, input.edges));

  return { ...workflow, triggerEvent: definition.name };
}

export async function publishWorkflow(workflowId: string) {
  return repository.updateWorkflow(workflowId, { status: "active" });
}

export async function updateWorkflow(workflowId: string, input: UpdateWorkflowInput) {
  const existing = await repository.findWorkflowById(workflowId);
  if (!existing) return null;

  const definition = await publicRepo.upsertEventDefinition(
    existing.customerId,
    input.trigger_event,
    "customer_api"
  );

  const updatedWorkflow = await repository.updateWorkflow(workflowId, {
    name: input.name,
    triggerEventDefinitionId: definition.id,
  });

  if (!updatedWorkflow) return null;

  await repository.deleteStepsByWorkflowId(workflowId);
  await repository.insertSteps(toStepInputs(workflowId, input.steps));
  await repository.insertEdges(toEdgeInputs(workflowId, input.edges));

  return { ...updatedWorkflow, triggerEvent: definition.name };
}
