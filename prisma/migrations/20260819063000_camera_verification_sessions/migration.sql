-- Prompt 4/7: ephemeral, tenant-scoped ONVIF/RTSP camera verification.
ALTER TABLE `GatewayCommand`
  MODIFY `type` ENUM(
    'GET_CAMERA_STATUS', 'TEST_CAMERA', 'START_STREAM', 'STOP_STREAM', 'STREAM_STATUS',
    'CAPTURE_SNAPSHOT', 'START_RECORDING', 'STOP_RECORDING',
    'CAMERA_DISCOVERY_START', 'CAMERA_DISCOVERY_CANCEL',
    'CAMERA_VERIFICATION_START', 'CAMERA_VERIFICATION_CANCEL'
  ) NOT NULL;

CREATE TABLE `CameraVerificationSession` (
  `id` CHAR(36) NOT NULL,
  `organizationId` CHAR(36) NOT NULL,
  `gatewayId` CHAR(36) NOT NULL,
  `userId` CHAR(36) NOT NULL,
  `discoverySessionId` CHAR(36) NOT NULL,
  `candidateId` CHAR(36) NOT NULL,
  `catalogVariantId` CHAR(36) NULL,
  `status` ENUM('PENDING','WAITING_FOR_CREDENTIALS','DISPATCHED','AUTHENTICATING','VERIFYING_ONVIF','VERIFYING_MEDIA','VERIFYING_RTSP','COMPLETED','FAILED','CANCELED','EXPIRED') NOT NULL DEFAULT 'PENDING',
  `result` ENUM('VERIFIED','PARTIALLY_VERIFIED','AUTHENTICATION_REQUIRED','AUTHENTICATION_FAILED','MODEL_MISMATCH','ONVIF_UNAVAILABLE','RTSP_UNAVAILABLE','TIMEOUT','NETWORK_ERROR','UNSUPPORTED','CANCELED') NULL,
  `credentialsConfigured` BOOLEAN NOT NULL DEFAULT false,
  `detectedIdentity` JSON NULL,
  `detectedCapabilities` JSON NULL,
  `evidence` JSON NULL,
  `commandId` CHAR(36) NULL,
  `confirmedAt` DATETIME(3) NULL,
  `startedAt` DATETIME(3) NULL,
  `completedAt` DATETIME(3) NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  `errorCode` VARCHAR(64) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `CameraVerificationSession_organizationId_id_key` (`organizationId`, `id`),
  INDEX `CameraVerificationSession_organizationId_gatewayId_status_idx` (`organizationId`, `gatewayId`, `status`),
  INDEX `CameraVerificationSession_userId_status_expiresAt_idx` (`userId`, `status`, `expiresAt`),
  INDEX `CameraVerificationSession_status_expiresAt_idx` (`status`, `expiresAt`),
  CONSTRAINT `CameraVerificationSession_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `CameraVerificationSession_organizationId_gatewayId_fkey` FOREIGN KEY (`organizationId`, `gatewayId`) REFERENCES `Gateway` (`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `CameraVerificationSession_organizationId_userId_fkey` FOREIGN KEY (`organizationId`, `userId`) REFERENCES `User` (`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `CameraVerificationSession_organizationId_discoverySessionId_fkey` FOREIGN KEY (`organizationId`, `discoverySessionId`) REFERENCES `CameraDiscoverySession` (`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `CameraVerificationSession_candidateId_fkey` FOREIGN KEY (`candidateId`) REFERENCES `CameraDiscoveryCandidate` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `CameraVerificationSession_catalogVariantId_fkey` FOREIGN KEY (`catalogVariantId`) REFERENCES `CameraCatalogVariant` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
