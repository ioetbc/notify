import * as repository from "../../repository/public";
import * as workflowRepo from "../../repository/workflow";
import type { Attributes } from "../../schemas/public";

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

  return repository.createWorkflowEnrollment({
    userId,
    workflowId,
    currentStepId: firstStep.id,
    processAt: new Date(),
  });
}

export async function registerPushToken(
  customerId: string,
  externalId: string,
  token: string
) {
  const foundUser = await repository.findUserByExternalId(customerId, externalId);
  if (!foundUser) return null;

  const pushToken = await repository.upsertPushToken(foundUser.id, token);

  return {
    id: pushToken.id,
    user_id: pushToken.userId,
    token: pushToken.token,
    created_at: pushToken.createdAt!.toISOString(),
  };
}

export async function getUser(customerId: string, externalId: string) {
  const foundUser = await repository.findUserByExternalId(customerId, externalId);
  if (!foundUser) return null;

  return {
    id: foundUser.id,
    external_id: foundUser.externalId,
    phone: foundUser.phone,
    gender: foundUser.gender,
    attributes: foundUser.attributes,
    created_at: foundUser.createdAt!.toISOString(),
  };
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
    externalId,
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

export async function trackPosthogEvent(
  customerId: string,
  integrationId: string,
  externalId: string,
  eventName: string,
  properties?: Record<string, unknown>,
  timestamp?: string
) {
  const definition = await repository.upsertSeenPosthogEvent({
    customerId,
    integrationId,
    eventName,
  });

  const foundUser = await repository.findUserByExternalId(
    customerId,
    externalId
  );

  const evt = await repository.createEvent({
    customerId,
    eventDefinitionId: definition.id,
    userId: foundUser?.id ?? null,
    externalId,
    eventName,
    properties: properties ?? null,
    timestamp: timestamp ? new Date(timestamp) : new Date(),
  });

  let workflowsTriggered = 0;

  if (foundUser) {
    const matchingWorkflows =
      await repository.findActiveWorkflowsByTriggerEvent(customerId, eventName);

    for (const wf of matchingWorkflows) {
      const enrollment = await enrollUser(foundUser.id, wf.id);
      if (enrollment) workflowsTriggered++;
    }
  }

  return {
    id: evt.id,
    event: evt.eventName,
    external_id: externalId,
    user_id: foundUser?.id ?? null,
    received_at: evt.createdAt!.toISOString(),
    workflows_triggered: workflowsTriggered,
  };
}
