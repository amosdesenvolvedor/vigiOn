CREATE TABLE `Alert` (
  `id` CHAR(36) NOT NULL,
  `organizationId` CHAR(36) NOT NULL,
  `eventId` CHAR(36) NOT NULL,
  `cameraId` CHAR(36) NULL,
  `gatewayId` CHAR(36) NULL,
  `severity` ENUM('INFO','LOW','MEDIUM','HIGH','CRITICAL') NOT NULL,
  `status` ENUM('OPEN','ACKNOWLEDGED','RESOLVED') NOT NULL DEFAULT 'OPEN',
  `title` VARCHAR(180) NOT NULL,
  `message` VARCHAR(500) NOT NULL,
  `acknowledgedAt` DATETIME(3) NULL,
  `acknowledgedById` CHAR(36) NULL,
  `resolvedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `Alert_eventId_key`(`eventId`),
  UNIQUE INDEX `Alert_organizationId_id_key`(`organizationId`,`id`),
  UNIQUE INDEX `Alert_organizationId_eventId_key`(`organizationId`,`eventId`),
  INDEX `Alert_organizationId_status_createdAt_idx`(`organizationId`,`status`,`createdAt`),
  INDEX `Alert_organizationId_severity_createdAt_idx`(`organizationId`,`severity`,`createdAt`),
  INDEX `Alert_organizationId_cameraId_createdAt_idx`(`organizationId`,`cameraId`,`createdAt`),
  INDEX `Alert_organizationId_gatewayId_createdAt_idx`(`organizationId`,`gatewayId`,`createdAt`),
  CONSTRAINT `Alert_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `Alert_organizationId_eventId_fkey` FOREIGN KEY (`organizationId`,`eventId`) REFERENCES `CameraEvent`(`organizationId`,`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `Alert_organizationId_acknowledgedById_fkey` FOREIGN KEY (`organizationId`,`acknowledgedById`) REFERENCES `User`(`organizationId`,`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `NotificationPreference` (
  `id` CHAR(36) NOT NULL,
  `organizationId` CHAR(36) NOT NULL,
  `userId` CHAR(36) NOT NULL,
  `eventType` ENUM('MOTION','CAMERA_OFFLINE','CAMERA_ONLINE','GATEWAY_OFFLINE','GATEWAY_ONLINE') NOT NULL,
  `channel` ENUM('IN_APP','PUSH','EMAIL','SMS','WHATSAPP') NOT NULL,
  `enabled` BOOLEAN NOT NULL DEFAULT true,
  `minimumSeverity` ENUM('INFO','LOW','MEDIUM','HIGH','CRITICAL') NOT NULL DEFAULT 'INFO',
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `NotificationPreference_user_event_channel_key`(`organizationId`,`userId`,`eventType`,`channel`),
  INDEX `NotificationPreference_organizationId_userId_idx`(`organizationId`,`userId`),
  CONSTRAINT `NotificationPreference_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `NotificationPreference_organizationId_userId_fkey` FOREIGN KEY (`organizationId`,`userId`) REFERENCES `User`(`organizationId`,`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `Notification`
  ADD COLUMN `alertId` CHAR(36) NULL,
  ADD COLUMN `deliveredAt` DATETIME(3) NULL,
  ADD COLUMN `attempts` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `nextAttemptAt` DATETIME(3) NULL,
  ADD COLUMN `expiresAt` DATETIME(3) NULL,
  ADD COLUMN `errorCode` VARCHAR(64) NULL;

DELETE FROM `Notification`;

ALTER TABLE `Notification`
  MODIFY `alertId` CHAR(36) NOT NULL,
  ADD CONSTRAINT `Notification_organizationId_alertId_fkey` FOREIGN KEY (`organizationId`,`alertId`) REFERENCES `Alert`(`organizationId`,`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX `Notification_alertId_userId_channel_key` ON `Notification`(`alertId`,`userId`,`channel`);
CREATE INDEX `Notification_organizationId_userId_readAt_createdAt_idx` ON `Notification`(`organizationId`,`userId`,`readAt`,`createdAt`);
CREATE INDEX `Notification_status_nextAttemptAt_idx` ON `Notification`(`status`,`nextAttemptAt`);
