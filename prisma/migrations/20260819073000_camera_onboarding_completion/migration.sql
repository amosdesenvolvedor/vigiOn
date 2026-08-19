-- Prompt 5/7: transactional camera creation from a consumed verification session.
ALTER TABLE `GatewayCommand`
  MODIFY `type` ENUM(
    'GET_CAMERA_STATUS', 'TEST_CAMERA', 'START_STREAM', 'STOP_STREAM', 'STREAM_STATUS',
    'CAPTURE_SNAPSHOT', 'START_RECORDING', 'STOP_RECORDING',
    'CAMERA_DISCOVERY_START', 'CAMERA_DISCOVERY_CANCEL',
    'CAMERA_VERIFICATION_START', 'CAMERA_VERIFICATION_CANCEL', 'CAMERA_REGISTER'
  ) NOT NULL;

ALTER TABLE `CameraVerificationSession`
  MODIFY `status` ENUM('PENDING','WAITING_FOR_CREDENTIALS','DISPATCHED','AUTHENTICATING','VERIFYING_ONVIF','VERIFYING_MEDIA','VERIFYING_RTSP','COMPLETED','CONSUMED','FAILED','CANCELED','EXPIRED') NOT NULL DEFAULT 'PENDING',
  ADD COLUMN `completionIdempotencyKey` CHAR(36) NULL,
  ADD COLUMN `consumedAt` DATETIME(3) NULL,
  ADD UNIQUE INDEX `CameraVerificationSession_org_user_completion_key` (`organizationId`, `userId`, `completionIdempotencyKey`);

ALTER TABLE `Camera`
  ADD COLUMN `verificationSessionId` CHAR(36) NULL,
  ADD COLUMN `creationSource` ENUM('MANUAL','ONBOARDING','IMPORT','API') NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN `capabilityEvidence` JSON NULL,
  ADD UNIQUE INDEX `Camera_verificationSessionId_key` (`verificationSessionId`),
  ADD CONSTRAINT `Camera_verificationSessionId_fkey` FOREIGN KEY (`verificationSessionId`) REFERENCES `CameraVerificationSession` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE `CameraIdentifier` (
  `id` CHAR(36) NOT NULL,
  `organizationId` CHAR(36) NOT NULL,
  `cameraId` CHAR(36) NOT NULL,
  `type` ENUM('SERIAL_NUMBER','UID','DEVICE_ID','MAC_ADDRESS','ONVIF_ENDPOINT_REFERENCE') NOT NULL,
  `valueHash` CHAR(64) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `CameraIdentifier_organizationId_type_valueHash_key` (`organizationId`, `type`, `valueHash`),
  INDEX `CameraIdentifier_organizationId_cameraId_idx` (`organizationId`, `cameraId`),
  CONSTRAINT `CameraIdentifier_organizationId_cameraId_fkey` FOREIGN KEY (`organizationId`, `cameraId`) REFERENCES `Camera` (`organizationId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `CameraIdentifier_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `CameraVerificationCredential` (
  `id` CHAR(36) NOT NULL,
  `organizationId` CHAR(36) NOT NULL,
  `verificationSessionId` CHAR(36) NOT NULL,
  `ciphertext` LONGBLOB NOT NULL,
  `initializationVector` VARBINARY(32) NOT NULL,
  `authenticationTag` VARBINARY(32) NOT NULL,
  `keyVersion` INTEGER NOT NULL DEFAULT 1,
  `expiresAt` DATETIME(3) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `CameraVerificationCredential_verificationSessionId_key` (`verificationSessionId`),
  UNIQUE INDEX `CameraVerificationCredential_org_session_key` (`organizationId`, `verificationSessionId`),
  INDEX `CameraVerificationCredential_expiresAt_idx` (`expiresAt`),
  CONSTRAINT `CameraVerificationCredential_org_session_fkey` FOREIGN KEY (`organizationId`, `verificationSessionId`) REFERENCES `CameraVerificationSession` (`organizationId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `CameraVerificationCredential_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
