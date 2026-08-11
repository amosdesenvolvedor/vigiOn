ALTER TABLE `GatewayCommand`
  MODIFY `type` ENUM('GET_CAMERA_STATUS','TEST_CAMERA','START_STREAM','STOP_STREAM','STREAM_STATUS','CAPTURE_SNAPSHOT','START_RECORDING','STOP_RECORDING') NOT NULL;

ALTER TABLE `StorageFile`
  ADD COLUMN `gatewayId` CHAR(36) NULL,
  ADD COLUMN `requestedById` CHAR(36) NULL,
  ADD COLUMN `idempotencyKey` CHAR(36) NULL,
  ADD COLUMN `status` ENUM('PENDING','CAPTURING','UPLOADING','AVAILABLE','FAILED','DELETING','DELETED','EXPIRED') NOT NULL DEFAULT 'PENDING',
  ADD COLUMN `reservedBytes` BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN `capturedAt` DATETIME(3) NULL,
  ADD COLUMN `uploadedAt` DATETIME(3) NULL,
  ADD COLUMN `deletedAt` DATETIME(3) NULL,
  ADD COLUMN `errorCode` VARCHAR(64) NULL,
  MODIFY `sizeBytes` BIGINT NOT NULL DEFAULT 0;

CREATE INDEX `StorageFile_organizationId_gatewayId_status_idx` ON `StorageFile`(`organizationId`, `gatewayId`, `status`);
CREATE INDEX `StorageFile_status_expiresAt_idx` ON `StorageFile`(`status`, `expiresAt`);
CREATE UNIQUE INDEX `StorageFile_organizationId_requestedById_idempotencyKey_key` ON `StorageFile`(`organizationId`, `requestedById`, `idempotencyKey`);
ALTER TABLE `StorageFile`
  ADD CONSTRAINT `StorageFile_gateway_fkey` FOREIGN KEY (`organizationId`, `gatewayId`) REFERENCES `Gateway`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `StorageFile_requestedBy_fkey` FOREIGN KEY (`organizationId`, `requestedById`) REFERENCES `User`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;
