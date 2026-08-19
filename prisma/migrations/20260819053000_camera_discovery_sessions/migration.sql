-- Prompt 3/7: additive, tenant-scoped and ephemeral camera discovery state.
ALTER TABLE `GatewayCommand`
  MODIFY `type` ENUM(
    'GET_CAMERA_STATUS', 'TEST_CAMERA', 'START_STREAM', 'STOP_STREAM', 'STREAM_STATUS',
    'CAPTURE_SNAPSHOT', 'START_RECORDING', 'STOP_RECORDING',
    'CAMERA_DISCOVERY_START', 'CAMERA_DISCOVERY_CANCEL'
  ) NOT NULL;

CREATE TABLE `CameraDiscoverySession` (
  `id` CHAR(36) NOT NULL,
  `organizationId` CHAR(36) NOT NULL,
  `gatewayId` CHAR(36) NOT NULL,
  `userId` CHAR(36) NOT NULL,
  `catalogVariantId` CHAR(36) NULL,
  `expectedManufacturer` VARCHAR(120) NULL,
  `expectedModel` VARCHAR(160) NULL,
  `expectedVariant` VARCHAR(80) NULL,
  `expectedIdentifiers` JSON NULL,
  `status` ENUM('PENDING','DISPATCHED','SCANNING','RESULTS_AVAILABLE','COMPLETED','EXPIRED','CANCELED','FAILED') NOT NULL DEFAULT 'PENDING',
  `confirmedCandidateId` CHAR(36) NULL,
  `startedAt` DATETIME(3) NULL,
  `completedAt` DATETIME(3) NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  `errorCode` VARCHAR(64) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `CameraDiscoverySession_organizationId_id_key` (`organizationId`, `id`),
  INDEX `CameraDiscoverySession_organizationId_gatewayId_status_idx` (`organizationId`, `gatewayId`, `status`),
  INDEX `CameraDiscoverySession_userId_status_expiresAt_idx` (`userId`, `status`, `expiresAt`),
  INDEX `CameraDiscoverySession_status_expiresAt_idx` (`status`, `expiresAt`),
  CONSTRAINT `CameraDiscoverySession_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `CameraDiscoverySession_organizationId_gatewayId_fkey` FOREIGN KEY (`organizationId`, `gatewayId`) REFERENCES `Gateway` (`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `CameraDiscoverySession_organizationId_userId_fkey` FOREIGN KEY (`organizationId`, `userId`) REFERENCES `User` (`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `CameraDiscoverySession_catalogVariantId_fkey` FOREIGN KEY (`catalogVariantId`) REFERENCES `CameraCatalogVariant` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `CameraDiscoveryCandidate` (
  `id` CHAR(36) NOT NULL,
  `organizationId` CHAR(36) NOT NULL,
  `sessionId` CHAR(36) NOT NULL,
  `fingerprint` CHAR(64) NOT NULL,
  `networkAddress` VARCHAR(45) NOT NULL,
  `servicePort` INTEGER NOT NULL,
  `endpointReference` VARCHAR(255) NULL,
  `manufacturer` VARCHAR(120) NULL,
  `model` VARCHAR(160) NULL,
  `hardwareInfo` VARCHAR(160) NULL,
  `classification` ENUM('CAMERA_CANDIDATE','POSSIBLE_CAMERA','NOT_RELEVANT','UNKNOWN') NOT NULL DEFAULT 'POSSIBLE_CAMERA',
  `confidence` ENUM('EXACT','HIGH','MEDIUM','LOW','UNKNOWN') NOT NULL DEFAULT 'UNKNOWN',
  `matchFactors` JSON NULL,
  `detectedCapabilities` JSON NULL,
  `authenticationRequired` BOOLEAN NOT NULL DEFAULT false,
  `alreadyRegistered` BOOLEAN NOT NULL DEFAULT false,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `CameraDiscoveryCandidate_sessionId_fingerprint_key` (`sessionId`, `fingerprint`),
  INDEX `DiscoveryCandidate_org_session_class_idx` (`organizationId`, `sessionId`, `classification`),
  CONSTRAINT `CameraDiscoveryCandidate_organizationId_sessionId_fkey` FOREIGN KEY (`organizationId`, `sessionId`) REFERENCES `CameraDiscoverySession` (`organizationId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `CameraDiscoveryCandidate_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
