CREATE TABLE `event_type_host_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`event_type_id` text NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `event_type_hosts` (
	`event_type_id` text NOT NULL,
	`user_email` text NOT NULL,
	`is_fixed` integer DEFAULT false NOT NULL,
	`weight` integer DEFAULT 1 NOT NULL,
	`priority` integer DEFAULT 2 NOT NULL,
	`schedule_id` text,
	`group_id` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `event_type_shares` (
	`id` text PRIMARY KEY NOT NULL,
	`resource_id` text NOT NULL,
	`principal_type` text NOT NULL,
	`principal_id` text NOT NULL,
	`role` text DEFAULT 'viewer' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `event_type_slug_redirects` (
	`old_key` text PRIMARY KEY NOT NULL,
	`new_key` text NOT NULL,
	`event_type_id` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `event_types` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`slug` text NOT NULL,
	`description` text,
	`length` integer DEFAULT 30 NOT NULL,
	`durations` text,
	`position` integer DEFAULT 0 NOT NULL,
	`hidden` integer DEFAULT false NOT NULL,
	`color` text,
	`scheduling_type` text DEFAULT 'personal' NOT NULL,
	`team_id` text,
	`locations` text,
	`custom_fields` text,
	`schedule_id` text,
	`minimum_booking_notice` integer DEFAULT 0 NOT NULL,
	`before_event_buffer` integer DEFAULT 0 NOT NULL,
	`after_event_buffer` integer DEFAULT 0 NOT NULL,
	`slot_interval` integer,
	`period_type` text DEFAULT 'rolling' NOT NULL,
	`period_days` integer DEFAULT 60,
	`period_start_date` text,
	`period_end_date` text,
	`seats_per_time_slot` integer,
	`requires_confirmation` integer DEFAULT false NOT NULL,
	`disable_guests` integer DEFAULT false NOT NULL,
	`hide_calendar_notes` integer DEFAULT false NOT NULL,
	`success_redirect_url` text,
	`booking_limits` text,
	`lock_time_zone_toggle` integer DEFAULT false NOT NULL,
	`recurring_event` text,
	`event_name` text,
	`metadata` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`owner_email` text DEFAULT 'local@localhost' NOT NULL,
	`org_id` text,
	`visibility` text DEFAULT 'private' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `hashed_links` (
	`id` text PRIMARY KEY NOT NULL,
	`hash` text NOT NULL,
	`event_type_id` text NOT NULL,
	`expires_at` text,
	`is_single_use` integer DEFAULT false NOT NULL,
	`used_at` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `hashed_links_hash_unique` ON `hashed_links` (`hash`);--> statement-breakpoint
CREATE TABLE `date_overrides` (
	`id` text PRIMARY KEY NOT NULL,
	`schedule_id` text NOT NULL,
	`date` text NOT NULL,
	`intervals` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `out_of_office_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`user_email` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`reason` text,
	`notes` text,
	`redirect_user_email` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `schedule_availability` (
	`id` text PRIMARY KEY NOT NULL,
	`schedule_id` text NOT NULL,
	`day` integer NOT NULL,
	`start_time` text NOT NULL,
	`end_time` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `schedule_shares` (
	`id` text PRIMARY KEY NOT NULL,
	`resource_id` text NOT NULL,
	`principal_type` text NOT NULL,
	`principal_id` text NOT NULL,
	`role` text DEFAULT 'viewer' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `schedules` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`timezone` text DEFAULT 'UTC' NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`owner_email` text DEFAULT 'local@localhost' NOT NULL,
	`org_id` text,
	`visibility` text DEFAULT 'private' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `travel_schedules` (
	`id` text PRIMARY KEY NOT NULL,
	`user_email` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`timezone` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `booking_attendees` (
	`id` text PRIMARY KEY NOT NULL,
	`booking_id` text NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`timezone` text,
	`locale` text,
	`no_show` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `booking_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`booking_id` text NOT NULL,
	`author_email` text NOT NULL,
	`content` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `booking_references` (
	`id` text PRIMARY KEY NOT NULL,
	`booking_id` text NOT NULL,
	`type` text NOT NULL,
	`external_id` text NOT NULL,
	`meeting_url` text,
	`meeting_password` text,
	`credential_id` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `booking_seats` (
	`id` text PRIMARY KEY NOT NULL,
	`booking_id` text NOT NULL,
	`attendee_id` text NOT NULL,
	`reference_uid` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `booking_seats_reference_uid_unique` ON `booking_seats` (`reference_uid`);--> statement-breakpoint
CREATE TABLE `booking_shares` (
	`id` text PRIMARY KEY NOT NULL,
	`resource_id` text NOT NULL,
	`principal_type` text NOT NULL,
	`principal_id` text NOT NULL,
	`role` text DEFAULT 'viewer' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `bookings` (
	`id` text PRIMARY KEY NOT NULL,
	`uid` text NOT NULL,
	`event_type_id` text NOT NULL,
	`host_email` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`start_time` text NOT NULL,
	`end_time` text NOT NULL,
	`timezone` text DEFAULT 'UTC' NOT NULL,
	`status` text DEFAULT 'confirmed' NOT NULL,
	`location` text,
	`custom_responses` text,
	`cancel_token` text,
	`reschedule_token` text,
	`from_reschedule` text,
	`cancellation_reason` text,
	`rescheduling_reason` text,
	`ical_uid` text NOT NULL,
	`ical_sequence` integer DEFAULT 0 NOT NULL,
	`recurring_event_id` text,
	`paid` integer DEFAULT false NOT NULL,
	`no_show_host` integer DEFAULT false NOT NULL,
	`metadata` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`owner_email` text DEFAULT 'local@localhost' NOT NULL,
	`org_id` text,
	`visibility` text DEFAULT 'private' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bookings_uid_unique` ON `bookings` (`uid`);--> statement-breakpoint
CREATE TABLE `team_members` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`user_email` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`accepted` integer DEFAULT false NOT NULL,
	`invite_token` text,
	`invited_at` text NOT NULL,
	`joined_at` text
);
--> statement-breakpoint
CREATE TABLE `team_shares` (
	`id` text PRIMARY KEY NOT NULL,
	`resource_id` text NOT NULL,
	`principal_type` text NOT NULL,
	`principal_id` text NOT NULL,
	`role` text DEFAULT 'viewer' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `teams` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`logo_url` text,
	`brand_color` text,
	`dark_brand_color` text,
	`bio` text,
	`hide_branding` integer DEFAULT false NOT NULL,
	`metadata` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`owner_email` text DEFAULT 'local@localhost' NOT NULL,
	`org_id` text,
	`visibility` text DEFAULT 'private' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `teams_slug_unique` ON `teams` (`slug`);--> statement-breakpoint
CREATE TABLE `destination_calendars` (
	`id` text PRIMARY KEY NOT NULL,
	`credential_id` text NOT NULL,
	`user_email` text NOT NULL,
	`integration` text NOT NULL,
	`external_id` text NOT NULL,
	`primary_email` text,
	`event_type_id` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `scheduling_credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`user_email` text,
	`team_id` text,
	`app_id` text,
	`oauth_token_id` text,
	`display_name` text,
	`external_email` text,
	`invalid` integer DEFAULT false NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `selected_calendars` (
	`id` text PRIMARY KEY NOT NULL,
	`credential_id` text NOT NULL,
	`user_email` text NOT NULL,
	`external_id` text NOT NULL,
	`integration` text NOT NULL,
	`event_type_id` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `verified_emails` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`user_email` text,
	`team_id` text,
	`verified_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `verified_numbers` (
	`id` text PRIMARY KEY NOT NULL,
	`phone_number` text NOT NULL,
	`user_email` text,
	`team_id` text,
	`verified_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `calendar_cache` (
	`id` text PRIMARY KEY NOT NULL,
	`credential_id` text NOT NULL,
	`cache_key` text NOT NULL,
	`window_start` text NOT NULL,
	`window_end` text NOT NULL,
	`busy_json` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_cache_cache_key_unique` ON `calendar_cache` (`cache_key`);--> statement-breakpoint
CREATE TABLE `api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`hashed_key` text NOT NULL,
	`note` text,
	`user_email` text,
	`team_id` text,
	`expires_at` text,
	`last_used_at` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_keys_hashed_key_unique` ON `api_keys` (`hashed_key`);--> statement-breakpoint
CREATE TABLE `scheduled_reminders` (
	`id` text PRIMARY KEY NOT NULL,
	`booking_id` text NOT NULL,
	`workflow_step_id` text NOT NULL,
	`method` text NOT NULL,
	`scheduled_for` text NOT NULL,
	`sent` integer DEFAULT false NOT NULL,
	`sent_at` text,
	`failed` integer DEFAULT false NOT NULL,
	`failure_reason` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `webhook_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`webhook_id` text NOT NULL,
	`triggered_at` text NOT NULL,
	`payload` text NOT NULL,
	`response_status` integer,
	`response_body` text,
	`success` integer DEFAULT false NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `webhooks` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`subscriber_url` text NOT NULL,
	`secret` text,
	`active` integer DEFAULT true NOT NULL,
	`event_triggers` text DEFAULT '[]' NOT NULL,
	`team_id` text,
	`event_type_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`owner_email` text DEFAULT 'local@localhost' NOT NULL,
	`org_id` text,
	`visibility` text DEFAULT 'private' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `workflow_shares` (
	`id` text PRIMARY KEY NOT NULL,
	`resource_id` text NOT NULL,
	`principal_type` text NOT NULL,
	`principal_id` text NOT NULL,
	`role` text DEFAULT 'viewer' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `workflow_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`workflow_id` text NOT NULL,
	`order` integer DEFAULT 0 NOT NULL,
	`action` text NOT NULL,
	`offset_minutes` integer DEFAULT 0 NOT NULL,
	`send_to` text,
	`email_subject` text,
	`email_body` text,
	`sms_body` text,
	`webhook_url` text,
	`template` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `workflows` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`trigger` text NOT NULL,
	`team_id` text,
	`disabled` integer DEFAULT false NOT NULL,
	`active_on_event_type_ids` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`owner_email` text DEFAULT 'local@localhost' NOT NULL,
	`org_id` text,
	`visibility` text DEFAULT 'private' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `routing_form_responses` (
	`id` text PRIMARY KEY NOT NULL,
	`form_id` text NOT NULL,
	`response` text NOT NULL,
	`booking_id` text,
	`matched_rule_id` text,
	`routed_to` text,
	`submitter_email` text,
	`submitter_ip` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `routing_form_shares` (
	`id` text PRIMARY KEY NOT NULL,
	`resource_id` text NOT NULL,
	`principal_type` text NOT NULL,
	`principal_id` text NOT NULL,
	`role` text DEFAULT 'viewer' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `routing_forms` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`team_id` text,
	`disabled` integer DEFAULT false NOT NULL,
	`fields` text DEFAULT '[]' NOT NULL,
	`rules` text DEFAULT '[]' NOT NULL,
	`fallback` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`owner_email` text DEFAULT 'local@localhost' NOT NULL,
	`org_id` text,
	`visibility` text DEFAULT 'private' NOT NULL
);
