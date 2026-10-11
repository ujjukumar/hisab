CREATE TABLE `sms_pairing_invites` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`secret_hash` text NOT NULL UNIQUE,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`expires_at` text NOT NULL,
	`used_at` text,
	`device_id` integer,
	CONSTRAINT `fk_sms_pairing_invites_device_id_sms_devices_id_fk` FOREIGN KEY (`device_id`) REFERENCES `sms_devices`(`id`)
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_sms_devices` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`label` text NOT NULL,
	`installation_id` text,
	`token_hash` text UNIQUE,
	`claim_hash` text,
	`code` text,
	`token_ciphertext` text,
	`approved_at` text,
	`claimed_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`last_seen_at` text,
	`revoked_at` text
);
--> statement-breakpoint
INSERT INTO `__new_sms_devices`(`id`, `label`, `installation_id`, `token_hash`, `claim_hash`, `code`, `token_ciphertext`, `approved_at`, `claimed_at`, `created_at`, `last_seen_at`, `revoked_at`) SELECT `id`, `label`, `installation_id`, `token_hash`, `claim_hash`, `code`, `token_ciphertext`, `approved_at`, `claimed_at`, `created_at`, `last_seen_at`, `revoked_at` FROM `sms_devices`;--> statement-breakpoint
-- Migrations run in a transaction, where PRAGMA foreign_keys=OFF does nothing, so dropping
-- sms_devices would fail while messages point at it. Set the messages aside until it is rebuilt.
CREATE TEMP TABLE `__sms_messages_aside` AS SELECT * FROM `sms_messages`;--> statement-breakpoint
DELETE FROM `sms_messages`;--> statement-breakpoint
DROP TABLE `sms_devices`;--> statement-breakpoint
ALTER TABLE `__new_sms_devices` RENAME TO `sms_devices`;--> statement-breakpoint
INSERT INTO `sms_messages` SELECT * FROM `__sms_messages_aside`;--> statement-breakpoint
DROP TABLE `__sms_messages_aside`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `sms_devices_installation` ON `sms_devices` (`installation_id`);--> statement-breakpoint
CREATE INDEX `sms_devices_claim` ON `sms_devices` (`claim_hash`);