ALTER TABLE `Subscription`
  ADD COLUMN `billingProvider` ENUM('MERCADO_PAGO') NULL,
  ADD COLUMN `providerSubscriptionId` VARCHAR(191) NULL,
  ADD UNIQUE INDEX `Subscription_providerSubscriptionId_key` (`providerSubscriptionId`);

CREATE TABLE `BillingCheckoutSession` (
  `id` CHAR(36) NOT NULL, `organizationId` CHAR(36) NOT NULL, `subscriptionId` CHAR(36) NULL,
  `planId` CHAR(36) NOT NULL, `requestedById` CHAR(36) NOT NULL,
  `provider` ENUM('MERCADO_PAGO') NOT NULL DEFAULT 'MERCADO_PAGO',
  `providerCheckoutId` VARCHAR(191) NULL, `idempotencyKey` CHAR(36) NOT NULL,
  `status` ENUM('PENDING','COMPLETED','EXPIRED','FAILED') NOT NULL DEFAULT 'PENDING',
  `amountCents` INTEGER NOT NULL, `currency` CHAR(3) NOT NULL, `checkoutUrl` VARCHAR(2048) NULL,
  `expiresAt` DATETIME(3) NOT NULL, `completedAt` DATETIME(3) NULL, `errorCode` VARCHAR(64) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `BillingCheckoutSession_providerCheckoutId_key` (`providerCheckoutId`),
  UNIQUE INDEX `BillingCheckoutSession_organizationId_idempotencyKey_key` (`organizationId`,`idempotencyKey`),
  INDEX `BillingCheckoutSession_organizationId_createdAt_idx` (`organizationId`,`createdAt`),
  INDEX `BillingCheckoutSession_status_expiresAt_idx` (`status`,`expiresAt`), PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `Invoice` (
  `id` CHAR(36) NOT NULL, `organizationId` CHAR(36) NOT NULL, `subscriptionId` CHAR(36) NULL,
  `provider` ENUM('MERCADO_PAGO') NOT NULL DEFAULT 'MERCADO_PAGO', `providerInvoiceId` VARCHAR(191) NULL,
  `status` ENUM('OPEN','PAID','VOID','UNCOLLECTIBLE','CANCELED') NOT NULL DEFAULT 'OPEN',
  `amountCents` INTEGER NOT NULL, `currency` CHAR(3) NOT NULL, `periodStart` DATETIME(3) NOT NULL,
  `periodEnd` DATETIME(3) NOT NULL, `dueAt` DATETIME(3) NULL, `paidAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `Invoice_providerInvoiceId_key` (`providerInvoiceId`),
  INDEX `Invoice_organizationId_createdAt_idx` (`organizationId`,`createdAt`),
  INDEX `Invoice_subscriptionId_createdAt_idx` (`subscriptionId`,`createdAt`),
  INDEX `Invoice_status_createdAt_idx` (`status`,`createdAt`), PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `Payment` (
  `id` CHAR(36) NOT NULL, `organizationId` CHAR(36) NOT NULL, `subscriptionId` CHAR(36) NULL,
  `invoiceId` CHAR(36) NULL, `checkoutSessionId` CHAR(36) NULL,
  `provider` ENUM('MERCADO_PAGO') NOT NULL DEFAULT 'MERCADO_PAGO', `providerPaymentId` VARCHAR(191) NOT NULL,
  `status` ENUM('PENDING','AUTHORIZED','PAID','FAILED','CANCELED','REFUNDED','EXPIRED') NOT NULL DEFAULT 'PENDING',
  `amountCents` INTEGER NOT NULL, `currency` CHAR(3) NOT NULL,
  `paymentMethod` ENUM('PIX','CARD','BOLETO','UNKNOWN') NOT NULL DEFAULT 'UNKNOWN',
  `description` VARCHAR(255) NULL, `paidAt` DATETIME(3) NULL, `failedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `Payment_providerPaymentId_key` (`providerPaymentId`),
  INDEX `Payment_organizationId_createdAt_idx` (`organizationId`,`createdAt`),
  INDEX `Payment_subscriptionId_createdAt_idx` (`subscriptionId`,`createdAt`),
  INDEX `Payment_status_createdAt_idx` (`status`,`createdAt`), PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `BillingWebhookEvent` (
  `id` CHAR(36) NOT NULL, `provider` ENUM('MERCADO_PAGO') NOT NULL, `providerEventId` VARCHAR(191) NOT NULL,
  `type` VARCHAR(100) NOT NULL, `resourceId` VARCHAR(191) NULL,
  `status` ENUM('RECEIVED','PROCESSED','IGNORED','FAILED') NOT NULL DEFAULT 'RECEIVED',
  `receivedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `processedAt` DATETIME(3) NULL,
  `errorCode` VARCHAR(64) NULL,
  UNIQUE INDEX `BillingWebhookEvent_provider_providerEventId_key` (`provider`,`providerEventId`),
  INDEX `BillingWebhookEvent_status_receivedAt_idx` (`status`,`receivedAt`), PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `BillingCheckoutSession` ADD CONSTRAINT `BillingCheckoutSession_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `BillingCheckoutSession` ADD CONSTRAINT `BillingCheckoutSession_subscriptionId_fkey` FOREIGN KEY (`subscriptionId`) REFERENCES `Subscription`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `BillingCheckoutSession` ADD CONSTRAINT `BillingCheckoutSession_planId_fkey` FOREIGN KEY (`planId`) REFERENCES `Plan`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `Invoice` ADD CONSTRAINT `Invoice_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `Invoice` ADD CONSTRAINT `Invoice_subscriptionId_fkey` FOREIGN KEY (`subscriptionId`) REFERENCES `Subscription`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `Payment` ADD CONSTRAINT `Payment_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `Payment` ADD CONSTRAINT `Payment_subscriptionId_fkey` FOREIGN KEY (`subscriptionId`) REFERENCES `Subscription`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `Payment` ADD CONSTRAINT `Payment_invoiceId_fkey` FOREIGN KEY (`invoiceId`) REFERENCES `Invoice`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `Payment` ADD CONSTRAINT `Payment_checkoutSessionId_fkey` FOREIGN KEY (`checkoutSessionId`) REFERENCES `BillingCheckoutSession`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
