ALTER TABLE `Plan`
  ADD COLUMN `code` VARCHAR(32) NULL,
  ADD COLUMN `version` INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN `trialDays` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `isPublic` BOOLEAN NOT NULL DEFAULT true;

UPDATE `Plan` SET `code` = UPPER(`slug`);
ALTER TABLE `Plan` MODIFY `code` VARCHAR(32) NOT NULL;
CREATE UNIQUE INDEX `Plan_code_version_key` ON `Plan`(`code`, `version`);
CREATE INDEX `Plan_code_status_isPublic_idx` ON `Plan`(`code`, `status`, `isPublic`);

ALTER TABLE `Subscription` MODIFY `status` ENUM('TRIAL', 'TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'EXPIRED', 'SUSPENDED') NOT NULL DEFAULT 'TRIALING';
UPDATE `Subscription` SET `status` = 'TRIALING' WHERE `status` = 'TRIAL';
ALTER TABLE `Subscription` MODIFY `status` ENUM('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'EXPIRED', 'SUSPENDED') NOT NULL DEFAULT 'TRIALING';
ALTER TABLE `Subscription`
  ADD COLUMN `cancelAtPeriodEnd` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `endedAt` DATETIME(3) NULL;

ALTER TABLE `StorageUsage` ADD COLUMN `reservedBytes` BIGINT NOT NULL DEFAULT 0;

CREATE TABLE `SubscriptionHistory` (
  `id` CHAR(36) NOT NULL,
  `organizationId` CHAR(36) NOT NULL,
  `subscriptionId` CHAR(36) NOT NULL,
  `planId` CHAR(36) NOT NULL,
  `planCode` VARCHAR(32) NOT NULL,
  `planVersion` INTEGER NOT NULL,
  `status` ENUM('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'EXPIRED', 'SUSPENDED') NOT NULL,
  `reason` VARCHAR(100) NOT NULL,
  `limitsSnapshot` JSON NOT NULL,
  `featuresSnapshot` JSON NOT NULL,
  `periodStart` DATETIME(3) NOT NULL,
  `periodEnd` DATETIME(3) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `SubscriptionHistory_organizationId_createdAt_idx`(`organizationId`, `createdAt`),
  INDEX `SubscriptionHistory_subscriptionId_createdAt_idx`(`subscriptionId`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ResourceCounter` (
  `id` CHAR(36) NOT NULL,
  `organizationId` CHAR(36) NOT NULL,
  `cameraCount` INTEGER NOT NULL DEFAULT 0,
  `memberCount` INTEGER NOT NULL DEFAULT 0,
  `version` INTEGER NOT NULL DEFAULT 0,
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `ResourceCounter_organizationId_key`(`organizationId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `LimitEvent` (
  `id` CHAR(36) NOT NULL,
  `organizationId` CHAR(36) NOT NULL,
  `type` VARCHAR(64) NOT NULL,
  `resource` VARCHAR(32) NOT NULL,
  `threshold` INTEGER NULL,
  `currentValue` BIGINT NOT NULL,
  `limitValue` BIGINT NOT NULL,
  `metadata` JSON NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `LimitEvent_organizationId_resource_createdAt_idx`(`organizationId`, `resource`, `createdAt`),
  INDEX `LimitEvent_type_createdAt_idx`(`type`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `SubscriptionHistory` ADD CONSTRAINT `SubscriptionHistory_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `SubscriptionHistory` ADD CONSTRAINT `SubscriptionHistory_subscriptionId_fkey` FOREIGN KEY (`subscriptionId`) REFERENCES `Subscription`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `SubscriptionHistory` ADD CONSTRAINT `SubscriptionHistory_planId_fkey` FOREIGN KEY (`planId`) REFERENCES `Plan`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `ResourceCounter` ADD CONSTRAINT `ResourceCounter_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `LimitEvent` ADD CONSTRAINT `LimitEvent_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO `ResourceCounter` (`id`, `organizationId`, `cameraCount`, `memberCount`, `version`, `updatedAt`)
SELECT UUID(), o.`id`,
  (SELECT COUNT(*) FROM `Camera` c WHERE c.`organizationId` = o.`id` AND c.`deletedAt` IS NULL),
  ((SELECT COUNT(*) FROM `OrganizationMembership` m WHERE m.`organizationId` = o.`id` AND m.`status` <> 'REMOVED') +
   (SELECT COUNT(*) FROM `OrganizationInvitation` i WHERE i.`organizationId` = o.`id` AND i.`status` = 'PENDING' AND i.`expiresAt` > CURRENT_TIMESTAMP(3))),
  0, CURRENT_TIMESTAMP(3)
FROM `Organization` o;

INSERT INTO `SubscriptionHistory` (`id`, `organizationId`, `subscriptionId`, `planId`, `planCode`, `planVersion`, `status`, `reason`, `limitsSnapshot`, `featuresSnapshot`, `periodStart`, `periodEnd`, `createdAt`)
SELECT UUID(), s.`organizationId`, s.`id`, s.`planId`, p.`code`, p.`version`, s.`status`, 'MIGRATION_BACKFILL',
  JSON_OBJECT('maxCameras', p.`maxCameras`, 'maxStorageBytes', CAST(p.`maxStorageBytes` AS CHAR), 'retentionDays', p.`retentionDays`, 'maxUsers', p.`maxUsers`),
  p.`enabledFeatures`, s.`currentPeriodStart`, s.`currentPeriodEnd`, CURRENT_TIMESTAMP(3)
FROM `Subscription` s JOIN `Plan` p ON p.`id` = s.`planId`;
