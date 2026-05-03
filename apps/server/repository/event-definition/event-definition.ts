import { and, asc, eq, sql } from "drizzle-orm";
import { customerEventDefinition } from "../../db/schema";
import type { Db } from "../../db";

export async function setPosthogEventSelection(
  db: Db,
  input: {
    customerId: string;
    integrationId: string;
    events: Array<{ name: string; volume?: number | null }>;
  }
): Promise<void> {
  const selectedNames = [...new Set(input.events.map((event) => event.name))];
  const now = new Date();

  await db
    .update(customerEventDefinition)
    .set({ active: false, updatedAt: now })
    .where(eq(customerEventDefinition.integrationId, input.integrationId));

  if (selectedNames.length === 0) return;

  await db
    .insert(customerEventDefinition)
    .values(
      input.events.map((event) => ({
        customerId: input.customerId,
        integrationId: input.integrationId,
        provider: "posthog" as const,
        eventName: event.name,
        volume: event.volume ?? null,
        active: true,
        firstSeenAt: now,
        lastSeenAt: now,
        updatedAt: now,
      }))
    )
    .onConflictDoUpdate({
      target: [
        customerEventDefinition.integrationId,
        customerEventDefinition.eventName,
      ],
      set: {
        volume: sql`excluded.volume`,
        active: true,
        lastSeenAt: now,
        updatedAt: now,
      },
    });
}

export async function listEventSelectionByIntegration(
  db: Db,
  integrationId: string
): Promise<Array<{ name: string; active: boolean; volume: number | null }>> {
  const rows = await db
    .select({
      name: customerEventDefinition.eventName,
      active: customerEventDefinition.active,
      volume: customerEventDefinition.volume,
    })
    .from(customerEventDefinition)
    .where(eq(customerEventDefinition.integrationId, integrationId))
    .orderBy(asc(customerEventDefinition.eventName));

  return rows;
}

export async function findActivePosthogEventDefinition(
  db: Db,
  input: {
    integrationId: string;
    eventName: string;
  }
) {
  const [row] = await db
    .select()
    .from(customerEventDefinition)
    .where(
      and(
        eq(customerEventDefinition.integrationId, input.integrationId),
        eq(customerEventDefinition.eventName, input.eventName),
        eq(customerEventDefinition.active, true)
      )
    );

  return row ?? null;
}

export async function upsertSeenPosthogEventDefinition(
  db: Db,
  input: {
    customerId: string;
    integrationId: string;
    eventName: string;
    volume?: number | null;
  }
) {
  const now = new Date();

  const [row] = await db
    .insert(customerEventDefinition)
    .values({
      customerId: input.customerId,
      integrationId: input.integrationId,
      provider: "posthog",
      eventName: input.eventName,
      volume: input.volume ?? null,
      active: false,
      firstSeenAt: now,
      lastSeenAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        customerEventDefinition.integrationId,
        customerEventDefinition.eventName,
      ],
      set: {
        volume: sql`coalesce(excluded.volume, ${customerEventDefinition.volume})`,
        lastSeenAt: now,
        updatedAt: now,
      },
    })
    .returning();

  return row;
}

export async function listActiveEventNames(
  db: Db,
  customerId: string
): Promise<string[]> {
  const rows = await db
    .select({ eventName: customerEventDefinition.eventName })
    .from(customerEventDefinition)
    .where(
      and(
        eq(customerEventDefinition.customerId, customerId),
        eq(customerEventDefinition.active, true)
      )
    )
    .orderBy(asc(customerEventDefinition.eventName));

  return rows.map((row) => row.eventName);
}
