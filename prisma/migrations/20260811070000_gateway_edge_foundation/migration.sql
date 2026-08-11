ALTER TABLE `Camera` ADD COLUMN `gatewayId` CHAR(36) NULL;

CREATE TABLE `Gateway` (
  `id` CHAR(36) NOT NULL,
  `organizationId` CHAR(36) NOT NULL,
  `name` VARCHAR(160) NOT NULL,
  `deviceId` CHAR(36) NOT NULL,
  `secretHash` VARCHAR(255) NOT NULL,
  `status` ENUM('ONLINE','OFFLINE','CONNECTING','DISABLED','UNKNOWN') NOT NULL DEFAULT 'UNKNOWN',
  `version` VARCHAR(40) NULL,
  `protocolVersion` VARCHAR(16) NOT NULL DEFAULT '1',
  `lastSeenAt` DATETIME(3) NULL,
  `lastUptime` INTEGER NULL,
  `disabledAt` DATETIME(3) NULL,
  `deletedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `Gateway_deviceId_key`(`deviceId`),
  UNIQUE INDEX `Gateway_organizationId_id_key`(`organizationId`, `id`),
  INDEX `Gateway_organizationId_status_deletedAt_idx`(`organizationId`, `status`, `deletedAt`),
  INDEX `Gateway_organizationId_lastSeenAt_idx`(`organizationId`, `lastSeenAt`),
  PRIMARY KEY (`id`),
  CONSTRAINT `Gateway_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `GatewayPairingCode` (
  `id` CHAR(36) NOT NULL,
  `organizationId` CHAR(36) NOT NULL,
  `gatewayId` CHAR(36) NULL,
  `codeHash` CHAR(64) NOT NULL,
  `status` ENUM('PENDING','USED','REVOKED','EXPIRED') NOT NULL DEFAULT 'PENDING',
  `expiresAt` DATETIME(3) NOT NULL,
  `usedAt` DATETIME(3) NULL,
  `createdById` CHAR(36) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `GatewayPairingCode_codeHash_key`(`codeHash`),
  INDEX `GatewayPairingCode_organizationId_status_expiresAt_idx`(`organizationId`, `status`, `expiresAt`),
  INDEX `GatewayPairingCode_createdById_createdAt_idx`(`createdById`, `createdAt`),
  PRIMARY KEY (`id`),
  CONSTRAINT `GatewayPairingCode_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `GatewayPairingCode_gateway_fkey` FOREIGN KEY (`organizationId`, `gatewayId`) REFERENCES `Gateway`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `GatewayCommand` (
  `id` CHAR(36) NOT NULL,
  `organizationId` CHAR(36) NOT NULL,
  `gatewayId` CHAR(36) NOT NULL,
  `cameraId` CHAR(36) NULL,
  `commandId` CHAR(36) NOT NULL,
  `type` ENUM('GET_CAMERA_STATUS','TEST_CAMERA') NOT NULL,
  `status` ENUM('PENDING','DELIVERED','SUCCEEDED','FAILED','EXPIRED') NOT NULL DEFAULT 'PENDING',
  `payload` JSON NULL,
  `result` JSON NULL,
  `deliveredAt` DATETIME(3) NULL,
  `completedAt` DATETIME(3) NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `GatewayCommand_commandId_key`(`commandId`),
  INDEX `GatewayCommand_organizationId_gatewayId_status_createdAt_idx`(`organizationId`, `gatewayId`, `status`, `createdAt`),
  INDEX `GatewayCommand_organizationId_cameraId_createdAt_idx`(`organizationId`, `cameraId`, `createdAt`),
  INDEX `GatewayCommand_expiresAt_status_idx`(`expiresAt`, `status`),
  PRIMARY KEY (`id`),
  CONSTRAINT `GatewayCommand_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `GatewayCommand_gateway_fkey` FOREIGN KEY (`organizationId`, `gatewayId`) REFERENCES `Gateway`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `GatewayMessage` (
  `id` CHAR(36) NOT NULL,
  `organizationId` CHAR(36) NOT NULL,
  `gatewayId` CHAR(36) NOT NULL,
  `messageId` CHAR(36) NOT NULL,
  `type` VARCHAR(80) NOT NULL,
  `receivedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `GatewayMessage_gatewayId_messageId_key`(`gatewayId`, `messageId`),
  INDEX `GatewayMessage_organizationId_receivedAt_idx`(`organizationId`, `receivedAt`),
  PRIMARY KEY (`id`),
  CONSTRAINT `GatewayMessage_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `GatewayMessage_gateway_fkey` FOREIGN KEY (`organizationId`, `gatewayId`) REFERENCES `Gateway`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX `Camera_organizationId_gatewayId_deletedAt_idx` ON `Camera`(`organizationId`, `gatewayId`, `deletedAt`);
ALTER TABLE `Camera` ADD CONSTRAINT `Camera_gatewayId_fkey` FOREIGN KEY (`gatewayId`) REFERENCES `Gateway`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
