PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_tax_years` (
	`year` integer PRIMARY KEY,
	`gross_salary` integer,
	`salary_tds` integer,
	`other_tds` integer DEFAULT 0 NOT NULL,
	`tax_paid` integer DEFAULT 0 NOT NULL,
	`other_income` integer DEFAULT 0 NOT NULL,
	`interest_override` integer,
	`dividend_override` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_tax_years`(`year`, `gross_salary`, `salary_tds`, `other_tds`, `tax_paid`, `other_income`, `interest_override`, `dividend_override`, `created_at`, `updated_at`) SELECT `year`, NULLIF(`gross_salary`, 0), NULLIF(`salary_tds`, 0), `other_tds`, `tax_paid`, `other_income`, `interest_override`, `dividend_override`, `created_at`, `updated_at` FROM `tax_years`;--> statement-breakpoint
DROP TABLE `tax_years`;--> statement-breakpoint
ALTER TABLE `__new_tax_years` RENAME TO `tax_years`;--> statement-breakpoint
PRAGMA foreign_keys=ON;