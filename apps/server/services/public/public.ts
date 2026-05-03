import * as repository from "../../repository/public";
import * as workflowRepo from "../../repository/workflow";
import type { Attributes } from "../../schemas/public";

function logPublicEvent(message: string, fields: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ msg: message, ...fields }));
}

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
  logPublicEvent("workflow_enrollment_start", { user_id: userId, workflow_id: workflowId });

  const steps = await workflowRepo.findStepsByWorkflowId(workflowId);
  const edges = await workflowRepo.findEdgesByWorkflowId(workflowId);

  logPublicEvent("workflow_enrollment_graph_loaded", {
    user_id: userId,
    workflow_id: workflowId,
    step_count: steps.length,
    edge_count: edges.length,
  });

  // Find the step that has no incoming edges — this is the first real step
  // (trigger node is not persisted as a step, so the root step is the one
  // connected to the trigger via the first edge saved)
  const stepsWithIncoming = new Set(edges.map((e) => e.target));
  const firstStep = steps.find((s) => !stepsWithIncoming.has(s.id));

  if (!firstStep) {
    logPublicEvent("workflow_enrollment_no_root_step", {
      user_id: userId,
      workflow_id: workflowId,
    });
    return null;
  }

  const enrollment = await repository.createWorkflowEnrollment({
    userId,
    workflowId,
    currentStepId: firstStep.id,
    processAt: new Date(),
  });

  logPublicEvent("workflow_enrollment_created", {
    user_id: userId,
    workflow_id: workflowId,
    enrollment_id: enrollment.id,
    current_step_id: firstStep.id,
  });

  return enrollment;
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
  logPublicEvent("posthog_event_ingest_start", {
    customer_id: customerId,
    integration_id: integrationId,
    external_id: externalId,
    event: eventName,
    timestamp,
  });

  const definition = await repository.upsertSeenPosthogEvent({
    customerId,
    integrationId,
    eventName,
  });

  logPublicEvent("posthog_event_definition_upserted", {
    customer_id: customerId,
    integration_id: integrationId,
    event: eventName,
    event_definition_id: definition.id,
  });

  const foundUser = await repository.findUserByExternalId(
    customerId,
    externalId
  );

  logPublicEvent("posthog_event_user_lookup_completed", {
    customer_id: customerId,
    external_id: externalId,
    event: eventName,
    user_id: foundUser?.id ?? null,
    user_found: Boolean(foundUser),
  });

  const evt = await repository.createEvent({
    customerId,
    eventDefinitionId: definition.id,
    userId: foundUser?.id ?? null,
    externalId,
    eventName,
    properties: properties ?? null,
    timestamp: timestamp ? new Date(timestamp) : new Date(),
  });

  logPublicEvent("posthog_event_created", {
    customer_id: customerId,
    event_id: evt.id,
    event_definition_id: definition.id,
    event: eventName,
    external_id: externalId,
    user_id: foundUser?.id ?? null,
  });

  let workflowsTriggered = 0;

  if (foundUser) {
    const matchingWorkflows =
      await repository.findActiveWorkflowsByTriggerEvent(customerId, eventName);

    logPublicEvent("posthog_event_matching_workflows_loaded", {
      customer_id: customerId,
      event: eventName,
      user_id: foundUser.id,
      workflow_count: matchingWorkflows.length,
      workflow_ids: matchingWorkflows.map((wf) => wf.id),
    });

    if (matchingWorkflows.length === 0) {
      const activeWorkflowTriggers =
        await repository.findActiveWorkflowTriggers(customerId);

      logPublicEvent("posthog_event_no_matching_workflow_trigger", {
        customer_id: customerId,
        event: eventName,
        user_id: foundUser.id,
        active_workflow_count: activeWorkflowTriggers.length,
        active_workflow_triggers: activeWorkflowTriggers.map((wf) => ({
          workflow_id: wf.id,
          name: wf.name,
          trigger_event: wf.triggerEvent,
          status: wf.status,
        })),
      });
    }

    for (const wf of matchingWorkflows) {
      logPublicEvent("posthog_event_enrolling_workflow", {
        customer_id: customerId,
        event: eventName,
        user_id: foundUser.id,
        workflow_id: wf.id,
      });

      const enrollment = await enrollUser(foundUser.id, wf.id);
      if (enrollment) {
        workflowsTriggered++;
      } else {
        logPublicEvent("posthog_event_enrollment_skipped", {
          customer_id: customerId,
          event: eventName,
          user_id: foundUser.id,
          workflow_id: wf.id,
        });
      }
    }
  } else {
    logPublicEvent("posthog_event_enrollment_skipped_no_user", {
      customer_id: customerId,
      event: eventName,
      external_id: externalId,
    });
  }

  logPublicEvent("posthog_event_ingest_completed", {
    customer_id: customerId,
    event_id: evt.id,
    event: eventName,
    external_id: externalId,
    user_id: foundUser?.id ?? null,
    workflows_triggered: workflowsTriggered,
  });

  return {
    id: evt.id,
    event: evt.eventName,
    external_id: externalId,
    user_id: foundUser?.id ?? null,
    received_at: evt.createdAt!.toISOString(),
    workflows_triggered: workflowsTriggered,
  };
}
