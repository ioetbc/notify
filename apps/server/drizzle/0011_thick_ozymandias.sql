CREATE TABLE "customer_event_definition" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"integration_id" uuid NOT NULL,
	"provider" "integration_provider" NOT NULL,
	"event_name" text NOT NULL,
	"volume" integer,
	"active" boolean DEFAULT true NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now(),
	"last_seen_at" timestamp with time zone DEFAULT now(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "customer_event_definition_integration_id_event_name_unique" UNIQUE("integration_id","event_name")
);
--> statement-breakpoint
ALTER TABLE "event" ADD COLUMN "event_definition_id" uuid;--> statement-breakpoint
ALTER TABLE "event" ADD COLUMN "external_id" text;--> statement-breakpoint
UPDATE "event"
SET "external_id" = "user"."external_id"
FROM "user"
WHERE "event"."user_id" = "user"."id";--> statement-breakpoint
ALTER TABLE "event" ALTER COLUMN "external_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "event" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_event_definition" ADD CONSTRAINT "customer_event_definition_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_event_definition" ADD CONSTRAINT "customer_event_definition_integration_id_customer_integration_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."customer_integration"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_event_definition_id_customer_event_definition_id_fk" FOREIGN KEY ("event_definition_id") REFERENCES "public"."customer_event_definition"("id") ON DELETE set null ON UPDATE no action;
