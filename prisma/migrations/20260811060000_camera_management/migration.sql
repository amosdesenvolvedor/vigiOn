ALTER TABLE `Camera`
  ADD COLUMN `administrativeStatus` ENUM('ACTIVE', 'DISABLED') NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN `connectionStatus` ENUM('UNKNOWN', 'CONNECTING', 'ONLINE', 'OFFLINE', 'ERROR') NOT NULL DEFAULT 'UNKNOWN';

UPDATE `Camera` SET
  `administrativeStatus` = IF(`status` = 'DISABLED', 'DISABLED', 'ACTIVE'),
  `connectionStatus` = CASE
    WHEN `status` = 'ONLINE' THEN 'ONLINE'
    WHEN `status` = 'OFFLINE' THEN 'OFFLINE'
    WHEN `status` = 'ERROR' THEN 'ERROR'
    ELSE 'UNKNOWN'
  END;

DROP INDEX `Camera_organizationId_status_deletedAt_idx` ON `Camera`;
ALTER TABLE `Camera` DROP COLUMN `status`;
CREATE INDEX `Camera_organizationId_administrativeStatus_deletedAt_idx` ON `Camera`(`organizationId`, `administrativeStatus`, `deletedAt`);
CREATE INDEX `Camera_organizationId_connectionStatus_deletedAt_idx` ON `Camera`(`organizationId`, `connectionStatus`, `deletedAt`);

ALTER TABLE `Camera` MODIFY `connectionType` ENUM('DIRECT', 'GATEWAY', 'CLOUD', 'WIFI', 'ETHERNET', 'OTHER') NOT NULL DEFAULT 'OTHER';
UPDATE `Camera` SET `connectionType` = 'OTHER' WHERE `connectionType` IN ('DIRECT', 'GATEWAY', 'CLOUD');
ALTER TABLE `Camera` MODIFY `connectionType` ENUM('WIFI', 'ETHERNET', 'OTHER') NOT NULL DEFAULT 'OTHER';
ALTER TABLE `Camera` MODIFY `identifier` VARCHAR(191) NULL;
