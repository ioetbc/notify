import { addHours } from "date-fns";
import * as repository from "../../repository/public";
import * as workflowRepo from "../../repository/workflow";
import type { Attributes } from "../../schemas/public";
import type { WaitConfig } from "../../db/schema";

export async function createUser(
  customerId: string,
  externalId: string,
  phone?: string,
  gender?: "male" | "female" | "other",
  attributes?: Attributes
) {
  const existingUser = await repository.findUserByExternalId(
    customerId,
    externalId
  );

  if (existingUser) return null;

  const created = await repository.createUser({
    customerId,
    externalId,
    phone,
    gender,
    attributes: attributes ?? {},
  });

  const matchingWorkflows =
    await repository.findActiveWorkflowsByTriggerEvent(customerId, "user_created");

  for (const wf of matchingWorkflows) {
    await enrollUser(created.id, wf.id);
  }

  return {
    id: created.id,
    external_id: created.externalId,
    phone: created.phone,
    gender: created.gender,
    attributes: created.attributes,
    created_at: created.createdAt!.toISOString(),
  };
}

export async function updateUserAttributes(
  customerId: string,
  externalId: string,
  attributes: Attributes
) {
  const foundUser = await repository.findUserByExternalId(
    customerId,
    externalId
  );

  if (!foundUser) return null;

  const updated = await repository.updateUserAttributes(
    foundUser.id,
    attributes
  );

  // Enroll in active workflows triggered by contact_updated
  const matchingWorkflows =
    await repository.findActiveWorkflowsByTriggerEvent(customerId, "user_updated");

  for (const wf of matchingWorkflows) {
    await enrollUser(foundUser.id, wf.id);
  }

  return {
    id: updated.id,
    external_id: updated.externalId,
    attributes: updated.attributes,
    updated_at: new Date().toISOString(),
  };
}

export async function enrollUser(userId: string, workflowId: string) {
  const steps = await workflowRepo.findStepsByWorkflowId(workflowId);
  const edges = await workflowRepo.findEdgesByWorkflowId(workflowId);

  // Find the step that has no incoming edges — this is the first real step
  // (trigger node is not persisted as a step, so the root step is the one
  // connected to the trigger via the first edge saved)
  const stepsWithIncoming = new Set(edges.map((e) => e.target));
  const firstStep = steps.find((s) => !stepsWithIncoming.has(s.id));

  if (!firstStep) return null;

  const now = new Date();
  const processAt =
    firstStep.type === "wait"
      ? addHours(now, (firstStep.config as WaitConfig).hours)
      : now;

  return repository.createWorkflowEnrollment({
    userId,
    workflowId,
    currentStepId: firstStep.id,
    processAt,
  });
}

export async function trackEvent(
  customerId: string,
  externalId: string,
  eventName: string,
  properties?: Record<string, unknown>,
  timestamp?: string
) {
  const foundUser = await repository.findUserByExternalId(
    customerId,
    externalId
  );

  if (!foundUser) return null;

  const evt = await repository.createEvent({
    customerId,
    userId: foundUser.id,
    eventName,
    properties: properties ?? null,
    timestamp: timestamp ? new Date(timestamp) : new Date(),
  });

  const matchingWorkflows =
    await repository.findActiveWorkflowsByTriggerEvent(customerId, eventName);

  let workflowsTriggered = 0;

  for (const wf of matchingWorkflows) {
    const enrollment = await enrollUser(foundUser.id, wf.id);
    if (enrollment) workflowsTriggered++;
  }

  return {
    id: evt.id,
    event: evt.eventName,
    external_id: externalId,
    received_at: evt.createdAt!.toISOString(),
    workflows_triggered: workflowsTriggered,
  };
}
