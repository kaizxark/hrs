CREATE TABLE `audit_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`action` varchar(64) NOT NULL,
	`actionLabel` varchar(128) NOT NULL,
	`actor_id` int,
	`actorOpenId` varchar(64),
	`actorName` text,
	`actorRole` enum('user','admin') NOT NULL DEFAULT 'admin',
	`targetType` varchar(32),
	`targetId` varchar(128),
	`details` json,
	`success` boolean NOT NULL DEFAULT true,
	`ipAddress` varchar(45),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `audit_logs_id` PRIMARY KEY(`id`)
);--> statement-breakpoint
CREATE INDEX `action_idx` ON `audit_logs` (`action`,`createdAt`);--> statement-breakpoint
CREATE INDEX `created_idx` ON `audit_logs` (`createdAt`);