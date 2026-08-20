CREATE TABLE `AiConversation` (
  `id` CHAR(36) NOT NULL,
  `organizationId` CHAR(36) NOT NULL,
  `userId` CHAR(36) NOT NULL,
  `title` VARCHAR(160) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `AiConversation_organizationId_id_key` (`organizationId`, `id`),
  INDEX `AiConversation_organizationId_userId_updatedAt_idx` (`organizationId`, `userId`, `updatedAt`),
  CONSTRAINT `AiConversation_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `AiConversation_organizationId_userId_fkey` FOREIGN KEY (`organizationId`, `userId`) REFERENCES `User` (`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `AiMessage` (
  `id` CHAR(36) NOT NULL,
  `conversationId` CHAR(36) NOT NULL,
  `role` VARCHAR(16) NOT NULL,
  `content` TEXT NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `AiMessage_conversationId_createdAt_idx` (`conversationId`, `createdAt`),
  CONSTRAINT `AiMessage_conversationId_fkey` FOREIGN KEY (`conversationId`) REFERENCES `AiConversation` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `AiToolExecution` (
  `id` CHAR(36) NOT NULL,
  `conversationId` CHAR(36) NOT NULL,
  `tool` VARCHAR(80) NOT NULL,
  `status` VARCHAR(16) NOT NULL,
  `durationMs` INTEGER NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `AiToolExecution_conversationId_createdAt_idx` (`conversationId`, `createdAt`),
  CONSTRAINT `AiToolExecution_conversationId_fkey` FOREIGN KEY (`conversationId`) REFERENCES `AiConversation` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `AiUsageDay` (
  `id` CHAR(36) NOT NULL,
  `day` DATE NOT NULL,
  `scope` VARCHAR(16) NOT NULL,
  `scopeKey` VARCHAR(80) NOT NULL,
  `organizationId` CHAR(36) NULL,
  `userId` CHAR(36) NULL,
  `requests` INTEGER NOT NULL DEFAULT 0,
  `inputTokens` INTEGER NOT NULL DEFAULT 0,
  `outputTokens` INTEGER NOT NULL DEFAULT 0,
  `neurons` DOUBLE NOT NULL DEFAULT 0,
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `AiUsageDay_day_scopeKey_key` (`day`, `scopeKey`),
  INDEX `AiUsageDay_day_scope_idx` (`day`, `scope`),
  INDEX `AiUsageDay_organizationId_day_idx` (`organizationId`, `day`),
  INDEX `AiUsageDay_userId_day_idx` (`userId`, `day`),
  CONSTRAINT `AiUsageDay_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
