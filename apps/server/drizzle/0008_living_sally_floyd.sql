CREATE TYPE "public"."integration_provider" AS ENUM('posthog');--> statement-breakpoint
CREATE TABLE "customer_integration" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"provider" "integration_provider" NOT NULL,
	"config" jsonb NOT NULL,
	"connected_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "customer_integration_customer_id_provider_unique" UNIQUE("customer_id","provider")
);
--> statement-breakpoint
ALTER TABLE "customer_integration" ADD CONSTRAINT "customer_integration_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE cascade ON UPDATE no action;