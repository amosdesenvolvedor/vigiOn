CREATE TABLE `MfaCredential` (
  `id` CHAR(36) NOT NULL,
  `userId` CHAR(36) NOT NULL,
  `encryptedSecret` TEXT NOT NULL,
  `enabledAt` DATETIME(3) NULL,
  `lastUsedStep` BIGINT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `MfaCredential_userId_key`(`userId`),
  INDEX `MfaCredential_enabledAt_idx`(`enabledAt`),
  PRIMARY KEY (`id`),
  CONSTRAINT `MfaCredential_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `BillingCheckoutSession` ADD COLUMN `activeLock` CHAR(36) NULL,
  ADD UNIQUE INDEX `BillingCheckoutSession_activeLock_key`(`activeLock`);

ALTER TABLE `Session` ADD COLUMN `mfaVerifiedAt` DATETIME(3) NULL;

CREATE TABLE `WorkerHealth` (
  `name` VARCHAR(100) NOT NULL,
  `status` VARCHAR(16) NOT NULL,
  `lastStartedAt` DATETIME(3) NULL,
  `lastSuccessAt` DATETIME(3) NULL,
  `lastFailureAt` DATETIME(3) NULL,
  `lastErrorCode` VARCHAR(100) NULL,
  `durationMs` INTEGER NULL,
  `updatedAt` DATETIME(3) NOT NULL,
  INDEX `WorkerHealth_status_updatedAt_idx`(`status`, `updatedAt`),
  PRIMARY KEY (`name`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `MfaRecoveryCode` (
  `id` CHAR(36) NOT NULL,
  `userId` CHAR(36) NOT NULL,
  `codeHash` CHAR(64) NOT NULL,
  `usedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `MfaRecoveryCode_codeHash_key`(`codeHash`),
  INDEX `MfaRecoveryCode_userId_usedAt_idx`(`userId`, `usedAt`),
  PRIMARY KEY (`id`),
  CONSTRAINT `MfaRecoveryCode_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
