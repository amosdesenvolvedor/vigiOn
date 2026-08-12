CREATE TABLE `MonitoringSchedule` (
  `id` CHAR(36) NOT NULL, `organizationId` CHAR(36) NOT NULL, `cameraId` CHAR(36) NULL,
  `scopeKey` VARCHAR(40) NOT NULL, `mode` ENUM('ALWAYS','SCHEDULED','DISABLED') NOT NULL DEFAULT 'SCHEDULED',
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`), UNIQUE INDEX `MonitoringSchedule_organizationId_scopeKey_key`(`organizationId`,`scopeKey`),
  INDEX `MonitoringSchedule_organizationId_idx`(`organizationId`),
  CONSTRAINT `MonitoringSchedule_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `MonitoringSchedule_organizationId_cameraId_fkey` FOREIGN KEY (`organizationId`,`cameraId`) REFERENCES `Camera`(`organizationId`,`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE `ScheduleInterval` (
  `id` CHAR(36) NOT NULL, `scheduleId` CHAR(36) NOT NULL, `weekday` INTEGER NOT NULL, `startMinute` INTEGER NOT NULL, `endMinute` INTEGER NOT NULL,
  PRIMARY KEY (`id`), INDEX `ScheduleInterval_scheduleId_weekday_idx`(`scheduleId`,`weekday`),
  CONSTRAINT `ScheduleInterval_scheduleId_fkey` FOREIGN KEY (`scheduleId`) REFERENCES `MonitoringSchedule`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE `ScheduleException` (
  `id` CHAR(36) NOT NULL, `organizationId` CHAR(36) NOT NULL, `scheduleId` CHAR(36) NOT NULL, `localDate` DATE NOT NULL,
  `mode` ENUM('OPEN','CLOSED') NOT NULL, `startMinute` INTEGER NULL, `endMinute` INTEGER NULL, `label` VARCHAR(120) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), PRIMARY KEY (`id`),
  UNIQUE INDEX `ScheduleException_scheduleId_localDate_key`(`scheduleId`,`localDate`), INDEX `ScheduleException_organizationId_localDate_idx`(`organizationId`,`localDate`),
  CONSTRAINT `ScheduleException_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `ScheduleException_scheduleId_fkey` FOREIGN KEY (`scheduleId`) REFERENCES `MonitoringSchedule`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE `CameraZone` (
  `id` CHAR(36) NOT NULL, `organizationId` CHAR(36) NOT NULL, `cameraId` CHAR(36) NOT NULL, `name` VARCHAR(120) NOT NULL,
  `priority` ENUM('NORMAL','HIGH') NOT NULL DEFAULT 'NORMAL', `polygon` JSON NOT NULL, `enabled` BOOLEAN NOT NULL DEFAULT true,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updatedAt` DATETIME(3) NOT NULL, PRIMARY KEY (`id`),
  INDEX `CameraZone_organizationId_cameraId_enabled_idx`(`organizationId`,`cameraId`,`enabled`),
  CONSTRAINT `CameraZone_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `CameraZone_organizationId_cameraId_fkey` FOREIGN KEY (`organizationId`,`cameraId`) REFERENCES `Camera`(`organizationId`,`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE `EventClassification` (
  `id` CHAR(36) NOT NULL, `organizationId` CHAR(36) NOT NULL, `eventId` CHAR(36) NOT NULL,
  `classification` ENUM('NORMAL_ACTIVITY','OUT_OF_HOURS_ACTIVITY','UNUSUAL_ACTIVITY','POSSIBLE_INTRUSION') NOT NULL,
  `riskScore` DECIMAL(4,3) NOT NULL, `riskLevel` ENUM('LOW','MEDIUM','HIGH','VERY_HIGH') NOT NULL,
  `riskFactors` JSON NOT NULL, `explanation` VARCHAR(500) NOT NULL, `engineVersion` INTEGER NOT NULL DEFAULT 1,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), PRIMARY KEY (`id`),
  UNIQUE INDEX `EventClassification_eventId_engineVersion_key`(`eventId`,`engineVersion`),
  INDEX `EventClassification_organizationId_createdAt_idx`(`organizationId`,`createdAt`),
  INDEX `EventClassification_org_class_risk_created_idx`(`organizationId`,`classification`,`riskLevel`,`createdAt`),
  CONSTRAINT `EventClassification_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `EventClassification_organizationId_eventId_fkey` FOREIGN KEY (`organizationId`,`eventId`) REFERENCES `CameraEvent`(`organizationId`,`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
