import { randomBytes } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { db, posthogIntegration, customerEventDefinition } from "../../db";
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
