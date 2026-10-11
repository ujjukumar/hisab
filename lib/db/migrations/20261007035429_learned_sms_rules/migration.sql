ALTER TABLE `sms_messages` ADD `sender_pattern` text;--> statement-breakpoint
ALTER TABLE `sms_messages` ADD `template_fingerprint` text;--> statement-breakpoint
ALTER TABLE `sms_rules` ADD `template_fingerprint` text NOT NULL DEFAULT '';