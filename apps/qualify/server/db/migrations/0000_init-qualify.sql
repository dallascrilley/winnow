CREATE TABLE `eval_cases` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`input` text NOT NULL,
	`expected_tier` text NOT NULL,
	`expected_segment` text NOT NULL,
	`expected_should_route` integer NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `eval_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`model` text NOT NULL,
	`prompt_hash` text NOT NULL,
	`case_count` integer NOT NULL,
	`pass_count` integer NOT NULL,
	`accuracy` real NOT NULL,
	`total_cost_usd` real NOT NULL,
	`results` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `firmographics` (
	`domain` text PRIMARY KEY NOT NULL,
	`company_name` text NOT NULL,
	`industry` text NOT NULL,
	`employees` integer NOT NULL,
	`revenue_band` text NOT NULL,
	`hq` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `leads` (
	`id` text PRIMARY KEY NOT NULL,
	`form_response_id` text,
	`email` text NOT NULL,
	`name` text,
	`company_size` text,
	`message` text,
	`status` text DEFAULT 'new' NOT NULL,
	`status_token` text NOT NULL,
	`enrichment` text,
	`fit_score` real,
	`tier` text,
	`segment` text,
	`score_reasoning` text,
	`proposal` text,
	`llm_prompt_tokens` integer DEFAULT 0 NOT NULL,
	`llm_completion_tokens` integer DEFAULT 0 NOT NULL,
	`llm_cost_usd` real DEFAULT 0 NOT NULL,
	`llm_model` text,
	`audit` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`owner_email` text DEFAULT 'local@localhost' NOT NULL,
	`org_id` text,
	`visibility` text DEFAULT 'private' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `leads_status_token_unique` ON `leads` (`status_token`);--> statement-breakpoint
CREATE INDEX `leads_email_idx` ON `leads` (`email`);--> statement-breakpoint
CREATE INDEX `leads_status_idx` ON `leads` (`status`);--> statement-breakpoint
CREATE INDEX `leads_form_response_idx` ON `leads` (`form_response_id`);--> statement-breakpoint
CREATE TABLE `qualify_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL
);
