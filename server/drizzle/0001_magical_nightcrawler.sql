CREATE TYPE "public"."workflow_status" AS ENUM('draft', 'active', 'paused', 'archived');--> statement-breakpoint
ALTER TABLE "workflow" ADD COLUMN "status" "workflow_status" DEFAULT 'draft' NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow" DROP COLUMN "active";