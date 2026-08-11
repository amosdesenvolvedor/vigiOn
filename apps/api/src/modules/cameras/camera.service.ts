import type {
  CameraAdministrativeStatus,
  CameraConnectionStatus,
  CameraConnectionType,
  CameraProtocol,
  Prisma,
  PrismaClient,
} from '@prisma/client';
import { AuthError } from '../auth/auth.errors';
import type { RequestMetadata } from '../auth/auth.types';
import { EntitlementService } from '../billing/entitlement.service';
import type { TenantContext } from '../tenancy/tenant-context';
import { CameraCredentialService } from './camera-credential.service';

type CameraInput = {
  name: string;
  description?: string | null | undefined;
  location?: string | null | undefined;
  manufacturer?: string | null | undefined;
  model?: string | null | undefined;
  identifier?: string | null | undefined;
  connectionType: CameraConnectionType;
  protocol: CameraProtocol;
  credentials?: { username: string; password: string } | undefined;
};
type CameraUpdateInput = {
  name?: string | undefined;
  description?: string | null | undefined;
  location?: string | null | undefined;
  manufacturer?: string | null | undefined;
  model?: string | null | undefined;
  identifier?: string | null | undefined;
  connectionType?: CameraConnectionType | undefined;
  protocol?: CameraProtocol | undefined;
};

const withoutUndefined = (value: object) =>
  Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));

const notFound = () => new AuthError(404, 'CAMERA_NOT_FOUND', 'Camera not found');
const cameraSelect = {
  id: true,
  gatewayId: true,
  name: true,
  description: true,
  location: true,
  administrativeStatus: true,
  connectionStatus: true,
  connectionType: true,
  protocol: true,
  manufacturer: true,
  model: true,
  identifier: true,
  lastSeenAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.CameraSelect;

export class CameraService {
  private readonly entitlements: EntitlementService;
  private readonly credentials = new CameraCredentialService();

  constructor(private readonly prisma: PrismaClient) {
    this.entitlements = new EntitlementService(prisma);
  }

  async create(context: TenantContext, input: CameraInput, metadata: RequestMetadata) {
    await this.entitlements.requireFeature(context.organizationId, 'LIVE_VIEW');
    await this.entitlements.reserveCamera(context.organizationId);
    const { credentials, ...data } = input;
    try {
      return await this.prisma.$transaction(async (tx) => {
        const camera = await tx.camera.create({
          data: {
            ...(withoutUndefined(data) as Prisma.CameraUncheckedCreateInput),
            organizationId: context.organizationId,
          },
          select: cameraSelect,
        });
        if (credentials)
          await this.credentials.store(tx, context.organizationId, camera.id, credentials);
        await tx.auditLog.create({
          data: {
            organizationId: context.organizationId,
            actorUserId: context.userId,
            action: 'CAMERA_CREATED',
            entityType: 'Camera',
            entityId: camera.id,
            metadata: { protocol: camera.protocol, connectionType: camera.connectionType },
            ...metadata,
          },
        });
        return camera;
      });
    } catch (error) {
      await this.entitlements.releaseCamera(context.organizationId);
      throw error;
    }
  }

  async list(
    context: TenantContext,
    query: {
      page: number;
      limit: number;
      administrativeStatus?: CameraAdministrativeStatus | undefined;
      connectionStatus?: CameraConnectionStatus | undefined;
      connectionType?: CameraConnectionType | undefined;
      protocol?: CameraProtocol | undefined;
      location?: string | undefined;
      search?: string | undefined;
      sortBy:
        | 'name'
        | 'createdAt'
        | 'updatedAt'
        | 'lastSeenAt'
        | 'administrativeStatus'
        | 'connectionStatus';
      sortOrder: 'asc' | 'desc';
    },
  ) {
    const where: Prisma.CameraWhereInput = {
      organizationId: context.organizationId,
      deletedAt: null,
      ...(query.administrativeStatus ? { administrativeStatus: query.administrativeStatus } : {}),
      ...(query.connectionStatus ? { connectionStatus: query.connectionStatus } : {}),
      ...(query.connectionType ? { connectionType: query.connectionType } : {}),
      ...(query.protocol ? { protocol: query.protocol } : {}),
      ...(query.location ? { location: { contains: query.location } } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search } },
              { location: { contains: query.search } },
              { manufacturer: { contains: query.search } },
              { model: { contains: query.search } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.camera.findMany({
        where,
        select: cameraSelect,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: { [query.sortBy]: query.sortOrder },
      }),
      this.prisma.camera.count({ where }),
    ]);
    return {
      items,
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        pages: Math.ceil(total / query.limit),
      },
    };
  }

  async get(context: TenantContext, id: string) {
    const camera = await this.prisma.camera.findFirst({
      where: { id, organizationId: context.organizationId, deletedAt: null },
      select: cameraSelect,
    });
    if (!camera) throw notFound();
    return camera;
  }

  async update(
    context: TenantContext,
    id: string,
    input: CameraUpdateInput,
    metadata: RequestMetadata,
  ) {
    await this.get(context, id);
    return this.prisma.$transaction(async (tx) => {
      const updateData = withoutUndefined(input) as Prisma.CameraUncheckedUpdateInput;
      const camera = await tx.camera.update({
        where: { id },
        data: updateData,
        select: cameraSelect,
      });
      await tx.auditLog.create({
        data: {
          organizationId: context.organizationId,
          actorUserId: context.userId,
          action: 'CAMERA_UPDATED',
          entityType: 'Camera',
          entityId: id,
          metadata: { fields: Object.keys(input) },
          ...metadata,
        },
      });
      return camera;
    });
  }

  async setAdministrativeStatus(
    context: TenantContext,
    id: string,
    status: CameraAdministrativeStatus,
    metadata: RequestMetadata,
  ) {
    await this.get(context, id);
    return this.prisma.$transaction(async (tx) => {
      const camera = await tx.camera.update({
        where: { id },
        data: { administrativeStatus: status },
        select: cameraSelect,
      });
      await tx.auditLog.create({
        data: {
          organizationId: context.organizationId,
          actorUserId: context.userId,
          action: status === 'DISABLED' ? 'CAMERA_DISABLED' : 'CAMERA_ENABLED',
          entityType: 'Camera',
          entityId: id,
          ...metadata,
        },
      });
      return camera;
    });
  }

  async updateCredentials(
    context: TenantContext,
    id: string,
    input: { username: string; password: string },
    metadata: RequestMetadata,
  ) {
    await this.get(context, id);
    await this.prisma.$transaction(async (tx) => {
      await this.credentials.store(tx, context.organizationId, id, input);
      await tx.auditLog.create({
        data: {
          organizationId: context.organizationId,
          actorUserId: context.userId,
          action: 'CAMERA_CREDENTIAL_UPDATED',
          entityType: 'Camera',
          entityId: id,
          ...metadata,
        },
      });
    });
  }

  async remove(context: TenantContext, id: string, metadata: RequestMetadata) {
    await this.prisma.$transaction(async (tx) => {
      const result = await tx.camera.updateMany({
        where: { id, organizationId: context.organizationId, deletedAt: null },
        data: { deletedAt: new Date(), administrativeStatus: 'DISABLED' },
      });
      if (!result.count) throw notFound();
      await tx.resourceCounter.updateMany({
        where: { organizationId: context.organizationId, cameraCount: { gt: 0 } },
        data: { cameraCount: { decrement: 1 }, version: { increment: 1 } },
      });
      await tx.auditLog.create({
        data: {
          organizationId: context.organizationId,
          actorUserId: context.userId,
          action: 'CAMERA_DELETED',
          entityType: 'Camera',
          entityId: id,
          ...metadata,
        },
      });
    });
  }

  async updateConnectionFromTrustedGateway(
    organizationId: string,
    id: string,
    status: CameraConnectionStatus,
    lastSeenAt?: Date,
  ) {
    return this.prisma.camera.updateMany({
      where: { id, organizationId, deletedAt: null },
      data: { connectionStatus: status, ...(lastSeenAt ? { lastSeenAt } : {}) },
    });
  }
}
