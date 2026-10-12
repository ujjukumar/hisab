CREATE TABLE `benchmark_prices` (
	`benchmark_id` integer NOT NULL,
	`date` text NOT NULL,
	`price` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	CONSTRAINT `benchmark_prices_pk` PRIMARY KEY(`benchmark_id`, `date`),
	CONSTRAINT `fk_benchmark_prices_benchmark_id_benchmarks_id_fk` FOREIGN KEY (`benchmark_id`) REFERENCES `benchmarks`(`id`)
);
--> statement-breakpoint
CREATE TABLE `benchmarks` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`name` text NOT NULL,
	`isin` text NOT NULL UNIQUE,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
