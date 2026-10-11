CREATE TABLE `sms_devices` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`label` text NOT NULL,
	`installation_id` text,
	`token_hash` text NOT NULL UNIQUE,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`last_seen_at` text,
	`revoked_at` text
);
--> statement-breakpoint
CREATE TABLE `sms_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`device_id` integer NOT NULL,
	`provider_message_id` text,
	`sender` text NOT NULL,
	`received_at` text NOT NULL,
	`content_hash` text NOT NULL,
	`raw_ciphertext` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`parser_version` text NOT NULL,
	`provider_key` text,
	`direction` text,
	`amount` integer,
	`transaction_date` text,
	`reference` text,
	`proposed_account_id` integer,
	`proposed_category_id` integer,
	`transaction_id` integer,
	`reason` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	CONSTRAINT `fk_sms_messages_device_id_sms_devices_id_fk` FOREIGN KEY (`device_id`) REFERENCES `sms_devices`(`id`),
	CONSTRAINT `fk_sms_messages_proposed_account_id_accounts_id_fk` FOREIGN KEY (`proposed_account_id`) REFERENCES `accounts`(`id`),
	CONSTRAINT `fk_sms_messages_proposed_category_id_categories_id_fk` FOREIGN KEY (`proposed_category_id`) REFERENCES `categories`(`id`),
	CONSTRAINT `fk_sms_messages_transaction_id_transactions_id_fk` FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`)
);
--> statement-breakpoint
CREATE TABLE `sms_rules` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`name` text NOT NULL,
	`sender_pattern` text NOT NULL,
	`provider_key` text NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`account_id` integer NOT NULL,
	`income_category_id` integer,
	`expense_category_id` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	CONSTRAINT `fk_sms_rules_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`),
	CONSTRAINT `fk_sms_rules_income_category_id_categories_id_fk` FOREIGN KEY (`income_category_id`) REFERENCES `categories`(`id`),
	CONSTRAINT `fk_sms_rules_expense_category_id_categories_id_fk` FOREIGN KEY (`expense_category_id`) REFERENCES `categories`(`id`)
);
--> statement-breakpoint
CREATE INDEX `sms_devices_installation` ON `sms_devices` (`installation_id`);--> statement-breakpoint
CREATE INDEX `sms_messages_status` ON `sms_messages` (`status`);--> statement-breakpoint
CREATE INDEX `sms_messages_hash` ON `sms_messages` (`content_hash`);--> statement-breakpoint
CREATE INDEX `sms_messages_provider_id` ON `sms_messages` (`device_id`,`provider_message_id`);--> statement-breakpoint
CREATE INDEX `sms_rules_provider` ON `sms_rules` (`provider_key`);--> statement-breakpoint
CREATE INDEX `sms_rules_sender` ON `sms_rules` (`sender_pattern`);