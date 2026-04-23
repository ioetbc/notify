import * as repository from "../../repository/public";
import type { Attributes } from "../../schemas/public";

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

  return {
    id: updated.id,
    external_id: updated.externalId,
    attributes: updated.attributes,
    updated_at: new Date().toISOString(),
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
    eventName,
    properties: properties ?? null,
    timestamp: timestamp ? new Date(timestamp) : new Date(),
  });

  const matchingWorkflows =
    await repository.findActiveWorkflowsByTriggerEvent(customerId, eventName);

  let workflowsTriggered = 0;
  for (const wf of matchingWorkflows) {
    const enrollment = await repository.createWorkflowEnrollment({
      userId: foundUser.id,
      workflowId: wf.id,
    });
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
