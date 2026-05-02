CREATE TYPE "public"."delivery_provider" AS ENUM('expo');--> statement-breakpoint
CREATE TYPE "public"."dispatch_status" AS ENUM('dispatched', 'delivered', 'undelivered', 'expired');--> statement-breakpoint
CREATE TABLE "dispatch" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"communication_log_id" uuid NOT NULL,
	"provider" "delivery_provider" NOT NULL,
	"token" text NOT NULL,
	"status" "dispatch_status" NOT NULL,
	"ack_id" text,
	"ack" jsonb NOT NULL,
	"receipt" jsonb,
	"receipts_polled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "dispatch_communication_log_id_token_unique" UNIQUE("communication_log_id","token")
);
--> statement-breakpoint
ALTER TABLE "communication_log" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "communication_log" ALTER COLUMN "status" SET DEFAULT 'dispatched'::text;--> statement-breakpoint
DROP TYPE "public"."communication_status";--> statement-breakpoint
CREATE TYPE "public"."communication_status" AS ENUM('claimed', 'dispatched', 'failed');--> statement-breakpoint
ALTER TABLE "communication_log" ALTER COLUMN "status" SET DEFAULT 'dispatched'::"public"."communication_status";--> statement-breakpoint
ALTER TABLE "communication_log" ALTER COLUMN "status" SET DATA TYPE "public"."communication_status" USING "status"::"public"."communication_status";--> statement-breakpoint
ALTER TABLE "dispatch" ADD CONSTRAINT "dispatch_communication_log_id_communication_log_id_fk" FOREIGN KEY ("communication_log_id") REFERENCES "public"."communication_log"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communication_log" DROP COLUMN "expo_tickets";