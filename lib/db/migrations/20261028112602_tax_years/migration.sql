CREATE TABLE `tax_years` (
	`year` integer PRIMARY KEY,
	`gross_salary` integer DEFAULT 0 NOT NULL,
	`salary_tds` integer DEFAULT 0 NOT NULL,
	`other_tds` integer DEFAULT 0 NOT NULL,
	`tax_paid` integer DEFAULT 0 NOT NULL,
	`other_income` integer DEFAULT 0 NOT NULL,
	`interest_override` integer,
	`dividend_override` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
