ALTER TABLE `Camera`
  ADD COLUMN `motionEnabled` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `motionSensitivity` VARCHAR(16) NOT NULL DEFAULT 'MEDIUM',
  ADD COLUMN `motionSampleFps` INTEGER NOT NULL DEFAULT 2,
  ADD COLUMN `motionCooldownSeconds` INTEGER NOT NULL DEFAULT 10,
  ADD COLUMN `captureSnapshotOnMotion` BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE `CameraEvent`
  DROP FOREIGN KEY `CameraEvent_organizationId_cameraId_fkey`;

ALTER TABLE `CameraEvent`
  DROP INDEX `CameraEvent_organizationId_detectedAt_idx`,
  DROP INDEX `CameraEvent_organizationId_status_severity_detectedAt_idx`,
  DROP INDEX `CameraEvent_organizationId_cameraId_detectedAt_idx`,
  DROP INDEX `CameraEvent_cameraId_detectedAt_idx`,
  MODIFY `cameraId` CHAR(36) NULL,
  ADD COLUMN `gatewayId` CHAR(36) NULL,
  ADD COLUMN `externalEventId` CHAR(36) NULL,
  ADD COLUMN `source` ENUM('MOTION_DETECTOR','CONNECTIVITY_MONITOR','GATEWAY_MONITOR','SYSTEM') NOT NULL DEFAULT 'SYSTEM',
  CHANGE COLUMN `detectedAt` `occurredAt` DATETIME(3) NOT NULL,
  ADD COLUMN `endedAt` DATETIME(3) NULL,
  ADD COLUMN `receivedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  MODIFY `type` ENUM('MOTION','CAMERA_OFFLINE','CAMERA_ONLINE','GATEWAY_OFFLINE','GATEWAY_ONLINE') NOT NULL;

ALTER TABLE `CameraEvent`
  ADD CONSTRAINT `CameraEvent_organizationId_cameraId_fkey` FOREIGN KEY (`organizationId`, `cameraId`) REFERENCES `Camera`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `CameraEvent_organizationId_gatewayId_fkey` FOREIGN KEY (`organizationId`, `gatewayId`) REFERENCES `Gateway`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX `CameraEvent_gatewayId_externalEventId_key` ON `CameraEvent`(`gatewayId`, `externalEventId`);
CREATE INDEX `CameraEvent_organizationId_occurredAt_idx` ON `CameraEvent`(`organizationId`, `occurredAt`);
CREATE INDEX `CameraEvent_organizationId_status_severity_occurredAt_idx` ON `CameraEvent`(`organizationId`, `status`, `severity`, `occurredAt`);
CREATE INDEX `CameraEvent_organizationId_cameraId_occurredAt_idx` ON `CameraEvent`(`organizationId`, `cameraId`, `occurredAt`);
CREATE INDEX `CameraEvent_organizationId_gatewayId_occurredAt_idx` ON `CameraEvent`(`organizationId`, `gatewayId`, `occurredAt`);
CREATE INDEX `CameraEvent_organizationId_type_occurredAt_idx` ON `CameraEvent`(`organizationId`, `type`, `occurredAt`);
