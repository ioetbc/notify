DROP TABLE "attribute_definition" CASCADE;--> statement-breakpoint
DROP TABLE "user_attribute" CASCADE;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "attributes" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
DROP TYPE "public"."attribute_type";