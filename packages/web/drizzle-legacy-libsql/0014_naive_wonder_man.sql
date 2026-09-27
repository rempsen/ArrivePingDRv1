CREATE TABLE `deficiencies` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text DEFAULT 'default' NOT NULL,
	`project_id` text NOT NULL,
	`booking_id` text NOT NULL,
	`external_id` text NOT NULL,
	`floor` text DEFAULT '' NOT NULL,
	`location` text DEFAULT '' NOT NULL,
	`area` text DEFAULT '' NOT NULL,
	`material` text DEFAULT '' NOT NULL,
	`issue_type` text DEFAULT '' NOT NULL,
	`assessment` text DEFAULT '' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`trade_name` text DEFAULT '' NOT NULL,
	`rider_id` text,
	`due_date` integer,
	`status` text DEFAULT 'open' NOT NULL,
	`photos_before` text DEFAULT '[]' NOT NULL,
	`photos_after` text DEFAULT '[]' NOT NULL,
	`technician_notes` text DEFAULT '' NOT NULL,
	`completed_at` integer,
	`sign_off_name` text DEFAULT '' NOT NULL,
	`sign_off_at` integer,
	`source_updated_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `punchlist_projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`booking_id`) REFERENCES `bookings`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`rider_id`) REFERENCES `riders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `defic_company_idx` ON `deficiencies` (`company_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `defic_ext_unique` ON `deficiencies` (`company_id`,`external_id`);--> statement-breakpoint
CREATE INDEX `defic_booking_idx` ON `deficiencies` (`booking_id`);--> statement-breakpoint
CREATE INDEX `defic_poll_idx` ON `deficiencies` (`company_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `punchlist_projects` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text DEFAULT 'default' NOT NULL,
	`external_id` text NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`address` text DEFAULT '' NOT NULL,
	`booking_id` text NOT NULL,
	`customer_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`booking_id`) REFERENCES `bookings`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`customer_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `plproj_company_idx` ON `punchlist_projects` (`company_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `plproj_ext_unique` ON `punchlist_projects` (`company_id`,`external_id`);--> statement-breakpoint
CREATE TABLE `punchlist_trades` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text DEFAULT 'default' NOT NULL,
	`external_trade_key` text NOT NULL,
	`trade_name` text DEFAULT '' NOT NULL,
	`rider_id` text NOT NULL,
	`contact_email` text DEFAULT '' NOT NULL,
	`contact_phone` text DEFAULT '' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`rider_id`) REFERENCES `riders`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `pltrade_company_idx` ON `punchlist_trades` (`company_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `pltrade_key_unique` ON `punchlist_trades` (`company_id`,`external_trade_key`);