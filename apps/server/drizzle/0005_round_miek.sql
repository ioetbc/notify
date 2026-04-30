CREATE TYPE "public"."communication_status" AS ENUM('claimed', 'sent', 'failed');--> statement-breakpoint
ALTER TABLE "communication_log" ADD COLUMN "status" "communication_status" DEFAULT 'sent' NOT NULL;--> statement-breakpoint
ALTER TABLE "communication_log" ADD COLUMN "expo_tickets" jsonb;--> statement-breakpoint
ALTER TABLE "communication_log" ADD COLUMN "error" text;--> statement-breakpoint
ALTER TABLE "communication_log" ADD COLUMN "sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "communication_log" ADD CONSTRAINT "communication_log_enrollment_id_step_id_unique" UNIQUE("enrollment_id","step_id");