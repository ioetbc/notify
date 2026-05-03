import { and, asc, eq, inArray, not, sql } from "drizzle-orm";
import { match } from "ts-pattern";
import { customerEventDefinition } from "../../db/schema";
import type { Db } from "../../db";

export type EventDefinitionCommand =
  | {
      kind: "recordSeen";
      customerId: string;
      integrationId: string;
      provider: "posthog";
      eventName: string;
      volume?: number | null;
    }
  | {
      kind: "replaceSelection";
      customerId: string;
      integrationId: string;
      provider: "posthog";
      events: ReadonlyArray<{ name: string; volume?: number | null }>;
    }
  | {
      kind: "listForIntegration";
      integrationId: string;
    }
  | {
      kind: "listActiveNames";
      customerId: string;
    };

export type EventDefinitionResult =
  | { kind: "recordSeen"; id: string; active: boolean }
  | { kind: "replaceSelection"; activated: string[] }
  | {
      kind: "listForIntegration";
      rows: ReadonlyArray<{
        name: string;
        active: boolean;
        volume: number | null;
      }>;
    }
  | { kind: "listActiveNames"; names: string[] };

export interface EventDefinitionRepo {
  run<C extends EventDefinitionCommand>(
    cmd: C
  ): Promise<Extract<EventDefinitionResult, { kind: C["kind"] }>>;
}

export function createEventDefinitionRepo(db: Db): EventDefinitionRepo {
  return {
    run: ((cmd: EventDefinitionCommand) =>
      match(cmd)
        .with({ kind: "recordSeen" }, (c) => recordSeen(db, c))
        .with({ kind: "replaceSelection" }, (c) => replaceSelection(db, c))
        .with({ kind: "listForIntegration" }, (c) =>
          listForIntegration(db, c)
        )
        .with({ kind: "listActiveNames" }, (c) => listActiveNames(db, c))
        .exhaustive()) as EventDefinitionRepo["run"],
  };
}

async function recordSeen(
  db: Db,
  cmd: Extract<EventDefinitionCommand, { kind: "recordSeen" }>
): Promise<Extract<EventDefinitionResult, { kind: "recordSeen" }>> {
  const now = new Date();

  // Insert with active=false; the conflict-update clause intentionally omits
  // `active` so a high-volume webhook cannot demote a user-selected row.
  const [row] = await db
    .insert(customerEventDefinition)
    .values({
      customerId: cmd.customerId,
      integrationId: cmd.integrationId,
      provider: cmd.provider,
      eventName: cmd.eventName,
      volume: cmd.volume ?? null,
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

  return { kind: "recordSeen", id: row.id, active: row.active };
}

async function replaceSelection(
  db: Db,
  cmd: Extract<EventDefinitionCommand, { kind: "replaceSelection" }>
): Promise<Extract<EventDefinitionResult, { kind: "replaceSelection" }>> {
  const selectedNames = [...new Set(cmd.events.map((e) => e.name))];
  const now = new Date();

  await db.transaction(async (tx) => {
    if (selectedNames.length === 0) {
      await tx
        .update(customerEventDefinition)
        .set({ active: false, updatedAt: now })
        .where(eq(customerEventDefinition.integrationId, cmd.integrationId));
      return;
    }

    await tx
      .update(customerEventDefinition)
      .set({ active: false, updatedAt: now })
      .where(
        and(
          eq(customerEventDefinition.integrationId, cmd.integrationId),
          not(inArray(customerEventDefinition.eventName, selectedNames))
        )
      );

    await tx
      .insert(customerEventDefinition)
      .values(
        cmd.events.map((event) => ({
          customerId: cmd.customerId,
          integrationId: cmd.integrationId,
          provider: cmd.provider,
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
  });

  return { kind: "replaceSelection", activated: selectedNames };
}

async function listForIntegration(
  db: Db,
  cmd: Extract<EventDefinitionCommand, { kind: "listForIntegration" }>
): Promise<Extract<EventDefinitionResult, { kind: "listForIntegration" }>> {
  const rows = await db
    .select({
      name: customerEventDefinition.eventName,
      active: customerEventDefinition.active,
      volume: customerEventDefinition.volume,
    })
    .from(customerEventDefinition)
    .where(eq(customerEventDefinition.integrationId, cmd.integrationId))
    .orderBy(asc(customerEventDefinition.eventName));

  return { kind: "listForIntegration", rows };
}

async function listActiveNames(
  db: Db,
  cmd: Extract<EventDefinitionCommand, { kind: "listActiveNames" }>
): Promise<Extract<EventDefinitionResult, { kind: "listActiveNames" }>> {
  const rows = await db
    .select({ eventName: customerEventDefinition.eventName })
    .from(customerEventDefinition)
    .where(
      and(
        eq(customerEventDefinition.customerId, cmd.customerId),
        eq(customerEventDefinition.active, true)
      )
    )
    .orderBy(asc(customerEventDefinition.eventName));

  return { kind: "listActiveNames", names: rows.map((r) => r.eventName) };
}
