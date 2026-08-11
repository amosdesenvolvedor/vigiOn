UPDATE `StorageFile`
SET `status` = 'AVAILABLE', `uploadedAt` = `createdAt`
WHERE `sizeBytes` > 0 AND `status` = 'PENDING';
