import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  integer,
  timestamp,
  pgEnum,
  unique,
  numeric,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

export const stepTypeEnum = pgEnum("step_type", ["wait", "branch", "send"]);

export const triggerEventEnum = pgEnum("trigger_event", [
  "contact_added",
  "contact_updated",
  "event_received",
]);

export const enrollmentStatusEnum = pgEnum("enrollment_status", [
  "active",
  "completed",
  "exited",
]);

export const branchOperatorEnum = pgEnum("branch_operator", [
  "=",
  "!=",
  "exists",
  "not_exists",
]);

export const genderEnum = pgEnum("gender", ["male", "female", "other"]);

export const workflowStatusEnum = pgEnum("workflow_status", [
  "draft",
  "active",
  "paused",
  "archived",
]);

export const attributeTypeEnum = pgEnum("attribute_type", [
  "text",
  "boolean",
  "number",
]);

export const customer = pgTable("customer", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: varchar("email", { length: 255 }).unique().notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  apiKey: text("api_key").unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const user = pgTable(
  "user",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customer.id, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(),
    gender: genderEnum("gender"),
    phone: text("phone"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [unique().on(table.customerId, table.externalId)]
);

export const workflow = pgTable("workflow", {
  id: uuid("id").primaryKey().defaultRandom(),
  customerId: uuid("customer_id")
    .notNull()
    .references(() => customer.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  triggerEvent: triggerEventEnum("trigger_event").notNull(),
  status: workflowStatusEnum("status").default("draft").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const step = pgTable("step", {
  id: uuid("id").primaryKey().defaultRandom(),
  workflowId: uuid("workflow_id")
    .notNull()
    .references(() => workflow.id, { onDelete: "cascade" }),
  stepType: stepTypeEnum("step_type").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const stepWait = pgTable("step_wait", {
  stepId: uuid("step_id")
    .primaryKey()
    .references(() => step.id, { onDelete: "cascade" }),
  hours: integer("hours").notNull(),
  nextStepId: uuid("next_step_id").references(() => step.id, {
    onDelete: "set null",
  }),
});

export const stepBranch = pgTable("step_branch", {
  stepId: uuid("step_id")
    .primaryKey()
    .references(() => step.id, { onDelete: "cascade" }),
  userColumn: text("user_column"),
  operator: branchOperatorEnum("operator").notNull(),
  compareValue: text("compare_value"),
  trueStepId: uuid("true_step_id").references(() => step.id, {
    onDelete: "set null",
  }),
  falseStepId: uuid("false_step_id").references(() => step.id, {
    onDelete: "set null",
  }),
  attributeDefinitionId: uuid("attribute_definition_id").references(
    () => attributeDefinition.id,
    { onDelete: "cascade" }
  ),
});

export const stepSend = pgTable("step_send", {
  stepId: uuid("step_id")
    .primaryKey()
    .references(() => step.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  body: text("body").notNull(),
  nextStepId: uuid("next_step_id").references(() => step.id, {
    onDelete: "set null",
  }),
});

export const workflowEnrollment = pgTable(
  "workflow_enrollment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    workflowId: uuid("workflow_id")
      .notNull()
      .references(() => workflow.id, { onDelete: "cascade" }),
    currentStepId: uuid("current_step_id").references(() => step.id, {
      onDelete: "set null",
    }),
    status: enrollmentStatusEnum("status").notNull().default("active"),
    processAt: timestamp("process_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [unique().on(table.userId, table.workflowId)]
);

export const attributeDefinition = pgTable(
  "attribute_definition",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customer.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    dataType: attributeTypeEnum("data_type").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [unique().on(table.customerId, table.name)]
);

export const userAttribute = pgTable(
  "user_attribute",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    attributeDefinitionId: uuid("attribute_definition_id")
      .notNull()
      .references(() => attributeDefinition.id, { onDelete: "cascade" }),
    valueText: text("value_text"),
    valueBoolean: boolean("value_boolean"),
    valueNumber: numeric("value_number"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [unique().on(table.userId, table.attributeDefinitionId)]
);

export const customerRelations = relations(customer, ({ many }) => ({
  users: many(user),
  workflows: many(workflow),
  attributeDefinitions: many(attributeDefinition),
}));

export const userRelations = relations(user, ({ one, many }) => ({
  customer: one(customer, {
    fields: [user.customerId],
    references: [customer.id],
  }),
  attributes: many(userAttribute),
  enrollments: many(workflowEnrollment),
}));

export const workflowRelations = relations(workflow, ({ one, many }) => ({
  customer: one(customer, {
    fields: [workflow.customerId],
    references: [customer.id],
  }),
  steps: many(step),
  enrollments: many(workflowEnrollment),
}));

export const stepRelations = relations(step, ({ one }) => ({
  workflow: one(workflow, {
    fields: [step.workflowId],
    references: [workflow.id],
  }),
  waitConfig: one(stepWait, { fields: [step.id], references: [stepWait.stepId] }),
  branchConfig: one(stepBranch, {
    fields: [step.id],
    references: [stepBranch.stepId],
  }),
  sendConfig: one(stepSend, { fields: [step.id], references: [stepSend.stepId] }),
}));

export const stepWaitRelations = relations(stepWait, ({ one }) => ({
  step: one(step, { fields: [stepWait.stepId], references: [step.id] }),
  nextStep: one(step, { fields: [stepWait.nextStepId], references: [step.id] }),
}));

export const stepBranchRelations = relations(stepBranch, ({ one }) => ({
  step: one(step, { fields: [stepBranch.stepId], references: [step.id] }),
  trueStep: one(step, { fields: [stepBranch.trueStepId], references: [step.id] }),
  falseStep: one(step, {
    fields: [stepBranch.falseStepId],
    references: [step.id],
  }),
  attributeDefinition: one(attributeDefinition, {
    fields: [stepBranch.attributeDefinitionId],
    references: [attributeDefinition.id],
  }),
}));

export const stepSendRelations = relations(stepSend, ({ one }) => ({
  step: one(step, { fields: [stepSend.stepId], references: [step.id] }),
  nextStep: one(step, { fields: [stepSend.nextStepId], references: [step.id] }),
}));

export const attributeDefinitionRelations = relations(
  attributeDefinition,
  ({ one, many }) => ({
    customer: one(customer, {
      fields: [attributeDefinition.customerId],
      references: [customer.id],
    }),
    userAttributes: many(userAttribute),
  })
);

export const userAttributeRelations = relations(userAttribute, ({ one }) => ({
  user: one(user, { fields: [userAttribute.userId], references: [user.id] }),
  attributeDefinition: one(attributeDefinition, {
    fields: [userAttribute.attributeDefinitionId],
    references: [attributeDefinition.id],
  }),
}));

export const workflowEnrollmentRelations = relations(
  workflowEnrollment,
  ({ one }) => ({
    user: one(user, {
      fields: [workflowEnrollment.userId],
      references: [user.id],
    }),
    workflow: one(workflow, {
      fields: [workflowEnrollment.workflowId],
      references: [workflow.id],
    }),
    currentStep: one(step, {
      fields: [workflowEnrollment.currentStepId],
      references: [step.id],
    }),
  })
);

export type Customer = typeof customer.$inferSelect;
export type NewCustomer = typeof customer.$inferInsert;
export type Workflow = typeof workflow.$inferSelect;
export type NewWorkflow = typeof workflow.$inferInsert;
export type Step = typeof step.$inferSelect;
export type NewStep = typeof step.$inferInsert;
export type StepWait = typeof stepWait.$inferSelect;
export type NewStepWait = typeof stepWait.$inferInsert;
export type StepBranch = typeof stepBranch.$inferSelect;
export type NewStepBranch = typeof stepBranch.$inferInsert;
export type StepSend = typeof stepSend.$inferSelect;
export type NewStepSend = typeof stepSend.$inferInsert;
export type AttributeDefinition = typeof attributeDefinition.$inferSelect;
export type UserAttribute = typeof userAttribute.$inferSelect;
export type WorkflowEnrollment = typeof workflowEnrollment.$inferSelect;
