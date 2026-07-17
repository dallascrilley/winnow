CREATE TABLE "lead_routes" (
	"form_response_id" text PRIMARY KEY NOT NULL,
	"qualify_lead_id" text NOT NULL,
	"routing_form_id" text NOT NULL,
	"matched_rule_id" text,
	"event_type_id" text NOT NULL,
	"host_email" text NOT NULL,
	"status" text DEFAULT 'routed' NOT NULL,
	"booking_uid" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lead_routes" ADD CONSTRAINT "lead_routes_event_type_id_event_types_id_fk" FOREIGN KEY ("event_type_id") REFERENCES "public"."event_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lead_routes_qualify_lead_idx" ON "lead_routes" USING btree ("qualify_lead_id");