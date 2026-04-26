CREATE TABLE "communication_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"step_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"config" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "communication_log" ADD CONSTRAINT "communication_log_enrollment_id_workflow_enrollment_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."workflow_enrollment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communication_log" ADD CONSTRAINT "communication_log_step_id_step_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."step"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communication_log" ADD CONSTRAINT "communication_log_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;