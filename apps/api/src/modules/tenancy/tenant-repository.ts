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

  listNotifications() {
    return this.client.notification.findMany({
      where: tenantWhere(this.context, { userId: this.context.userId }),
      orderBy: { createdAt: 'desc' },
    });
  }
}
