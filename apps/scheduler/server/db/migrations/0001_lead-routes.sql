CREATE TABLE `lead_routes` (
	`form_response_id` text PRIMARY KEY NOT NULL,
	`qualify_lead_id` text NOT NULL,
	`routing_form_id` text NOT NULL,
	`matched_rule_id` text,
	`event_type_id` text NOT NULL,
	`host_email` text NOT NULL,
	`status` text DEFAULT 'routed' NOT NULL,
	`booking_uid` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`event_type_id`) REFERENCES `event_types`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `lead_routes_qualify_lead_idx` ON `lead_routes` (`qualify_lead_id`);