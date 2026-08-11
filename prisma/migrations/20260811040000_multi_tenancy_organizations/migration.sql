-- Organization status vocabulary
ALTER TABLE `Organization` MODIFY `status` ENUM('ACTIVE', 'SUSPENDED', 'INACTIVE', 'CANCELED') NOT NULL DEFAULT 'ACTIVE';
UPDATE `Organization` SET `status` = 'CANCELED' WHERE `status` = 'INACTIVE';
ALTER TABLE `Organization` MODIFY `status` ENUM('ACTIVE', 'SUSPENDED', 'CANCELED') NOT NULL DEFAULT 'ACTIVE';

-- Sessions represent the currently selected tenant; authorization comes from membership.
ALTER TABLE `Session` DROP FOREIGN KEY `Session_organizationId_userId_fkey`;
ALTER TABLE `Session` ADD CONSTRAINT `Session_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Audit actors may belong to the audited tenant through a membership rather than their legacy home tenant.
ALTER TABLE `AuditLog` DROP FOREIGN KEY `AuditLog_organizationId_actorUserId_fkey`;
ALTER TABLE `AuditLog` ADD CONSTRAINT `AuditLog_actorUserId_fkey` FOREIGN KEY (`actorUserId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE `OrganizationMembership` (
    `id` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `role` ENUM('OWNER', 'ADMIN', 'OPERATOR', 'VIEWER') NOT NULL DEFAULT 'VIEWER',
    `status` ENUM('INVITED', 'ACTIVE', 'SUSPENDED', 'REMOVED') NOT NULL DEFAULT 'INVITED',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `OrganizationMembership_userId_organizationId_key`(`userId`, `organizationId`),
    INDEX `OrganizationMembership_organizationId_status_role_idx`(`organizationId`, `status`, `role`),
    INDEX `OrganizationMembership_userId_status_idx`(`userId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `OrganizationInvitation` (
    `id` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `email` VARCHAR(254) NOT NULL,
    `normalizedEmail` VARCHAR(254) NOT NULL,
    `role` ENUM('OWNER', 'ADMIN', 'OPERATOR', 'VIEWER') NOT NULL,
    `status` ENUM('PENDING', 'ACCEPTED', 'CANCELED', 'EXPIRED') NOT NULL DEFAULT 'PENDING',
    `tokenHash` CHAR(64) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `acceptedAt` DATETIME(3) NULL,
    `canceledAt` DATETIME(3) NULL,
    `invitedById` CHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `OrganizationInvitation_tokenHash_key`(`tokenHash`),
    INDEX `OrganizationInvitation_organizationId_status_createdAt_idx`(`organizationId`, `status`, `createdAt`),
    INDEX `OrganizationInvitation_normalizedEmail_status_idx`(`normalizedEmail`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `OrganizationSettings` (
    `id` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `language` VARCHAR(16) NOT NULL DEFAULT 'pt-BR',
    `country` CHAR(2) NOT NULL DEFAULT 'BR',
    `tradeName` VARCHAR(180) NULL,
    `contactEmail` VARCHAR(254) NULL,
    `contactPhone` VARCHAR(32) NULL,
    `monitoringPreferences` JSON NULL,
    `notificationPreferences` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `OrganizationSettings_organizationId_key`(`organizationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `OrganizationMembership` ADD CONSTRAINT `OrganizationMembership_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `OrganizationMembership` ADD CONSTRAINT `OrganizationMembership_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `OrganizationInvitation` ADD CONSTRAINT `OrganizationInvitation_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `OrganizationInvitation` ADD CONSTRAINT `OrganizationInvitation_invitedById_fkey` FOREIGN KEY (`invitedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `OrganizationSettings` ADD CONSTRAINT `OrganizationSettings_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill every existing user as an active member of their current organization.
INSERT INTO `OrganizationMembership` (`id`, `userId`, `organizationId`, `role`, `status`, `createdAt`, `updatedAt`)
SELECT UUID(), `id`, `organizationId`, `role`, 'ACTIVE', `createdAt`, CURRENT_TIMESTAMP(3) FROM `User`;

INSERT INTO `OrganizationSettings` (`id`, `organizationId`, `createdAt`, `updatedAt`)
SELECT UUID(), `id`, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3) FROM `Organization`;
