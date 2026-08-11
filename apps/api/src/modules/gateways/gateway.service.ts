import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { env } from '../../config/env';
import { AuthError } from '../auth/auth.errors';
import type { RequestMetadata } from '../auth/auth.types';
import type { TenantContext } from '../tenancy/tenant-context';
import { createGatewaySecret, hashGatewaySecret, hashPairingCode } from './gateway.secret';

const fail = (status: number, code: string, message: string) =>
  new AuthError(status, code, message);
const gatewaySelect = {
  id: true,
  name: true,
  deviceId: true,
  status: true,
  version: true,
  protocolVersion: true,
  lastSeenAt: true,
  lastUptime: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { cameras: { where: { deletedAt: null } }, commands: true } },
} satisfies Prisma.GatewaySelect;

export class GatewayService {
  constructor(private readonly prisma: PrismaClient) {}

  async generatePairing(context: TenantContext, metadata: RequestMetadata) {
    const raw = randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase();
    const code = `VIGION-${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8)}`;
    const expiresAt = new Date(Date.now() + env.GATEWAY_PAIRING_TTL_MINUTES * 60_000);
    await this.prisma.$transaction([
      this.prisma.gatewayPairingCode.create({
        data: {
          organizationId: context.organizationId,
          createdById: context.userId,
          codeHash: hashPairingCode(code),
          expiresAt,
        },
      }),
      this.prisma.auditLog.create({
        data: {
          organizationId: context.organizationId,
          actorUserId: context.userId,
          action: 'GATEWAY_PAIRING_CREATED',
          entityType: 'GatewayPairingCode',
          metadata: { expiresAt },
          ...metadata,
        },
      }),
    ]);
    return { pairingCode: code, expiresAt };
  }

  async claim(
    input: {
      pairingCode: string;
      name: string;
      version: string;
      protocolVersion: '1';
      encryptionPublicKey?: string | undefined;
    },
    metadata: RequestMetadata,
  ) {
    const pairing = await this.prisma.gatewayPairingCode.findUnique({
      where: { codeHash: hashPairingCode(input.pairingCode) },
    });
    if (!pairing) throw fail(400, 'PAIRING_CODE_INVALID', 'Invalid pairing code');
    if (pairing.status !== 'PENDING')
      throw fail(409, 'PAIRING_CODE_INVALID', 'Pairing code is no longer available');
    if (pairing.expiresAt <= new Date()) {
      await this.prisma.gatewayPairingCode.update({
        where: { id: pairing.id },
        data: { status: 'EXPIRED' },
      });
      throw fail(410, 'PAIRING_CODE_EXPIRED', 'Pairing code expired');
    }
    const secret = createGatewaySecret();
    const gateway = await this.prisma.$transaction(async (tx) => {
      const consumed = await tx.gatewayPairingCode.updateMany({
        where: { id: pairing.id, status: 'PENDING', expiresAt: { gt: new Date() } },
        data: { status: 'USED', usedAt: new Date() },
      });
      if (!consumed.count)
        throw fail(409, 'PAIRING_CODE_INVALID', 'Pairing code is no longer available');
      const created = await tx.gateway.create({
        data: {
          organizationId: pairing.organizationId,
          name: input.name,
          deviceId: randomUUID(),
          secretHash: hashGatewaySecret(secret),
          version: input.version,
          protocolVersion: input.protocolVersion,
          ...(input.encryptionPublicKey ? { encryptionPublicKey: input.encryptionPublicKey } : {}),
        },
        select: gatewaySelect,
      });
      await tx.gatewayPairingCode.update({
        where: { id: pairing.id },
        data: { gatewayId: created.id },
      });
      await tx.auditLog.create({
        data: {
          organizationId: pairing.organizationId,
          action: 'GATEWAY_CLAIMED',
          entityType: 'Gateway',
          entityId: created.id,
          metadata: { deviceId: created.deviceId, version: input.version, ...metadata },
        },
      });
      return created;
    });
    console.info(
      JSON.stringify({ event: 'gateway.connected', gatewayId: gateway.id, phase: 'claimed' }),
    );
    return {
      gateway,
      credential: { gatewayId: gateway.id, secret },
      heartbeatIntervalSeconds: Math.max(15, Math.floor(env.GATEWAY_OFFLINE_TIMEOUT_SECONDS / 3)),
      protocolVersion: '1',
    };
  }

  private async reconcileOffline(organizationId?: string) {
    const cutoff = new Date(Date.now() - env.GATEWAY_OFFLINE_TIMEOUT_SECONDS * 1000);
    await this.prisma.gateway.updateMany({
      where: {
        ...(organizationId ? { organizationId } : {}),
        status: { in: ['ONLINE', 'CONNECTING'] },
        lastSeenAt: { lt: cutoff },
        deletedAt: null,
      },
      data: { status: 'OFFLINE' },
    });
  }

  async list(context: TenantContext) {
    await this.reconcileOffline(context.organizationId);
    return this.prisma.gateway.findMany({
      where: { organizationId: context.organizationId, deletedAt: null },
      select: gatewaySelect,
      orderBy: { createdAt: 'desc' },
    });
  }
  async get(context: TenantContext, id: string) {
    await this.reconcileOffline(context.organizationId);
    const gateway = await this.prisma.gateway.findFirst({
      where: { id, organizationId: context.organizationId, deletedAt: null },
      select: {
        ...gatewaySelect,
        cameras: {
          where: { deletedAt: null },
          select: { id: true, name: true, connectionStatus: true, protocol: true },
        },
        commands: {
          take: 10,
          orderBy: { createdAt: 'desc' },
          select: { commandId: true, type: true, status: true, createdAt: true, completedAt: true },
        },
      },
    });
    if (!gateway) throw fail(404, 'GATEWAY_NOT_FOUND', 'Gateway not found');
    return gateway;
  }
  async update(
    context: TenantContext,
    id: string,
    input: { name?: string | undefined; status?: 'DISABLED' | 'UNKNOWN' | undefined },
    metadata: RequestMetadata,
  ) {
    await this.get(context, id);
    return this.prisma.$transaction(async (tx) => {
      const gateway = await tx.gateway.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.status === 'DISABLED'
            ? { disabledAt: new Date() }
            : input.status === 'UNKNOWN'
              ? { disabledAt: null, lastSeenAt: null }
              : {}),
        },
        select: gatewaySelect,
      });
      await tx.auditLog.create({
        data: {
          organizationId: context.organizationId,
          actorUserId: context.userId,
          action: input.status === 'DISABLED' ? 'GATEWAY_DISABLED' : 'GATEWAY_UPDATED',
          entityType: 'Gateway',
          entityId: id,
          metadata: { fields: Object.keys(input) },
          ...metadata,
        },
      });
      return gateway;
    });
  }
  async remove(context: TenantContext, id: string, metadata: RequestMetadata) {
    await this.get(context, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.camera.updateMany({
        where: { organizationId: context.organizationId, gatewayId: id },
        data: { gatewayId: null, connectionStatus: 'UNKNOWN' },
      });
      await tx.gateway.update({
        where: { id },
        data: { deletedAt: new Date(), status: 'DISABLED', disabledAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          organizationId: context.organizationId,
          actorUserId: context.userId,
          action: 'GATEWAY_DELETED',
          entityType: 'Gateway',
          entityId: id,
          ...metadata,
        },
      });
    });
  }
  async rotateCredential(context: TenantContext, id: string, metadata: RequestMetadata) {
    await this.get(context, id);
    const secret = createGatewaySecret();
    await this.prisma.$transaction([
      this.prisma.gateway.update({
        where: { id },
        data: { secretHash: hashGatewaySecret(secret), status: 'UNKNOWN', lastSeenAt: null },
      }),
      this.prisma.auditLog.create({
        data: {
          organizationId: context.organizationId,
          actorUserId: context.userId,
          action: 'GATEWAY_CREDENTIAL_ROTATED',
          entityType: 'Gateway',
          entityId: id,
          ...metadata,
        },
      }),
    ]);
    return { gatewayId: id, secret };
  }
  async associateCamera(
    context: TenantContext,
    gatewayId: string,
    cameraId: string,
    metadata: RequestMetadata,
  ) {
    await this.get(context, gatewayId);
    const camera = await this.prisma.camera.findFirst({
      where: { id: cameraId, organizationId: context.organizationId, deletedAt: null },
    });
    if (!camera) throw fail(404, 'CAMERA_NOT_FOUND', 'Camera not found');
    await this.prisma.$transaction([
      this.prisma.camera.update({
        where: { id: cameraId },
        data: { gatewayId, connectionStatus: 'UNKNOWN' },
      }),
      this.prisma.auditLog.create({
        data: {
          organizationId: context.organizationId,
          actorUserId: context.userId,
          action: 'CAMERA_GATEWAY_ASSOCIATED',
          entityType: 'Camera',
          entityId: cameraId,
          metadata: { gatewayId, previousGatewayId: camera.gatewayId },
          ...metadata,
        },
      }),
    ]);
  }
  async dissociateCamera(
    context: TenantContext,
    gatewayId: string,
    cameraId: string,
    metadata: RequestMetadata,
  ) {
    const result = await this.prisma.camera.updateMany({
      where: { id: cameraId, gatewayId, organizationId: context.organizationId, deletedAt: null },
      data: { gatewayId: null, connectionStatus: 'UNKNOWN' },
    });
    if (!result.count) throw fail(404, 'CAMERA_NOT_FOUND', 'Camera not found');
    await this.prisma.auditLog.create({
      data: {
        organizationId: context.organizationId,
        actorUserId: context.userId,
        action: 'CAMERA_GATEWAY_DISSOCIATED',
        entityType: 'Camera',
        entityId: cameraId,
        metadata: { gatewayId },
        ...metadata,
      },
    });
  }
  async queueCameraTest(context: TenantContext, gatewayId: string, cameraId: string) {
    const gateway = await this.get(context, gatewayId);
    if (gateway.status !== 'ONLINE') throw fail(409, 'GATEWAY_OFFLINE', 'Gateway is offline');
    const camera = await this.prisma.camera.findFirst({
      where: { id: cameraId, gatewayId, organizationId: context.organizationId, deletedAt: null },
      select: { id: true, protocol: true },
    });
    if (!camera) throw fail(404, 'CAMERA_NOT_FOUND', 'Camera not found');
    return this.prisma.gatewayCommand.create({
      data: {
        organizationId: context.organizationId,
        gatewayId,
        cameraId,
        commandId: randomUUID(),
        type: 'TEST_CAMERA',
        payload: { cameraId, protocol: camera.protocol },
        expiresAt: new Date(Date.now() + env.GATEWAY_COMMAND_TTL_SECONDS * 1000),
      },
      select: { commandId: true, type: true, status: true, expiresAt: true },
    });
  }

  async heartbeat(
    auth: Express.Request['gatewayAuth'],
    input: {
      messageId: string;
      version: string;
      protocolVersion: '1';
      timestamp: string;
      uptime?: number | undefined;
      status: 'ONLINE' | 'CONNECTING';
      encryptionPublicKey?: string | undefined;
    },
  ) {
    if (!auth) throw fail(401, 'GATEWAY_UNAUTHORIZED', 'Gateway authentication required');
    let duplicate = false;
    try {
      await this.prisma.gatewayMessage.create({
        data: {
          organizationId: auth.organizationId,
          gatewayId: auth.gatewayId,
          messageId: input.messageId,
          type: 'HEARTBEAT',
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        duplicate = true;
      else throw error;
    }
    if (!duplicate)
      await this.prisma.gateway.update({
        where: { id: auth.gatewayId },
        data: {
          status: input.status,
          version: input.version,
          protocolVersion: input.protocolVersion,
          lastSeenAt: new Date(),
          ...(input.uptime !== undefined ? { lastUptime: input.uptime } : {}),
          ...(input.encryptionPublicKey !== undefined
            ? { encryptionPublicKey: input.encryptionPublicKey }
            : {}),
        },
      });
    console.info(
      JSON.stringify({ event: 'gateway.heartbeat', gatewayId: auth.gatewayId, duplicate }),
    );
    return {
      accepted: true,
      duplicate,
      serverTimestamp: new Date(),
      nextHeartbeatSeconds: Math.max(15, Math.floor(env.GATEWAY_OFFLINE_TIMEOUT_SECONDS / 3)),
    };
  }
  async pollCommands(auth: NonNullable<Express.Request['gatewayAuth']>) {
    const now = new Date();
    await this.prisma.gatewayCommand.updateMany({
      where: {
        gatewayId: auth.gatewayId,
        organizationId: auth.organizationId,
        status: { in: ['PENDING', 'DELIVERED'] },
        expiresAt: { lte: now },
      },
      data: { status: 'EXPIRED', completedAt: now },
    });
    const commands = await this.prisma.gatewayCommand.findMany({
      where: {
        gatewayId: auth.gatewayId,
        organizationId: auth.organizationId,
        OR: [
          { status: 'PENDING' },
          { status: 'DELIVERED', deliveredAt: { lt: new Date(Date.now() - 10_000) } },
        ],
        expiresAt: { gt: now },
      },
      take: 20,
      orderBy: { createdAt: 'asc' },
      select: { commandId: true, type: true, payload: true, expiresAt: true },
    });
    if (commands.length)
      await this.prisma.gatewayCommand.updateMany({
        where: {
          commandId: { in: commands.map((item) => item.commandId) },
          status: { in: ['PENDING', 'DELIVERED'] },
        },
        data: { status: 'DELIVERED', deliveredAt: now },
      });
    return commands;
  }
  async acknowledge(
    auth: NonNullable<Express.Request['gatewayAuth']>,
    input: {
      messageId: string;
      commandId: string;
      status: string;
      details?: string | undefined;
    },
  ) {
    try {
      await this.prisma.gatewayMessage.create({
        data: {
          organizationId: auth.organizationId,
          gatewayId: auth.gatewayId,
          messageId: input.messageId,
          type: 'COMMAND_ACK',
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        return { accepted: true, duplicate: true };
      throw error;
    }
    const command = await this.prisma.gatewayCommand.findFirst({
      where: {
        commandId: input.commandId,
        gatewayId: auth.gatewayId,
        organizationId: auth.organizationId,
      },
    });
    if (!command) throw fail(404, 'COMMAND_NOT_FOUND', 'Command not found');
    const success = input.status === 'SUCCESS';
    await this.prisma.$transaction(async (tx) => {
      await tx.gatewayCommand.update({
        where: { id: command.id },
        data: {
          status: success ? 'SUCCEEDED' : 'FAILED',
          result: { status: input.status, ...(input.details ? { details: input.details } : {}) },
          completedAt: new Date(),
        },
      });
      if (command.cameraId && command.type === 'TEST_CAMERA')
        await tx.camera.updateMany({
          where: {
            id: command.cameraId,
            organizationId: auth.organizationId,
            gatewayId: auth.gatewayId,
          },
          data: {
            connectionStatus: success ? 'ONLINE' : input.status === 'TIMEOUT' ? 'OFFLINE' : 'ERROR',
            ...(success ? { lastSeenAt: new Date() } : {}),
          },
        });
      if (command.streamSessionId && command.type === 'START_STREAM')
        await tx.streamSession.updateMany({
          where: {
            id: command.streamSessionId,
            organizationId: auth.organizationId,
            gatewayId: auth.gatewayId,
            status: { in: ['REQUESTED', 'STARTING'] },
          },
          data: success
            ? { status: 'STARTING' }
            : {
                status: 'FAILED',
                endedAt: new Date(),
                errorCode:
                  input.status === 'TIMEOUT'
                    ? 'STREAM_TIMEOUT'
                    : input.status === 'UNSUPPORTED_CODEC'
                      ? 'UNSUPPORTED_CODEC'
                      : 'STREAM_START_FAILED',
              },
        });
      if (command.streamSessionId && command.type === 'STOP_STREAM')
        await tx.streamSession.updateMany({
          where: {
            id: command.streamSessionId,
            organizationId: auth.organizationId,
            gatewayId: auth.gatewayId,
            status: { notIn: ['ENDED', 'EXPIRED'] },
          },
          data: { status: 'ENDED', endedAt: new Date() },
        });
    });
    console.info(
      JSON.stringify({
        event:
          command.type === 'START_STREAM'
            ? success
              ? 'stream.starting'
              : 'stream.failed'
            : command.type === 'STOP_STREAM'
              ? 'stream.stopped'
              : success
                ? 'camera.connection_success'
                : input.status === 'TIMEOUT'
                  ? 'camera.timeout'
                  : 'camera.connection_failed',
        gatewayId: auth.gatewayId,
        cameraId: command.cameraId,
        streamSessionId: command.streamSessionId,
        result: input.status,
      }),
    );
    return { accepted: true, duplicate: false };
  }
}
