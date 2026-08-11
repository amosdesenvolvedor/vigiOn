-- CreateTable
CREATE TABLE `Organization` (
    `id` CHAR(36) NOT NULL,
    `name` VARCHAR(160) NOT NULL,
    `slug` VARCHAR(100) NOT NULL,
    `status` ENUM('ACTIVE', 'SUSPENDED', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
    `timezone` VARCHAR(64) NOT NULL DEFAULT 'UTC',
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Organization_slug_key`(`slug`),
    INDEX `Organization_status_deletedAt_idx`(`status`, `deletedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CustomerProfile` (
    `id` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `legalName` VARCHAR(180) NULL,
    `taxId` VARCHAR(40) NULL,
    `contactEmail` VARCHAR(254) NULL,
    `contactPhone` VARCHAR(32) NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `CustomerProfile_organizationId_key`(`organizationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `User` (
    `id` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `name` VARCHAR(160) NOT NULL,
    `email` VARCHAR(254) NOT NULL,
    `normalizedEmail` VARCHAR(254) NOT NULL,
    `passwordHash` VARCHAR(255) NOT NULL,
    `role` ENUM('OWNER', 'ADMIN', 'OPERATOR', 'VIEWER') NOT NULL DEFAULT 'VIEWER',
    `status` ENUM('INVITED', 'ACTIVE', 'SUSPENDED', 'INACTIVE') NOT NULL DEFAULT 'INVITED',
    `timezone` VARCHAR(64) NULL,
    `lastLoginAt` DATETIME(3) NULL,
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `User_normalizedEmail_key`(`normalizedEmail`),
    INDEX `User_organizationId_status_deletedAt_idx`(`organizationId`, `status`, `deletedAt`),
    INDEX `User_organizationId_role_idx`(`organizationId`, `role`),
    UNIQUE INDEX `User_organizationId_id_key`(`organizationId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PlatformUser` (
    `id` CHAR(36) NOT NULL,
    `name` VARCHAR(160) NOT NULL,
    `email` VARCHAR(254) NOT NULL,
    `normalizedEmail` VARCHAR(254) NOT NULL,
    `passwordHash` VARCHAR(255) NOT NULL,
    `role` ENUM('SUPER_ADMIN', 'SUPPORT', 'AUDITOR') NOT NULL DEFAULT 'SUPPORT',
    `active` BOOLEAN NOT NULL DEFAULT true,
    `lastLoginAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `PlatformUser_normalizedEmail_key`(`normalizedEmail`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Camera` (
    `id` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `name` VARCHAR(160) NOT NULL,
    `description` TEXT NULL,
    `location` VARCHAR(255) NULL,
    `status` ENUM('PENDING', 'ONLINE', 'OFFLINE', 'DISABLED', 'ERROR') NOT NULL DEFAULT 'PENDING',
    `connectionType` ENUM('DIRECT', 'GATEWAY', 'CLOUD') NOT NULL DEFAULT 'DIRECT',
    `protocol` ENUM('RTSP', 'ONVIF', 'HTTP', 'HTTPS', 'PROPRIETARY', 'OTHER') NOT NULL,
    `manufacturer` VARCHAR(100) NULL,
    `model` VARCHAR(100) NULL,
    `identifier` VARCHAR(191) NOT NULL,
    `lastSeenAt` DATETIME(3) NULL,
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Camera_organizationId_status_deletedAt_idx`(`organizationId`, `status`, `deletedAt`),
    INDEX `Camera_organizationId_lastSeenAt_idx`(`organizationId`, `lastSeenAt`),
    UNIQUE INDEX `Camera_organizationId_id_key`(`organizationId`, `id`),
    UNIQUE INDEX `Camera_organizationId_identifier_key`(`organizationId`, `identifier`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CameraCredential` (
    `id` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `cameraId` CHAR(36) NOT NULL,
    `ciphertext` LONGBLOB NOT NULL,
    `initializationVector` VARBINARY(32) NOT NULL,
    `authenticationTag` VARBINARY(32) NOT NULL,
    `keyVersion` INTEGER NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `CameraCredential_cameraId_key`(`cameraId`),
    INDEX `CameraCredential_organizationId_idx`(`organizationId`),
    UNIQUE INDEX `CameraCredential_organizationId_cameraId_key`(`organizationId`, `cameraId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CameraEvent` (
    `id` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `cameraId` CHAR(36) NOT NULL,
    `type` VARCHAR(80) NOT NULL,
    `severity` ENUM('INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL') NOT NULL DEFAULT 'INFO',
    `status` ENUM('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'DISMISSED') NOT NULL DEFAULT 'OPEN',
    `detectedAt` DATETIME(3) NOT NULL,
    `acknowledgedAt` DATETIME(3) NULL,
    `resolvedAt` DATETIME(3) NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `CameraEvent_organizationId_detectedAt_idx`(`organizationId`, `detectedAt`),
    INDEX `CameraEvent_organizationId_status_severity_detectedAt_idx`(`organizationId`, `status`, `severity`, `detectedAt`),
    INDEX `CameraEvent_organizationId_cameraId_detectedAt_idx`(`organizationId`, `cameraId`, `detectedAt`),
    INDEX `CameraEvent_cameraId_detectedAt_idx`(`cameraId`, `detectedAt`),
    UNIQUE INDEX `CameraEvent_organizationId_id_key`(`organizationId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Notification` (
    `id` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `eventId` CHAR(36) NULL,
    `channel` ENUM('IN_APP', 'PUSH', 'EMAIL', 'SMS', 'WHATSAPP') NOT NULL DEFAULT 'IN_APP',
    `title` VARCHAR(180) NOT NULL,
    `message` TEXT NOT NULL,
    `priority` ENUM('LOW', 'NORMAL', 'HIGH', 'URGENT') NOT NULL DEFAULT 'NORMAL',
    `status` ENUM('PENDING', 'SENT', 'DELIVERED', 'FAILED', 'READ') NOT NULL DEFAULT 'PENDING',
    `readAt` DATETIME(3) NULL,
    `sentAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Notification_organizationId_userId_status_createdAt_idx`(`organizationId`, `userId`, `status`, `createdAt`),
    INDEX `Notification_organizationId_status_createdAt_idx`(`organizationId`, `status`, `createdAt`),
    INDEX `Notification_organizationId_eventId_idx`(`organizationId`, `eventId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StorageFile` (
    `id` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `cameraId` CHAR(36) NULL,
    `eventId` CHAR(36) NULL,
    `type` ENUM('IMAGE', 'SNAPSHOT', 'VIDEO', 'RECORDING', 'EVENT_EVIDENCE', 'OTHER') NOT NULL,
    `storageProvider` VARCHAR(60) NOT NULL,
    `storageKey` VARCHAR(768) NOT NULL,
    `fileName` VARCHAR(255) NOT NULL,
    `mimeType` VARCHAR(127) NOT NULL,
    `sizeBytes` BIGINT NOT NULL,
    `durationSeconds` INTEGER NULL,
    `checksum` VARCHAR(128) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expiresAt` DATETIME(3) NULL,

    INDEX `StorageFile_organizationId_createdAt_idx`(`organizationId`, `createdAt`),
    INDEX `StorageFile_organizationId_type_createdAt_idx`(`organizationId`, `type`, `createdAt`),
    INDEX `StorageFile_organizationId_cameraId_createdAt_idx`(`organizationId`, `cameraId`, `createdAt`),
    INDEX `StorageFile_organizationId_eventId_idx`(`organizationId`, `eventId`),
    INDEX `StorageFile_expiresAt_idx`(`expiresAt`),
    UNIQUE INDEX `StorageFile_storageProvider_storageKey_key`(`storageProvider`, `storageKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Plan` (
    `id` CHAR(36) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `slug` VARCHAR(64) NOT NULL,
    `priceCents` INTEGER NULL,
    `currency` CHAR(3) NOT NULL DEFAULT 'BRL',
    `billingInterval` ENUM('MONTHLY', 'YEARLY', 'CUSTOM') NOT NULL DEFAULT 'MONTHLY',
    `maxCameras` INTEGER NOT NULL,
    `maxStorageBytes` BIGINT NOT NULL,
    `retentionDays` INTEGER NOT NULL,
    `maxUsers` INTEGER NOT NULL,
    `enabledFeatures` JSON NOT NULL,
    `status` ENUM('ACTIVE', 'INACTIVE', 'ARCHIVED') NOT NULL DEFAULT 'ACTIVE',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Plan_slug_key`(`slug`),
    INDEX `Plan_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Subscription` (
    `id` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `planId` CHAR(36) NOT NULL,
    `status` ENUM('TRIAL', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'EXPIRED') NOT NULL DEFAULT 'TRIAL',
    `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `currentPeriodStart` DATETIME(3) NOT NULL,
    `currentPeriodEnd` DATETIME(3) NOT NULL,
    `canceledAt` DATETIME(3) NULL,
    `trialEndsAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Subscription_organizationId_status_idx`(`organizationId`, `status`),
    INDEX `Subscription_organizationId_currentPeriodEnd_idx`(`organizationId`, `currentPeriodEnd`),
    INDEX `Subscription_planId_status_idx`(`planId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StorageUsage` (
    `id` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `usedBytes` BIGINT NOT NULL DEFAULT 0,
    `fileCount` BIGINT NOT NULL DEFAULT 0,
    `version` INTEGER NOT NULL DEFAULT 0,
    `calculatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `StorageUsage_organizationId_key`(`organizationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AuditLog` (
    `id` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NULL,
    `actorUserId` CHAR(36) NULL,
    `action` VARCHAR(100) NOT NULL,
    `entityType` VARCHAR(100) NOT NULL,
    `entityId` VARCHAR(191) NULL,
    `metadata` JSON NULL,
    `ipAddress` VARCHAR(45) NULL,
    `userAgent` VARCHAR(512) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AuditLog_organizationId_createdAt_idx`(`organizationId`, `createdAt`),
    INDEX `AuditLog_organizationId_action_createdAt_idx`(`organizationId`, `action`, `createdAt`),
    INDEX `AuditLog_organizationId_entityType_entityId_idx`(`organizationId`, `entityType`, `entityId`),
    INDEX `AuditLog_actorUserId_createdAt_idx`(`actorUserId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `CustomerProfile` ADD CONSTRAINT `CustomerProfile_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `User` ADD CONSTRAINT `User_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Camera` ADD CONSTRAINT `Camera_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CameraCredential` ADD CONSTRAINT `CameraCredential_organizationId_cameraId_fkey` FOREIGN KEY (`organizationId`, `cameraId`) REFERENCES `Camera`(`organizationId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CameraEvent` ADD CONSTRAINT `CameraEvent_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CameraEvent` ADD CONSTRAINT `CameraEvent_organizationId_cameraId_fkey` FOREIGN KEY (`organizationId`, `cameraId`) REFERENCES `Camera`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Notification` ADD CONSTRAINT `Notification_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Notification` ADD CONSTRAINT `Notification_organizationId_userId_fkey` FOREIGN KEY (`organizationId`, `userId`) REFERENCES `User`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Notification` ADD CONSTRAINT `Notification_organizationId_eventId_fkey` FOREIGN KEY (`organizationId`, `eventId`) REFERENCES `CameraEvent`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StorageFile` ADD CONSTRAINT `StorageFile_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StorageFile` ADD CONSTRAINT `StorageFile_organizationId_cameraId_fkey` FOREIGN KEY (`organizationId`, `cameraId`) REFERENCES `Camera`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StorageFile` ADD CONSTRAINT `StorageFile_organizationId_eventId_fkey` FOREIGN KEY (`organizationId`, `eventId`) REFERENCES `CameraEvent`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Subscription` ADD CONSTRAINT `Subscription_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Subscription` ADD CONSTRAINT `Subscription_planId_fkey` FOREIGN KEY (`planId`) REFERENCES `Plan`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StorageUsage` ADD CONSTRAINT `StorageUsage_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AuditLog` ADD CONSTRAINT `AuditLog_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AuditLog` ADD CONSTRAINT `AuditLog_organizationId_actorUserId_fkey` FOREIGN KEY (`organizationId`, `actorUserId`) REFERENCES `User`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;
