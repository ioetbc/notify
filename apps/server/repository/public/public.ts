import { eq, and } from "drizzle-orm";
import {
  db,
  user,
  event,
  workflow,
  workflowEnrollment,
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

export async function createEvent(values: NewEvent) {
  const [created] = await db.insert(event).values(values).returning();
  return created;
}

export async function findActiveWorkflowsByTriggerEvent(
  customerId: string,
  eventName: string
) {
  return db
    .select()
    .from(workflow)
    .where(
      and(
        eq(workflow.customerId, customerId),
        eq(workflow.triggerEvent, eventName),
        eq(workflow.status, "active")
      )
    );
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
