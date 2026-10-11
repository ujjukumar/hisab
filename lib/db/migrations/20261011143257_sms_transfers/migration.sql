ALTER TABLE `sms_messages` ADD `proposed_to_account_id` integer REFERENCES accounts(id);--> statement-breakpoint
ALTER TABLE `sms_rules` ADD `income_transfer_account_id` integer REFERENCES accounts(id);--> statement-breakpoint
ALTER TABLE `sms_rules` ADD `expense_transfer_account_id` integer REFERENCES accounts(id);