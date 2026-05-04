import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  pgEnum,
  unique,
  jsonb,
  boolean,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { z } from "zod";
import type { ExpoReceipt } from "../services/notification/dispatch";

export const stepTypeEnum = pgEnum("step_type", ["wait", "branch", "send", "filter", "exit"]);

export const triggerTypeEnum = pgEnum("trigger_type", ["system", "custom"]);

export const enrollmentStatusEnum = pgEnum("enrollment_status", [
  "active",
  "processing",
  "completed",
  "exited",
]);

export const genderEnum = pgEnum("gender", ["male", "female", "other"]);

export const workflowStatusEnum = pgEnum("workflow_status", [
  "draft",
  "active",
  "paused",
  "archived",
]);

export const communicationStatusEnum = pgEnum("communication_status", [
  "claimed",
  "dispatched",
  "failed",
]);

export const dispatchStatusEnum = pgEnum("dispatch_status", [
  "dispatched",
  "delivered",
  "undelivered",
  "expired",
]);

export const deliveryProviderEnum = pgEnum("delivery_provider", ["expo"]);

export const eventSourceEnum = pgEnum("event_source", ["customer_api", "posthog"]);


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
    attributes: jsonb("attributes")
      .$type<Record<string, string | number | boolean>>()
      .default({})
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [unique().on(table.customerId, table.externalId)]
);

export const customerEventDefinition = pgTable(
  "customer_event_definition",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customer.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    source: eventSourceEnum("source").notNull(),
    enabledAsTrigger: boolean("enabled_as_trigger").default(true).notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [unique().on(table.customerId, table.name, table.source)]
);

export const posthogIntegration = pgTable("posthog_integration", {
  id: uuid("id").primaryKey().defaultRandom(),
  customerId: uuid("customer_id")
    .notNull()
    .references(() => customer.id, { onDelete: "cascade" })
    .unique(),
  encryptedPat: text("encrypted_pat").notNull(),
  teamId: text("team_id").notNull(),
  identityField: text("identity_field").default("distinct_id").notNull(),
  hogFunctionId: text("hog_function_id"),
  webhookSecret: text("webhook_secret").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const workflow = pgTable("workflow", {
  id: uuid("id").primaryKey().defaultRandom(),
  customerId: uuid("customer_id")
    .notNull()
    .references(() => customer.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  triggerType: triggerTypeEnum("trigger_type").notNull(),
  triggerEventDefinitionId: uuid("trigger_event_definition_id")
    .notNull()
    .references(() => customerEventDefinition.id),
  status: workflowStatusEnum("status").default("draft").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const WaitConfigSchema = z.object({ hours: z.number() });
export const BranchConfigSchema = z.object({
  user_column: z.string(),
  operator: z.enum(["=", "!=", "exists", "not_exists"]),
  compare_value: z.string().optional(),
});
export const SendConfigSchema = z.object({ title: z.string(), body: z.string() });
export const FilterConfigSchema = z.object({
  attribute_key: z.string(),
  operator: z.enum(["=", "!=", ">", "<"]),
  compare_value: z.union([z.string(), z.number(), z.boolean()]),
});
export const ExitConfigSchema = z.object({}).strict();

export type WaitConfig = z.infer<typeof WaitConfigSchema>;
export type BranchConfig = z.infer<typeof BranchConfigSchema>;
export type SendConfig = z.infer<typeof SendConfigSchema>;
export type FilterConfig = z.infer<typeof FilterConfigSchema>;
export type ExitConfig = z.infer<typeof ExitConfigSchema>;
export type StepConfig = WaitConfig | BranchConfig | SendConfig | FilterConfig | ExitConfig;

export const step = pgTable("step", {
  id: uuid("id").primaryKey().defaultRandom(),
  workflowId: uuid("workflow_id")
    .notNull()
    .references(() => workflow.id, { onDelete: "cascade" }),
  type: stepTypeEnum("type").notNull(),
  config: jsonb("config").$type<StepConfig>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const stepEdge = pgTable("step_edge", {
  id: uuid("id").primaryKey().defaultRandom(),
  workflowId: uuid("workflow_id")
    .notNull()
    .references(() => workflow.id, { onDelete: "cascade" }),
  source: uuid("source")
    .notNull()
    .references(() => step.id, { onDelete: "cascade" }),
  target: uuid("target")
    .notNull()
    .references(() => step.id, { onDelete: "cascade" }),
  handle: boolean("handle"),
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
  }
);


export const communicationLog = pgTable(
  "communication_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    enrollmentId: uuid("enrollment_id")
      .notNull()
      .references(() => workflowEnrollment.id, { onDelete: "cascade" }),
    stepId: uuid("step_id")
      .notNull()
      .references(() => step.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    config: jsonb("config").$type<SendConfig>().notNull(),
    status: communicationStatusEnum("status").notNull().default("dispatched"),
    error: text("error"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [unique().on(table.enrollmentId, table.stepId)]
);

export const dispatch = pgTable(
  "dispatch",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    communicationLogId: uuid("communication_log_id")
      .notNull()
      .references(() => communicationLog.id, { onDelete: "cascade" }),
    provider: deliveryProviderEnum("provider").notNull(),
    token: text("token").notNull(),
    status: dispatchStatusEnum("status").notNull(),
    ackId: text("ack_id"),
    error: jsonb("error"),
    receipt: jsonb("receipt").$type<ExpoReceipt>(),
    receiptsPolledAt: timestamp("receipts_polled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [unique().on(table.communicationLogId, table.token)]
);

export const event = pgTable("event", {
  id: uuid("id").primaryKey().defaultRandom(),
  customerId: uuid("customer_id")
    .notNull()
    .references(() => customer.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  eventName: text("event_name").notNull(),
  source: eventSourceEnum("source").notNull(),
  eventDefinitionId: uuid("event_definition_id")
    .notNull()
    .references(() => customerEventDefinition.id),
  properties: jsonb("properties"),
  timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const pushToken = pgTable(
  "push_token",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    token: text("token").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [unique().on(table.userId, table.token)]
);

export const posthogIntegrationRelations = relations(
  posthogIntegration,
  ({ one }) => ({
    customer: one(customer, {
      fields: [posthogIntegration.customerId],
      references: [customer.id],
    }),
  })
);

export const customerRelations = relations(customer, ({ many, one }) => ({
  users: many(user),
  workflows: many(workflow),
  events: many(event),
  eventDefinitions: many(customerEventDefinition),
  posthogIntegration: one(posthogIntegration),
}));

export const userRelations = relations(user, ({ one, many }) => ({
  customer: one(customer, {
    fields: [user.customerId],
    references: [customer.id],
  }),
  enrollments: many(workflowEnrollment),
  events: many(event),
  pushTokens: many(pushToken),
}));

export const customerEventDefinitionRelations = relations(
  customerEventDefinition,
  ({ one }) => ({
    customer: one(customer, {
      fields: [customerEventDefinition.customerId],
      references: [customer.id],
    }),
  })
);

export const workflowRelations = relations(workflow, ({ one, many }) => ({
  customer: one(customer, {
    fields: [workflow.customerId],
    references: [customer.id],
  }),
  triggerEventDefinition: one(customerEventDefinition, {
    fields: [workflow.triggerEventDefinitionId],
    references: [customerEventDefinition.id],
  }),
  steps: many(step),
  enrollments: many(workflowEnrollment),
}));

export const stepRelations = relations(step, ({ one, many }) => ({
  workflow: one(workflow, {
    fields: [step.workflowId],
    references: [workflow.id],
  }),
  outgoingEdges: many(stepEdge, { relationName: "sourceStep" }),
  incomingEdges: many(stepEdge, { relationName: "targetStep" }),
}));

export const stepEdgeRelations = relations(stepEdge, ({ one }) => ({
  workflow: one(workflow, {
    fields: [stepEdge.workflowId],
    references: [workflow.id],
  }),
  sourceStep: one(step, {
    fields: [stepEdge.source],
    references: [step.id],
    relationName: "sourceStep",
  }),
  targetStep: one(step, {
    fields: [stepEdge.target],
    references: [step.id],
    relationName: "targetStep",
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

export const eventRelations = relations(event, ({ one }) => ({
  customer: one(customer, {
    fields: [event.customerId],
    references: [customer.id],
  }),
  user: one(user, {
    fields: [event.userId],
    references: [user.id],
  }),
  definition: one(customerEventDefinition, {
    fields: [event.eventDefinitionId],
    references: [customerEventDefinition.id],
  }),
}));

export const pushTokenRelations = relations(pushToken, ({ one }) => ({
  user: one(user, {
    fields: [pushToken.userId],
    references: [user.id],
  }),
}));

export const communicationLogRelations = relations(
  communicationLog,
  ({ many }) => ({
    dispatches: many(dispatch),
  })
);

export const dispatchRelations = relations(dispatch, ({ one }) => ({
  communicationLog: one(communicationLog, {
    fields: [dispatch.communicationLogId],
    references: [communicationLog.id],
  }),
}));

export type Customer = typeof customer.$inferSelect;
export type NewCustomer = typeof customer.$inferInsert;
export type CustomerEventDefinition = typeof customerEventDefinition.$inferSelect;
export type NewCustomerEventDefinition = typeof customerEventDefinition.$inferInsert;
export type PosthogIntegration = typeof posthogIntegration.$inferSelect;
export type NewPosthogIntegration = typeof posthogIntegration.$inferInsert;
export type Workflow = typeof workflow.$inferSelect;
export type NewWorkflow = typeof workflow.$inferInsert;
export type Step = typeof step.$inferSelect;
export type NewStep = typeof step.$inferInsert;
export type StepEdge = typeof stepEdge.$inferSelect;
export type NewStepEdge = typeof stepEdge.$inferInsert;
export type WorkflowEnrollment = typeof workflowEnrollment.$inferSelect;
export type Event = typeof event.$inferSelect;
export type NewEvent = typeof event.$inferInsert;
export type PushToken = typeof pushToken.$inferSelect;
export type NewPushToken = typeof pushToken.$inferInsert;
export type CommunicationLog = typeof communicationLog.$inferSelect;
export type NewCommunicationLog = typeof communicationLog.$inferInsert;
export type Dispatch = typeof dispatch.$inferSelect;
export type NewDispatch = typeof dispatch.$inferInsert;
