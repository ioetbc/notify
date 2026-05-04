import { eq, and } from "drizzle-orm";
import {
  db,
  user,
  event,
  workflow,
  workflowEnrollment,
  pushToken,
  customerEventDefinition,
} from "../../db";
import type { NewEvent } from "../../db";
import type { Attributes } from "../../schemas/public";

export async function findUserByExternalId(
  customerId: string,
  externalId: string
) {
  return db.query.user.findFirst({
    where: and(eq(user.customerId, customerId), eq(user.externalId, externalId)),
  });
}

export async function createUser(values: {
  customerId: string;
  externalId: string;
  phone?: string;
  gender?: "male" | "female" | "other";
  attributes?: Record<string, string | number | boolean>;
}) {
  const [created] = await db
    .insert(user)
    .values({
      customerId: values.customerId,
      externalId: values.externalId,
      phone: values.phone,
      gender: values.gender,
      attributes: values.attributes ?? {},
    })
    .returning();
  return created;
}

export async function updateUserAttributes(
  userId: string,
  newAttributes: Attributes
) {
  const existing = await db.query.user.findFirst({
    where: eq(user.id, userId),
  });

  const merged = { ...(existing?.attributes ?? {}), ...newAttributes };

  const [updated] = await db
    .update(user)
    .set({ attributes: merged })
    .where(eq(user.id, userId))
    .returning();

  return updated;
}

export async function upsertEventDefinition(
  customerId: string,
  name: string,
  source: "customer_api" | "posthog"
) {
  const now = new Date();
  const [row] = await db
    .insert(customerEventDefinition)
    .values({ customerId, name, source, firstSeenAt: now, lastSeenAt: now })
    .onConflictDoUpdate({
      target: [
        customerEventDefinition.customerId,
        customerEventDefinition.name,
        customerEventDefinition.source,
      ],
      set: { lastSeenAt: now },
    })
    .returning();
  return row;
}

export async function findEventDefinitionsByCustomer(customerId: string) {
  return db
    .select()
    .from(customerEventDefinition)
    .where(eq(customerEventDefinition.customerId, customerId));
}

export async function findEventDefinitionByName(
  customerId: string,
  name: string,
  source: "customer_api" | "posthog"
) {
  return db.query.customerEventDefinition.findFirst({
    where: and(
      eq(customerEventDefinition.customerId, customerId),
      eq(customerEventDefinition.name, name),
      eq(customerEventDefinition.source, source)
    ),
  });
}

export async function createEvent(values: NewEvent) {
  const [created] = await db.insert(event).values(values).returning();
  return created;
}

export async function findActiveWorkflowsByTriggerEvent(
  customerId: string,
  eventName: string,
  source?: "customer_api" | "posthog"
) {
  const conditions = [
    eq(workflow.customerId, customerId),
    eq(customerEventDefinition.name, eventName),
    eq(workflow.status, "active"),
  ];
  if (source) {
    conditions.push(eq(customerEventDefinition.source, source));
  }
  return db
    .select({ id: workflow.id, customerId: workflow.customerId, name: workflow.name, triggerType: workflow.triggerType, triggerEventDefinitionId: workflow.triggerEventDefinitionId, status: workflow.status, createdAt: workflow.createdAt })
    .from(workflow)
    .innerJoin(
      customerEventDefinition,
      eq(workflow.triggerEventDefinitionId, customerEventDefinition.id)
    )
    .where(and(...conditions));
}

export async function createWorkflowEnrollment(values: {
  userId: string;
  workflowId: string;
  currentStepId: string;
  processAt: Date;
}) {
  const [created] = await db
    .insert(workflowEnrollment)
    .values(values)
    .returning();
  return created;
}

export async function upsertPushToken(userId: string, token: string) {
  const [row] = await db
    .insert(pushToken)
    .values({ userId, token })
    .onConflictDoNothing()
    .returning();

  if (!row) {
    const existing = await db.query.pushToken.findFirst({
      where: and(eq(pushToken.userId, userId), eq(pushToken.token, token)),
    });
    return existing!;
  }

  return row;
}
