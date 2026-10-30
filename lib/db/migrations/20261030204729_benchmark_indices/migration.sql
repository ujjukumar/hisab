DELETE FROM `benchmark_prices`;--> statement-breakpoint
DELETE FROM `benchmarks` WHERE `isin` NOT IN ('INF789F01XA0', 'INF179K01WN9');--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_benchmarks` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`name` text NOT NULL,
	`code` text NOT NULL UNIQUE,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_benchmarks`(`id`, `name`, `code`, `created_at`, `updated_at`) SELECT `id`, CASE `isin` WHEN 'INF789F01XA0' THEN 'Nifty 50' ELSE 'Sensex' END, CASE `isin` WHEN 'INF789F01XA0' THEN 'nifty50' ELSE 'sensex' END, `created_at`, `updated_at` FROM `benchmarks`;--> statement-breakpoint
DROP TABLE `benchmarks`;--> statement-breakpoint
ALTER TABLE `__new_benchmarks` RENAME TO `benchmarks`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
