ALTER TABLE `sms_messages` ADD `rule_id` integer REFERENCES sms_rules(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `sms_messages` ADD `decided_by` text;--> statement-breakpoint
ALTER TABLE `sms_messages` ADD `decided_at` text;--> statement-breakpoint
CREATE INDEX `sms_messages_rule` ON `sms_messages` (`rule_id`);--> statement-breakpoint
-- Backfill outcomes. Automatic imports were the only imported rows saved without a reason.
UPDATE `sms_messages` SET `decided_by` = CASE WHEN `status` = 'imported' AND `reason` IS NULL THEN 'rule' ELSE 'owner' END, `decided_at` = `updated_at` WHERE `status` IN ('imported', 'rejected');--> statement-breakpoint
-- Rules taught while approving left the reason 'Learned rule N.'.
UPDATE `sms_messages` SET `rule_id` = (SELECT `sms_rules`.`id` FROM `sms_rules` WHERE `sms_rules`.`id` = CAST(substr(`sms_messages`.`reason`, 14, length(`sms_messages`.`reason`) - 14) AS INTEGER)) WHERE `status` = 'imported' AND `reason` LIKE 'Learned rule %.';--> statement-breakpoint
-- Automatic imports match their rule on the exact sender and wording.
UPDATE `sms_messages` SET `rule_id` = (SELECT `sms_rules`.`id` FROM `sms_rules` WHERE `sms_rules`.`sender_pattern` = `sms_messages`.`sender_pattern` AND `sms_rules`.`template_fingerprint` = `sms_messages`.`template_fingerprint` ORDER BY `sms_rules`.`id` LIMIT 1) WHERE `decided_by` = 'rule' AND `rule_id` IS NULL;
