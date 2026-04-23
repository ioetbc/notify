CREATE TYPE "public"."attribute_type" AS ENUM('text', 'boolean', 'number');--> statement-breakpoint
CREATE TYPE "public"."branch_operator" AS ENUM('=', '!=', 'exists', 'not_exists');--> statement-breakpoint
CREATE TYPE "public"."enrollment_status" AS ENUM('active', 'completed', 'exited');--> statement-breakpoint
CREATE TYPE "public"."gender" AS ENUM('male', 'female', 'other');--> statement-breakpoint
CREATE TYPE "public"."step_type" AS ENUM('wait', 'branch', 'send');--> statement-breakpoint
CREATE TYPE "public"."trigger_event" AS ENUM('contact_added', 'contact_updated', 'event_received');--> statement-breakpoint
CREATE TABLE "attribute_definition" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"name" text NOT NULL,
	"data_type" "attribute_type" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "attribute_definition_customer_id_name_unique" UNIQUE("customer_id","name")
);
--> statement-breakpoint
CREATE TABLE "customer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"name" varchar(255) NOT NULL,
	"api_key" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "customer_email_unique" UNIQUE("email"),
	CONSTRAINT "customer_api_key_unique" UNIQUE("api_key")
);
--> statement-breakpoint
CREATE TABLE "step" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" uuid NOT NULL,
	"step_type" "step_type" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "step_branch" (
	"step_id" uuid PRIMARY KEY NOT NULL,
	"user_column" text,
	"operator" "branch_operator" NOT NULL,
	"compare_value" text,
	"true_step_id" uuid,
	"false_step_id" uuid,
	"attribute_definition_id" uuid
);
--> statement-breakpoint
CREATE TABLE "step_send" (
	"step_id" uuid PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"next_step_id" uuid
);
--> statement-breakpoint
CREATE TABLE "step_wait" (
	"step_id" uuid PRIMARY KEY NOT NULL,
	"hours" integer NOT NULL,
	"next_step_id" uuid
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"gender" "gender",
	"phone" text,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "user_customer_id_external_id_unique" UNIQUE("customer_id","external_id")
);
--> statement-breakpoint
CREATE TABLE "user_attribute" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"attribute_definition_id" uuid NOT NULL,
	"value_text" text,
	"value_boolean" boolean,
	"value_number" numeric,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "user_attribute_user_id_attribute_definition_id_unique" UNIQUE("user_id","attribute_definition_id")
);
--> statement-breakpoint
CREATE TABLE "workflow" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"name" text NOT NULL,
	"trigger_event" "trigger_event" NOT NULL,
	"active" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "workflow_enrollment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"workflow_id" uuid NOT NULL,
	"current_step_id" uuid,
	"status" "enrollment_status" DEFAULT 'active' NOT NULL,
	"process_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "workflow_enrollment_user_id_workflow_id_unique" UNIQUE("user_id","workflow_id")
);
--> statement-breakpoint
ALTER TABLE "attribute_definition" ADD CONSTRAINT "attribute_definition_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "step" ADD CONSTRAINT "step_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "step_branch" ADD CONSTRAINT "step_branch_step_id_step_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."step"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "step_branch" ADD CONSTRAINT "step_branch_true_step_id_step_id_fk" FOREIGN KEY ("true_step_id") REFERENCES "public"."step"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "step_branch" ADD CONSTRAINT "step_branch_false_step_id_step_id_fk" FOREIGN KEY ("false_step_id") REFERENCES "public"."step"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "step_branch" ADD CONSTRAINT "step_branch_attribute_definition_id_attribute_definition_id_fk" FOREIGN KEY ("attribute_definition_id") REFERENCES "public"."attribute_definition"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "step_send" ADD CONSTRAINT "step_send_step_id_step_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."step"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "step_send" ADD CONSTRAINT "step_send_next_step_id_step_id_fk" FOREIGN KEY ("next_step_id") REFERENCES "public"."step"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "step_wait" ADD CONSTRAINT "step_wait_step_id_step_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."step"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "step_wait" ADD CONSTRAINT "step_wait_next_step_id_step_id_fk" FOREIGN KEY ("next_step_id") REFERENCES "public"."step"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_attribute" ADD CONSTRAINT "user_attribute_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_attribute" ADD CONSTRAINT "user_attribute_attribute_definition_id_attribute_definition_id_fk" FOREIGN KEY ("attribute_definition_id") REFERENCES "public"."attribute_definition"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow" ADD CONSTRAINT "workflow_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_enrollment" ADD CONSTRAINT "workflow_enrollment_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_enrollment" ADD CONSTRAINT "workflow_enrollment_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_enrollment" ADD CONSTRAINT "workflow_enrollment_current_step_id_step_id_fk" FOREIGN KEY ("current_step_id") REFERENCES "public"."step"("id") ON DELETE set null ON UPDATE no action;