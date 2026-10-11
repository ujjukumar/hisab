PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_sms_devices` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`label` text NOT NULL,
	`installation_id` text,
	`token_hash` text UNIQUE,
	`claim_hash` text NOT NULL,
	`code` text NOT NULL,
	`token_ciphertext` text,
	`approved_at` text,
	`claimed_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`last_seen_at` text,
	`revoked_at` text
);
--> statement-breakpoint
INSERT INTO `__new_sms_devices`(`id`, `label`, `installation_id`, `token_hash`, `claim_hash`, `code`, `approved_at`, `claimed_at`, `created_at`, `last_seen_at`, `revoked_at`) SELECT `id`, `label`, `installation_id`, `token_hash`, 'migrated-' || `id`, 'MIGRATED', `created_at`, `created_at`, `created_at`, `last_seen_at`, `revoked_at` FROM `sms_devices`;--> statement-breakpoint
DROP TABLE `sms_devices`;--> statement-breakpoint
ALTER TABLE `__new_sms_devices` RENAME TO `sms_devices`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `sms_devices_installation` ON `sms_devices` (`installation_id`);--> statement-breakpoint
CREATE INDEX `sms_devices_claim` ON `sms_devices` (`claim_hash`);--> statement-breakpoint
DELETE FROM `settings` WHERE `key` = 'sms_pairing_key';
