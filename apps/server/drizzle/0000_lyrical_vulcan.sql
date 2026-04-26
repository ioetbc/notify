CREATE TYPE "public"."enrollment_status" AS ENUM('active', 'completed', 'exited');--> statement-breakpoint
CREATE TYPE "public"."gender" AS ENUM('male', 'female', 'other');--> statement-breakpoint
CREATE TYPE "public"."step_type" AS ENUM('wait', 'branch', 'send', 'filter');--> statement-breakpoint
CREATE TYPE "public"."trigger_type" AS ENUM('system', 'custom');--> statement-breakpoint
CREATE TYPE "public"."workflow_status" AS ENUM('draft', 'active', 'paused', 'archived');--> statement-breakpoint
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
CREATE TABLE "event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"event_name" text NOT NULL,
	"properties" jsonb,
	"timestamp" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "step" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" uuid NOT NULL,
	"type" "step_type" NOT NULL,
	"config" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "step_edge" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" uuid NOT NULL,
	"source" uuid NOT NULL,
	"target" uuid NOT NULL,
	"handle" boolean
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"gender" "gender",
	"phone" text,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "user_customer_id_external_id_unique" UNIQUE("customer_id","external_id")
);
--> statement-breakpoint
CREATE TABLE "workflow" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"name" text NOT NULL,
	"trigger_type" "trigger_type" NOT NULL,
	"trigger_event" text NOT NULL,
	"status" "workflow_status" DEFAULT 'draft' NOT NULL,
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
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "step" ADD CONSTRAINT "step_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "step_edge" ADD CONSTRAINT "step_edge_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "step_edge" ADD CONSTRAINT "step_edge_source_step_id_fk" FOREIGN KEY ("source") REFERENCES "public"."step"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "step_edge" ADD CONSTRAINT "step_edge_target_step_id_fk" FOREIGN KEY ("target") REFERENCES "public"."step"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow" ADD CONSTRAINT "workflow_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_enrollment" ADD CONSTRAINT "workflow_enrollment_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_enrollment" ADD CONSTRAINT "workflow_enrollment_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_enrollment" ADD CONSTRAINT "workflow_enrollment_current_step_id_step_id_fk" FOREIGN KEY ("current_step_id") REFERENCES "public"."step"("id") ON DELETE set null ON UPDATE no action;