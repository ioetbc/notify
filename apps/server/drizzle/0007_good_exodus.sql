ALTER TABLE "dispatch" ADD COLUMN "error" jsonb;--> statement-breakpoint
ALTER TABLE "dispatch" DROP COLUMN "ack";