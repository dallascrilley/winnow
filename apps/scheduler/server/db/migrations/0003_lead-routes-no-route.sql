PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_lead_routes` (
	`form_response_id` text PRIMARY KEY NOT NULL,
	`qualify_lead_id` text NOT NULL,
	`routing_form_id` text NOT NULL,
	`matched_rule_id` text,
	`event_type_id` text,
	`host_email` text,
	`status` text DEFAULT 'routed' NOT NULL,
	`booking_uid` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`event_type_id`) REFERENCES `event_types`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_lead_routes`("form_response_id", "qualify_lead_id", "routing_form_id", "matched_rule_id", "event_type_id", "host_email", "status", "booking_uid", "created_at", "updated_at") SELECT "form_response_id", "qualify_lead_id", "routing_form_id", "matched_rule_id", "event_type_id", "host_email", "status", "booking_uid", "created_at", "updated_at" FROM `lead_routes`;--> statement-breakpoint
DROP TABLE `lead_routes`;--> statement-breakpoint
ALTER TABLE `__new_lead_routes` RENAME TO `lead_routes`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `lead_routes_qualify_lead_idx` ON `lead_routes` (`qualify_lead_id`);