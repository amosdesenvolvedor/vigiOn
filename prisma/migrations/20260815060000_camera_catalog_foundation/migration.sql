-- AlterTable
ALTER TABLE `Camera` ADD COLUMN `catalogVariantId` CHAR(36) NULL;

-- CreateTable
CREATE TABLE `CameraCatalogManufacturer` (
    `id` CHAR(36) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `normalizedName` VARCHAR(120) NOT NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `CameraCatalogManufacturer_normalizedName_key`(`normalizedName`),
    INDEX `CameraCatalogManufacturer_name_idx`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CameraCatalogBrand` (
    `id` CHAR(36) NOT NULL,
    `manufacturerId` CHAR(36) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `normalizedName` VARCHAR(120) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `CameraCatalogBrand_name_idx`(`name`),
    UNIQUE INDEX `CameraCatalogBrand_manufacturerId_normalizedName_key`(`manufacturerId`, `normalizedName`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CameraCatalogFamily` (
    `id` CHAR(36) NOT NULL,
    `brandId` CHAR(36) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `normalizedName` VARCHAR(120) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `CameraCatalogFamily_name_idx`(`name`),
    UNIQUE INDEX `CameraCatalogFamily_brandId_normalizedName_key`(`brandId`, `normalizedName`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CameraCatalogModel` (
    `id` CHAR(36) NOT NULL,
    `brandId` CHAR(36) NOT NULL,
    `familyId` CHAR(36) NULL,
    `name` VARCHAR(160) NOT NULL,
    `normalizedName` VARCHAR(160) NOT NULL,
    `aliases` JSON NULL,
    `cameraType` ENUM('INDOOR_FIXED', 'INDOOR_PTZ', 'OUTDOOR_FIXED', 'OUTDOOR_PTZ', 'BULLET', 'DOME', 'TURRET', 'FLOODLIGHT', 'DOORBELL', 'BATTERY', 'SOLAR', 'DUAL_LENS', 'PANORAMIC', 'OTHER', 'UNKNOWN') NOT NULL DEFAULT 'UNKNOWN',
    `resolution` VARCHAR(80) NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `CameraCatalogModel_name_idx`(`name`),
    INDEX `CameraCatalogModel_familyId_normalizedName_idx`(`familyId`, `normalizedName`),
    INDEX `CameraCatalogModel_cameraType_idx`(`cameraType`),
    UNIQUE INDEX `CameraCatalogModel_brandId_normalizedName_key`(`brandId`, `normalizedName`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CameraCatalogAlias` (
    `id` CHAR(36) NOT NULL,
    `modelId` CHAR(36) NOT NULL,
    `name` VARCHAR(160) NOT NULL,
    `normalizedName` VARCHAR(160) NOT NULL,

    INDEX `CameraCatalogAlias_normalizedName_idx`(`normalizedName`),
    UNIQUE INDEX `CameraCatalogAlias_modelId_normalizedName_key`(`modelId`, `normalizedName`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CameraCatalogVariant` (
    `id` CHAR(36) NOT NULL,
    `modelId` CHAR(36) NOT NULL,
    `identityKey` VARCHAR(191) NOT NULL,
    `name` VARCHAR(120) NULL,
    `hardwareVersion` VARCHAR(80) NULL,
    `region` VARCHAR(40) NULL,
    `firmwareMin` VARCHAR(80) NULL,
    `firmwareMax` VARCHAR(80) NULL,
    `sku` VARCHAR(100) NULL,
    `deviceIdentifierPattern` VARCHAR(255) NULL,
    `connectivity` JSON NULL,
    `qrPresent` ENUM('SUPPORTED', 'UNSUPPORTED', 'UNKNOWN') NOT NULL DEFAULT 'UNKNOWN',
    `qrContainsUid` ENUM('SUPPORTED', 'UNSUPPORTED', 'UNKNOWN') NOT NULL DEFAULT 'UNKNOWN',
    `qrContainsSerial` ENUM('SUPPORTED', 'UNSUPPORTED', 'UNKNOWN') NOT NULL DEFAULT 'UNKNOWN',
    `qrContainsMac` ENUM('SUPPORTED', 'UNSUPPORTED', 'UNKNOWN') NOT NULL DEFAULT 'UNKNOWN',
    `qrContainsWifi` ENUM('SUPPORTED', 'UNSUPPORTED', 'UNKNOWN') NOT NULL DEFAULT 'UNKNOWN',
    `qrProprietary` ENUM('SUPPORTED', 'UNSUPPORTED', 'UNKNOWN') NOT NULL DEFAULT 'UNKNOWN',
    `qrFormat` VARCHAR(160) NULL,
    `qrUsableByVigion` ENUM('SUPPORTED', 'UNSUPPORTED', 'UNKNOWN') NOT NULL DEFAULT 'UNKNOWN',
    `manufacturerAppRequired` ENUM('SUPPORTED', 'UNSUPPORTED', 'UNKNOWN') NOT NULL DEFAULT 'UNKNOWN',
    `manufacturerCloudRequired` ENUM('SUPPORTED', 'UNSUPPORTED', 'UNKNOWN') NOT NULL DEFAULT 'UNKNOWN',
    `localOperation` ENUM('SUPPORTED', 'UNSUPPORTED', 'UNKNOWN') NOT NULL DEFAULT 'UNKNOWN',
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `CameraCatalogVariant_identityKey_key`(`identityKey`),
    INDEX `CameraCatalogVariant_modelId_hardwareVersion_region_idx`(`modelId`, `hardwareVersion`, `region`),
    INDEX `CameraCatalogVariant_hardwareVersion_idx`(`hardwareVersion`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CameraCatalogCapability` (
    `id` CHAR(36) NOT NULL,
    `variantId` CHAR(36) NOT NULL,
    `capability` ENUM('VIDEO', 'AUDIO_INPUT', 'AUDIO_OUTPUT', 'TWO_WAY_AUDIO', 'PTZ', 'PAN', 'TILT', 'OPTICAL_ZOOM', 'DIGITAL_ZOOM', 'NIGHT_VISION', 'IR', 'COLOR_NIGHT_VISION', 'MOTION_DETECTION', 'PERSON_DETECTION', 'VEHICLE_DETECTION', 'SOUND_DETECTION', 'SD_CARD', 'SNAPSHOT', 'EVENTS', 'MULTI_STREAM', 'LOCAL_STREAMING') NOT NULL,
    `support` ENUM('SUPPORTED', 'UNSUPPORTED', 'UNKNOWN') NOT NULL DEFAULT 'UNKNOWN',
    `confidence` ENUM('OFFICIAL_CONFIRMED', 'COMMUNITY_CONFIRMED', 'LAB_VERIFIED', 'INFERRED', 'UNVERIFIED') NOT NULL DEFAULT 'UNVERIFIED',
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `CameraCatalogCapability_capability_support_idx`(`capability`, `support`),
    UNIQUE INDEX `CameraCatalogCapability_variantId_capability_key`(`variantId`, `capability`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CameraCatalogProtocol` (
    `id` CHAR(36) NOT NULL,
    `variantId` CHAR(36) NOT NULL,
    `protocol` ENUM('ONVIF', 'RTSP', 'HTTP', 'HTTPS', 'WEBSOCKET', 'MANUFACTURER_PROPRIETARY', 'PROPRIETARY_P2P', 'CLOUD_ONLY') NOT NULL,
    `support` ENUM('SUPPORTED', 'UNSUPPORTED', 'UNKNOWN') NOT NULL DEFAULT 'UNKNOWN',
    `confidence` ENUM('OFFICIAL_CONFIRMED', 'COMMUNITY_CONFIRMED', 'LAB_VERIFIED', 'INFERRED', 'UNVERIFIED') NOT NULL DEFAULT 'UNVERIFIED',
    `defaultPort` INTEGER NULL,
    `portConfigurable` ENUM('SUPPORTED', 'UNSUPPORTED', 'UNKNOWN') NOT NULL DEFAULT 'UNKNOWN',
    `mainStreamPath` VARCHAR(255) NULL,
    `secondaryStreamPath` VARCHAR(255) NULL,
    `otherStreams` JSON NULL,
    `authenticationRequired` ENUM('SUPPORTED', 'UNSUPPORTED', 'UNKNOWN') NOT NULL DEFAULT 'UNKNOWN',
    `transport` VARCHAR(40) NULL,
    `onvifProfiles` JSON NULL,
    `onvifPtz` ENUM('SUPPORTED', 'UNSUPPORTED', 'UNKNOWN') NOT NULL DEFAULT 'UNKNOWN',
    `onvifDiscovery` ENUM('SUPPORTED', 'UNSUPPORTED', 'UNKNOWN') NOT NULL DEFAULT 'UNKNOWN',
    `onvifEvents` ENUM('SUPPORTED', 'UNSUPPORTED', 'UNKNOWN') NOT NULL DEFAULT 'UNKNOWN',
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `CameraCatalogProtocol_protocol_support_idx`(`protocol`, `support`),
    UNIQUE INDEX `CameraCatalogProtocol_variantId_protocol_key`(`variantId`, `protocol`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CameraCatalogProvisioning` (
    `id` CHAR(36) NOT NULL,
    `variantId` CHAR(36) NOT NULL,
    `type` ENUM('VIGION_DIRECT', 'ONVIF_DISCOVERY', 'RTSP_MANUAL', 'MANUFACTURER_QR', 'MANUFACTURER_APP_REQUIRED', 'MANUFACTURER_CLOUD_REQUIRED', 'AP_MODE', 'BLUETOOTH_ASSISTED', 'QR_WIFI', 'PROPRIETARY_P2P', 'MANUAL', 'UNKNOWN') NOT NULL,
    `support` ENUM('SUPPORTED', 'UNSUPPORTED', 'UNKNOWN') NOT NULL DEFAULT 'UNKNOWN',
    `confidence` ENUM('OFFICIAL_CONFIRMED', 'COMMUNITY_CONFIRMED', 'LAB_VERIFIED', 'INFERRED', 'UNVERIFIED') NOT NULL DEFAULT 'UNVERIFIED',
    `priority` INTEGER NOT NULL DEFAULT 100,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `CameraCatalogProvisioning_type_support_idx`(`type`, `support`),
    UNIQUE INDEX `CameraCatalogProvisioning_variantId_type_key`(`variantId`, `type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CameraCatalogCompatibility` (
    `id` CHAR(36) NOT NULL,
    `variantId` CHAR(36) NOT NULL,
    `level` ENUM('SUPPORTED', 'PARTIAL', 'EXPERIMENTAL', 'PROPRIETARY_ONLY', 'UNSUPPORTED', 'UNKNOWN') NOT NULL DEFAULT 'UNKNOWN',
    `reason` TEXT NULL,
    `strategy` VARCHAR(255) NULL,
    `confidence` ENUM('OFFICIAL_CONFIRMED', 'COMMUNITY_CONFIRMED', 'LAB_VERIFIED', 'INFERRED', 'UNVERIFIED') NOT NULL DEFAULT 'UNVERIFIED',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `CameraCatalogCompatibility_variantId_key`(`variantId`),
    INDEX `CameraCatalogCompatibility_level_confidence_idx`(`level`, `confidence`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CameraCatalogSource` (
    `id` CHAR(36) NOT NULL,
    `manufacturerId` CHAR(36) NULL,
    `modelId` CHAR(36) NULL,
    `variantId` CHAR(36) NULL,
    `type` ENUM('MANUFACTURER_DOCUMENTATION', 'MANUFACTURER_SUPPORT', 'COMMUNITY_DOCUMENTATION', 'LAB_REPORT', 'IMPORTED_SPREADSHEET', 'OTHER') NOT NULL,
    `title` VARCHAR(255) NOT NULL,
    `url` VARCHAR(1000) NULL,
    `publisher` VARCHAR(160) NULL,
    `accessedAt` DATETIME(3) NULL,
    `notes` TEXT NULL,
    `fingerprint` CHAR(64) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `CameraCatalogSource_fingerprint_key`(`fingerprint`),
    INDEX `CameraCatalogSource_manufacturerId_idx`(`manufacturerId`),
    INDEX `CameraCatalogSource_modelId_idx`(`modelId`),
    INDEX `CameraCatalogSource_variantId_idx`(`variantId`),
    INDEX `CameraCatalogSource_type_idx`(`type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `Camera_catalogVariantId_idx` ON `Camera`(`catalogVariantId`);

-- AddForeignKey
ALTER TABLE `Camera` ADD CONSTRAINT `Camera_catalogVariantId_fkey` FOREIGN KEY (`catalogVariantId`) REFERENCES `CameraCatalogVariant`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CameraCatalogBrand` ADD CONSTRAINT `CameraCatalogBrand_manufacturerId_fkey` FOREIGN KEY (`manufacturerId`) REFERENCES `CameraCatalogManufacturer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CameraCatalogFamily` ADD CONSTRAINT `CameraCatalogFamily_brandId_fkey` FOREIGN KEY (`brandId`) REFERENCES `CameraCatalogBrand`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CameraCatalogModel` ADD CONSTRAINT `CameraCatalogModel_brandId_fkey` FOREIGN KEY (`brandId`) REFERENCES `CameraCatalogBrand`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CameraCatalogModel` ADD CONSTRAINT `CameraCatalogModel_familyId_fkey` FOREIGN KEY (`familyId`) REFERENCES `CameraCatalogFamily`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CameraCatalogAlias` ADD CONSTRAINT `CameraCatalogAlias_modelId_fkey` FOREIGN KEY (`modelId`) REFERENCES `CameraCatalogModel`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CameraCatalogVariant` ADD CONSTRAINT `CameraCatalogVariant_modelId_fkey` FOREIGN KEY (`modelId`) REFERENCES `CameraCatalogModel`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CameraCatalogCapability` ADD CONSTRAINT `CameraCatalogCapability_variantId_fkey` FOREIGN KEY (`variantId`) REFERENCES `CameraCatalogVariant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CameraCatalogProtocol` ADD CONSTRAINT `CameraCatalogProtocol_variantId_fkey` FOREIGN KEY (`variantId`) REFERENCES `CameraCatalogVariant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CameraCatalogProvisioning` ADD CONSTRAINT `CameraCatalogProvisioning_variantId_fkey` FOREIGN KEY (`variantId`) REFERENCES `CameraCatalogVariant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CameraCatalogCompatibility` ADD CONSTRAINT `CameraCatalogCompatibility_variantId_fkey` FOREIGN KEY (`variantId`) REFERENCES `CameraCatalogVariant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CameraCatalogSource` ADD CONSTRAINT `CameraCatalogSource_manufacturerId_fkey` FOREIGN KEY (`manufacturerId`) REFERENCES `CameraCatalogManufacturer`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CameraCatalogSource` ADD CONSTRAINT `CameraCatalogSource_modelId_fkey` FOREIGN KEY (`modelId`) REFERENCES `CameraCatalogModel`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CameraCatalogSource` ADD CONSTRAINT `CameraCatalogSource_variantId_fkey` FOREIGN KEY (`variantId`) REFERENCES `CameraCatalogVariant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
