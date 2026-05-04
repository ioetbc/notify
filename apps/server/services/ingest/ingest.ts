import { eq } from "drizzle-orm";
import { db, posthogIntegration } from "../../db";
import * as repository from "../../repository/public";
import { resolveIdentity, type HogPayload } from "../identity-resolver";
import { enrollUser } from "../public/public";

/** Process a PostHog webhook payload. Returns null if user cannot be resolved. */
export async function ingestPosthogEvent(
  integrationId: string,
  payload: HogPayload
) {
  const integration = await db.query.posthogIntegration.findFirst({
    where: eq(posthogIntegration.id, integrationId),
  });

  if (!integration) return { error: "integration_not_found" as const };

  const externalId = resolveIdentity(payload, {
    identityField: integration.identityField,
  });

  if (!externalId) return { error: "identity_unresolved" as const };

  const foundUser = await repository.findUserByExternalId(
    integration.customerId,
    externalId
  );

  if (!foundUser) return { error: "user_not_found" as const };

  const definition = await repository.upsertEventDefinition(
    integration.customerId,
    payload.event,
    "posthog"
  );

  await repository.createEvent({
    customerId: integration.customerId,
    userId: foundUser.id,
    eventName: payload.event,
    source: "posthog",
    eventDefinitionId: definition.id,
    properties: payload.properties ?? null,
    timestamp: payload.timestamp ? new Date(payload.timestamp) : new Date(),
  });

  const matchingWorkflows =
    await repository.findActiveWorkflowsByTriggerEvent(
      integration.customerId,
      payload.event,
      "posthog"
    );

  let workflowsTriggered = 0;
  for (const wf of matchingWorkflows) {
    const enrollment = await enrollUser(foundUser.id, wf.id);
    if (enrollment) workflowsTriggered++;
  }

  return { ok: true as const, workflows_triggered: workflowsTriggered };
}

/** Verify the webhook secret matches the integration's stored secret. */
export async function verifyWebhookSecret(
  integrationId: string,
  token: string
): Promise<boolean> {
  const integration = await db.query.posthogIntegration.findFirst({
    where: eq(posthogIntegration.id, integrationId),
  });
  if (!integration) return false;
  return integration.webhookSecret === token;
}
