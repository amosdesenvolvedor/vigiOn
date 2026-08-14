-- CreateTable
CREATE TABLE `ExternalIdentity` (
    `id` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `provider` ENUM('GOOGLE', 'MICROSOFT') NOT NULL,
    `providerSubject` VARCHAR(191) NOT NULL,
    `email` VARCHAR(254) NOT NULL,
    `emailVerified` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ExternalIdentity_provider_providerSubject_key`(`provider`, `providerSubject`),
    INDEX `ExternalIdentity_userId_provider_idx`(`userId`, `provider`),
    INDEX `ExternalIdentity_email_idx`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OAuthTransaction` (
    `id` CHAR(36) NOT NULL,
    `provider` ENUM('GOOGLE', 'MICROSOFT') NOT NULL,
    `stateHash` CHAR(64) NOT NULL,
    `pkceVerifier` VARCHAR(128) NOT NULL,
    `nonce` VARCHAR(128) NOT NULL,
    `returnTo` VARCHAR(255) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `usedAt` DATETIME(3) NULL,
    `completionPurpose` ENUM('ONBOARDING', 'MFA') NULL,
    `completionTokenHash` CHAR(64) NULL,
    `providerSubject` VARCHAR(191) NULL,
    `email` VARCHAR(254) NULL,
    `emailVerified` BOOLEAN NULL,
    `displayName` VARCHAR(160) NULL,
    `completedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `OAuthTransaction_stateHash_key`(`stateHash`),
    UNIQUE INDEX `OAuthTransaction_completionTokenHash_key`(`completionTokenHash`),
    INDEX `OAuthTransaction_provider_expiresAt_usedAt_idx`(`provider`, `expiresAt`, `usedAt`),
    INDEX `OAuthTransaction_expiresAt_completedAt_idx`(`expiresAt`, `completedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ExternalIdentity` ADD CONSTRAINT `ExternalIdentity_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
