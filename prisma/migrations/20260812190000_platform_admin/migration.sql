ALTER TABLE `User` ADD COLUMN `platformRole` ENUM('PLATFORM_ADMIN') NULL;

CREATE TABLE `PlatformAuditLog` (
    `id` CHAR(36) NOT NULL,
    `actorUserId` CHAR(36) NULL,
    `action` VARCHAR(100) NOT NULL,
    `entityType` VARCHAR(100) NOT NULL,
    `entityId` VARCHAR(191) NULL,
    `reason` VARCHAR(500) NULL,
    `metadata` JSON NULL,
    `ipAddress` VARCHAR(45) NULL,
    `userAgent` VARCHAR(512) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `PlatformAuditLog_actorUserId_createdAt_idx`(`actorUserId`, `createdAt`),
    INDEX `PlatformAuditLog_action_createdAt_idx`(`action`, `createdAt`),
    INDEX `PlatformAuditLog_entityType_entityId_createdAt_idx`(`entityType`, `entityId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `PlatformAuditLog` ADD CONSTRAINT `PlatformAuditLog_actorUserId_fkey`
  FOREIGN KEY (`actorUserId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
