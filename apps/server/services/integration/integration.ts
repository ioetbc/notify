import { randomBytes } from "node:crypto";
import { eq, and, inArray } from "drizzle-orm";
import { db, posthogIntegration, customerEventDefinition, workflow } from "../../db";
import { encrypt, decrypt } from "../crypto";
import * as posthogClient from "../posthog-client";

const ENCRYPTION_KEY = process.env.INTEGRATION_ENCRYPTION_KEY ?? "";

function generateWebhookSecret(): string {
  return randomBytes(32).toString("hex");
}

function maskPat(pat: string): string {
  if (pat.length <= 8) return "****";
  return pat.slice(0, 4) + "****" + pat.slice(-4);
}

/** Validate a PAT and list available event definitions from PostHog. */
export async function previewPosthogEvents(pat: string, teamId: string) {
  const user = await posthogClient.validatePat(pat);
  const definitions = await posthogClient.listEventDefinitions(pat, teamId);
  return {
    user: { email: user.email, first_name: user.first_name },
    event_definitions: definitions.map((d) => ({
      name: d.name,
      last_seen_at: d.last_seen_at,
    })),
  };
}

/** Connect PostHog: encrypt PAT, store integration, upsert definitions, create Hog function. */
export async function connectPosthog(
  customerId: string,
  pat: string,
  teamId: string,
  identityField: string,
  enabledEvents: string[],
  webhookBaseUrl: string
) {
  const encryptedPat = encrypt(pat, ENCRYPTION_KEY);
  const webhookSecret = generateWebhookSecret();

  const [integration] = await db
    .insert(posthogIntegration)
    .values({
      customerId,
      encryptedPat,
      teamId,
      identityField,
      webhookSecret,
    })
    .returning();

  for (const eventName of enabledEvents) {
    await db
      .insert(customerEventDefinition)
      .values({
        customerId,
        name: eventName,
        source: "posthog",
        enabledAsTrigger: true,
      })
      .onConflictDoUpdate({
        target: [
          customerEventDefinition.customerId,
          customerEventDefinition.name,
          customerEventDefinition.source,
        ],
        set: { enabledAsTrigger: true, lastSeenAt: new Date() },
      });
  }

  const webhookUrl = `${webhookBaseUrl}/ingest/posthog/${integration.id}`;

  const hogFunction = await posthogClient.createHogFunction(pat, teamId, {
    name: `Notify webhook`,
    webhookUrl,
    webhookSecret,
    eventNames: enabledEvents,
  });

  const [updated] = await db
    .update(posthogIntegration)
    .set({ hogFunctionId: hogFunction.id })
    .where(eq(posthogIntegration.id, integration.id))
    .returning();

  return {
    id: updated.id,
    team_id: updated.teamId,
    identity_field: updated.identityField,
    hog_function_id: updated.hogFunctionId,
    enabled_events: enabledEvents,
  };
}

/** Update a connected PostHog integration. */
export async function updatePosthogIntegration(
  customerId: string,
  updates: {
    pat?: string;
    team_id?: string;
    identity_field?: string;
    enabled_events?: string[];
  }
) {
  const integration = await db.query.posthogIntegration.findFirst({
    where: eq(posthogIntegration.customerId, customerId),
  });

  if (!integration) return { error: "not_connected" as const };

  if (updates.team_id && updates.team_id !== integration.teamId) {
    return { error: "team_id_change_not_allowed" as const };
  }

  const setValues: Record<string, unknown> = { updatedAt: new Date() };

  if (updates.pat && updates.pat.length > 0) {
    setValues.encryptedPat = encrypt(updates.pat, ENCRYPTION_KEY);
  }

  if (updates.identity_field) {
    setValues.identityField = updates.identity_field;
  }

  await db
    .update(posthogIntegration)
    .set(setValues)
    .where(eq(posthogIntegration.id, integration.id));

  if (updates.enabled_events) {
    const existing = await db
      .select()
      .from(customerEventDefinition)
      .where(
        and(
          eq(customerEventDefinition.customerId, customerId),
          eq(customerEventDefinition.source, "posthog")
        )
      );

    const enabledSet = new Set(updates.enabled_events);

    for (const def of existing) {
      const shouldEnable = enabledSet.has(def.name);
      if (def.enabledAsTrigger !== shouldEnable) {
        await db
          .update(customerEventDefinition)
          .set({ enabledAsTrigger: shouldEnable })
          .where(eq(customerEventDefinition.id, def.id));
      }
    }

    for (const eventName of updates.enabled_events) {
      if (!existing.some((d) => d.name === eventName)) {
        await db.insert(customerEventDefinition).values({
          customerId,
          name: eventName,
          source: "posthog",
          enabledAsTrigger: true,
        });
      }
    }

    const allDefs = await db
      .select()
      .from(customerEventDefinition)
      .where(
        and(
          eq(customerEventDefinition.customerId, customerId),
          eq(customerEventDefinition.source, "posthog"),
          eq(customerEventDefinition.enabledAsTrigger, true)
        )
      );

    const enabledNames = allDefs.map((d) => d.name);
    const pat = updates.pat && updates.pat.length > 0
      ? updates.pat
      : decrypt(integration.encryptedPat, ENCRYPTION_KEY);

    if (integration.hogFunctionId) {
      await posthogClient.updateHogFunction(
        pat,
        integration.teamId,
        integration.hogFunctionId,
        enabledNames
      );
    }
  }

  return { ok: true as const };
}

/** Disconnect PostHog: delete Hog function, remove integration row, pause posthog-triggered workflows. */
export async function disconnectPosthog(customerId: string) {
  const integration = await db.query.posthogIntegration.findFirst({
    where: eq(posthogIntegration.customerId, customerId),
  });

  if (!integration) return { error: "not_connected" as const };

  const pat = decrypt(integration.encryptedPat, ENCRYPTION_KEY);

  if (integration.hogFunctionId) {
    await posthogClient.deleteHogFunction(
      pat,
      integration.teamId,
      integration.hogFunctionId
    );
  }

  const posthogDefs = await db
    .select({ id: customerEventDefinition.id })
    .from(customerEventDefinition)
    .where(
      and(
        eq(customerEventDefinition.customerId, customerId),
        eq(customerEventDefinition.source, "posthog")
      )
    );

  const defIds = posthogDefs.map((d) => d.id);

  if (defIds.length > 0) {
    await db
      .update(workflow)
      .set({ status: "paused" })
      .where(
        and(
          eq(workflow.customerId, customerId),
          eq(workflow.status, "active"),
          inArray(workflow.triggerEventDefinitionId, defIds)
        )
      );
  }

  await db
    .delete(posthogIntegration)
    .where(eq(posthogIntegration.id, integration.id));

  return { ok: true as const };
}

/** Get integration state for the settings screen. */
export async function getPosthogIntegration(customerId: string) {
  const integration = await db.query.posthogIntegration.findFirst({
    where: eq(posthogIntegration.customerId, customerId),
  });

  if (!integration) return null;

  const decryptedPat = decrypt(integration.encryptedPat, ENCRYPTION_KEY);

  const definitions = await db
    .select()
    .from(customerEventDefinition)
    .where(
      and(
        eq(customerEventDefinition.customerId, customerId),
        eq(customerEventDefinition.source, "posthog")
      )
    );

  return {
    id: integration.id,
    masked_pat: maskPat(decryptedPat),
    team_id: integration.teamId,
    identity_field: integration.identityField,
    hog_function_id: integration.hogFunctionId,
    event_definitions: definitions.map((d) => ({
      id: d.id,
      name: d.name,
      enabled_as_trigger: d.enabledAsTrigger,
    })),
  };
}
