import type { PrismaClient } from '@prisma/client';
import type { TenantContext } from './tenant-context';
import { tenantWhere } from './tenant-context';

export class TenantRepository {
  constructor(
    private readonly client: PrismaClient,
    private readonly context: TenantContext,
  ) {}

  findCameraById(id: string) {
    return this.client.camera.findFirst({
      where: tenantWhere(this.context, { id, deletedAt: null }),
    });
  }

  findEventById(id: string) {
    return this.client.cameraEvent.findFirst({
      where: tenantWhere(this.context, { id }),
    });
  }

  findStorageFileById(id: string) {
    return this.client.storageFile.findFirst({ where: tenantWhere(this.context, { id }) });
  }

  findSubscriptionById(id: string) {
    return this.client.subscription.findFirst({ where: tenantWhere(this.context, { id }) });
  }

  findAuditLogById(id: string) {
    return this.client.auditLog.findFirst({ where: tenantWhere(this.context, { id }) });
  }

  findMembershipById(id: string) {
    return this.client.organizationMembership.findFirst({
      where: tenantWhere(this.context, { id, status: { not: 'REMOVED' as const } }),
    });
  }

  listNotifications() {
    return this.client.notification.findMany({
      where: tenantWhere(this.context, { userId: this.context.userId }),
      orderBy: { createdAt: 'desc' },
    });
  }
}
