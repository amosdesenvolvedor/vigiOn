ALTER TABLE `Gateway` ADD COLUMN `encryptionPublicKey` TEXT NULL;
ALTER TABLE `GatewayCommand`
  ADD COLUMN `streamSessionId` CHAR(36) NULL,
  MODIFY `type` ENUM('GET_CAMERA_STATUS','TEST_CAMERA','START_STREAM','STOP_STREAM','STREAM_STATUS') NOT NULL;

CREATE TABLE `StreamSession` (
  `id` CHAR(36) NOT NULL,
  `organizationId` CHAR(36) NOT NULL,
  `cameraId` CHAR(36) NOT NULL,
  `gatewayId` CHAR(36) NOT NULL,
  `userId` CHAR(36) NOT NULL,
  `idempotencyKey` CHAR(36) NOT NULL,
  `tokenHash` CHAR(64) NOT NULL,
  `status` ENUM('REQUESTED','STARTING','ACTIVE','STOPPING','ENDED','FAILED','EXPIRED') NOT NULL DEFAULT 'REQUESTED',
  `startedAt` DATETIME(3) NULL,
  `lastActivityAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `expiresAt` DATETIME(3) NOT NULL,
  `endedAt` DATETIME(3) NULL,
  `errorCode` VARCHAR(64) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `StreamSession_organizationId_id_key`(`organizationId`, `id`),
  UNIQUE INDEX `StreamSession_organizationId_userId_idempotencyKey_key`(`organizationId`, `userId`, `idempotencyKey`),
  INDEX `StreamSession_organizationId_cameraId_status_idx`(`organizationId`, `cameraId`, `status`),
  INDEX `StreamSession_organizationId_gatewayId_status_idx`(`organizationId`, `gatewayId`, `status`),
  INDEX `StreamSession_userId_status_expiresAt_idx`(`userId`, `status`, `expiresAt`),
  INDEX `StreamSession_status_expiresAt_idx`(`status`, `expiresAt`),
  PRIMARY KEY (`id`),
  CONSTRAINT `StreamSession_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `StreamSession_camera_fkey` FOREIGN KEY (`organizationId`, `cameraId`) REFERENCES `Camera`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `StreamSession_gateway_fkey` FOREIGN KEY (`organizationId`, `gatewayId`) REFERENCES `Gateway`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `StreamSession_user_fkey` FOREIGN KEY (`organizationId`, `userId`) REFERENCES `User`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX `GatewayCommand_organizationId_streamSessionId_createdAt_idx` ON `GatewayCommand`(`organizationId`, `streamSessionId`, `createdAt`);
ALTER TABLE `GatewayCommand` ADD CONSTRAINT `GatewayCommand_streamSession_fkey` FOREIGN KEY (`organizationId`, `streamSessionId`) REFERENCES `StreamSession`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;
