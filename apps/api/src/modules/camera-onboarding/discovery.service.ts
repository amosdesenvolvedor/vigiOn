import { createHash, randomUUID } from 'node:crypto';
import { Prisma, type DiscoveryMatchConfidence, type PrismaClient } from '@prisma/client';
import { env } from '../../config/env';
import { realtimeService } from '../realtime/realtime.service';
import { AuthError } from '../auth/auth.errors';
import type { RequestMetadata } from '../auth/auth.types';
import type { TenantContext } from '../tenancy/tenant-context';
import type { GatewayDiscoveryResult, StartDiscoveryInput } from './discovery.schemas';

const SESSION_TTL_MS = 10 * 60_000;
const SCAN_TIMEOUT_SECONDS = Math.min(45, Math.max(20, env.GATEWAY_COMMAND_TTL_SECONDS));
const fail = (status: number, code: string, message: string) =>
  new AuthError(status, code, message);
const normalize = (value?: string | null) =>
  value?.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('pt-BR') ?? '';

export class CameraDiscoveryService {
  constructor(private readonly prisma: PrismaClient) {}

  async start(context: TenantContext, input: StartDiscoveryInput, metadata: RequestMetadata) {
    await this.cleanup();
    const gateway = await this.prisma.gateway.findFirst({
      where: { id: input.gatewayId, organizationId: context.organizationId, deletedAt: null },
      select: { id: true, status: true, protocolVersion: true },
    });
    if (!gateway) throw fail(404, 'GATEWAY_NOT_FOUND', 'Gateway not found');
    if (gateway.status !== 'ONLINE') throw fail(409, 'GATEWAY_OFFLINE', 'Gateway is offline');
    let expected = {
      manufacturer: input.expectedManufacturer,
      model: input.expectedModel,
      variant: input.expectedVariant,
    };
    if (input.catalogVariantId) {
      const variant = await this.prisma.cameraCatalogVariant.findUnique({
        where: { id: input.catalogVariantId },
        include: { model: { include: { brand: { include: { manufacturer: true } } } } },
      });
      if (!variant) throw fail(404, 'CATALOG_VARIANT_NOT_FOUND', 'Catalog variant not found');
      expected = {
        manufacturer: variant.model.brand.manufacturer.name,
        model: variant.model.name,
        variant: variant.hardwareVersion ?? variant.name ?? undefined,
      };
    }
    const now = new Date();
    const commandId = randomUUID();
    const session = await this.prisma.$transaction(async (tx) => {
      const created = await tx.cameraDiscoverySession.create({
        data: {
          organizationId: context.organizationId,
          gatewayId: gateway.id,
          userId: context.userId,
          ...(input.catalogVariantId ? { catalogVariantId: input.catalogVariantId } : {}),
          ...(expected.manufacturer ? { expectedManufacturer: expected.manufacturer } : {}),
          ...(expected.model ? { expectedModel: expected.model } : {}),
          ...(expected.variant ? { expectedVariant: expected.variant } : {}),
          expectedIdentifiers: input.identifiers,
          status: 'DISPATCHED',
          startedAt: now,
          expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
        },
      });
      await tx.gatewayCommand.create({
        data: {
          organizationId: context.organizationId,
          gatewayId: gateway.id,
          commandId,
          type: 'CAMERA_DISCOVERY_START',
          payload: {
            sessionId: created.id,
            organizationId: context.organizationId,
            gatewayId: gateway.id,
            protocolVersion: '1',
            timestamp: now.toISOString(),
            timeoutSeconds: SCAN_TIMEOUT_SECONDS,
            mechanisms: ['ONVIF_WS_DISCOVERY'],
          },
          expiresAt: new Date(now.getTime() + SCAN_TIMEOUT_SECONDS * 1000 + 30_000),
        },
      });
      await tx.auditLog.create({
        data: {
          organizationId: context.organizationId,
          actorUserId: context.userId,
          action: 'CAMERA_DISCOVERY_STARTED',
          entityType: 'CameraDiscoverySession',
          entityId: created.id,
          metadata: { gatewayId: gateway.id },
          ...metadata,
        },
      });
      return created;
    });
    console.info(
      JSON.stringify({
        event: 'discovery_started',
        organizationId: context.organizationId,
        gatewayId: gateway.id,
        sessionId: session.id,
      }),
    );
    return this.view(context, session.id);
  }

  async view(context: TenantContext, id: string) {
    await this.expire(id, context.organizationId);
    const session = await this.prisma.cameraDiscoverySession.findFirst({
      where: { id, organizationId: context.organizationId },
      include: {
        candidates: {
          where: { classification: { in: ['CAMERA_CANDIDATE', 'POSSIBLE_CAMERA'] } },
          orderBy: [{ confidence: 'asc' }, { createdAt: 'asc' }],
        },
      },
    });
    if (!session) throw fail(404, 'DISCOVERY_NOT_FOUND', 'Discovery session not found');
    return {
      id: session.id,
      gatewayId: session.gatewayId,
      status: session.status,
      expectedManufacturer: session.expectedManufacturer,
      expectedModel: session.expectedModel,
      expectedVariant: session.expectedVariant,
      expiresAt: session.expiresAt,
      confirmedCandidateId: session.confirmedCandidateId,
      candidates: session.candidates.map((candidate) => ({
        id: candidate.id,
        networkAddress: candidate.networkAddress,
        servicePort: candidate.servicePort,
        manufacturer: candidate.manufacturer,
        model: candidate.model,
        hardwareInfo: candidate.hardwareInfo,
        confidence: candidate.confidence,
        classification: candidate.classification,
        authenticationRequired: candidate.authenticationRequired,
        alreadyRegistered: candidate.alreadyRegistered,
      })),
    };
  }

  async cancel(context: TenantContext, id: string, metadata: RequestMetadata) {
    const session = await this.owned(context, id);
    if (['CANCELED', 'COMPLETED', 'EXPIRED', 'FAILED'].includes(session.status))
      return this.view(context, id);
    await this.prisma.$transaction([
      this.prisma.cameraDiscoverySession.update({
        where: { id },
        data: { status: 'CANCELED', completedAt: new Date() },
      }),
      this.prisma.gatewayCommand.create({
        data: {
          organizationId: context.organizationId,
          gatewayId: session.gatewayId,
          commandId: randomUUID(),
          type: 'CAMERA_DISCOVERY_CANCEL',
          payload: {
            sessionId: id,
            organizationId: context.organizationId,
            gatewayId: session.gatewayId,
            protocolVersion: '1',
            timestamp: new Date().toISOString(),
          },
          expiresAt: new Date(Date.now() + 60_000),
        },
      }),
      this.prisma.auditLog.create({
        data: {
          organizationId: context.organizationId,
          actorUserId: context.userId,
          action: 'CAMERA_DISCOVERY_CANCELED',
          entityType: 'CameraDiscoverySession',
          entityId: id,
          ...metadata,
        },
      }),
    ]);
    console.info(
      JSON.stringify({
        event: 'discovery_canceled',
        organizationId: context.organizationId,
        sessionId: id,
      }),
    );
    realtimeService.publish(context.organizationId, 'DISCOVERY_CHANGED', id);
    return this.view(context, id);
  }

  async confirm(
    context: TenantContext,
    id: string,
    candidateId: string,
    metadata: RequestMetadata,
  ) {
    const session = await this.owned(context, id);
    if (session.expiresAt <= new Date())
      throw fail(410, 'DISCOVERY_EXPIRED', 'Discovery session expired');
    const candidate = await this.prisma.cameraDiscoveryCandidate.findFirst({
      where: { id: candidateId, sessionId: id, organizationId: context.organizationId },
    });
    if (!candidate)
      throw fail(404, 'DISCOVERY_CANDIDATE_NOT_FOUND', 'Discovery candidate not found');
    if (candidate.alreadyRegistered)
      throw fail(409, 'ALREADY_REGISTERED', 'Camera is already registered');
    await this.prisma.$transaction([
      this.prisma.cameraDiscoverySession.update({
        where: { id },
        data: { status: 'COMPLETED', confirmedCandidateId: candidate.id, completedAt: new Date() },
      }),
      this.prisma.auditLog.create({
        data: {
          organizationId: context.organizationId,
          actorUserId: context.userId,
          action: 'CAMERA_DISCOVERY_CANDIDATE_CONFIRMED',
          entityType: 'CameraDiscoveryCandidate',
          entityId: candidate.id,
          metadata: { sessionId: id },
          ...metadata,
        },
      }),
    ]);
    console.info(
      JSON.stringify({
        event: 'candidate_confirmed',
        organizationId: context.organizationId,
        sessionId: id,
        candidateId: candidate.id,
      }),
    );
    realtimeService.publish(context.organizationId, 'DISCOVERY_CHANGED', id);
    return this.view(context, id);
  }

  async ingest(auth: NonNullable<Express.Request['gatewayAuth']>, input: GatewayDiscoveryResult) {
    let duplicate = false;
    try {
      await this.prisma.gatewayMessage.create({
        data: {
          organizationId: auth.organizationId,
          gatewayId: auth.gatewayId,
          messageId: input.messageId,
          type: 'CAMERA_DISCOVERY_RESULT',
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        duplicate = true;
      else throw error;
    }
    if (duplicate) return { accepted: true, duplicate: true };
    const command = await this.prisma.gatewayCommand.findFirst({
      where: {
        commandId: input.commandId,
        gatewayId: auth.gatewayId,
        organizationId: auth.organizationId,
        type: { in: ['CAMERA_DISCOVERY_START', 'CAMERA_DISCOVERY_CANCEL'] },
      },
    });
    const session = await this.prisma.cameraDiscoverySession.findFirst({
      where: {
        id: input.sessionId,
        gatewayId: auth.gatewayId,
        organizationId: auth.organizationId,
      },
    });
    if (!command || !session) throw fail(404, 'DISCOVERY_NOT_FOUND', 'Discovery session not found');
    if (session.expiresAt <= new Date() || ['CANCELED', 'EXPIRED'].includes(session.status))
      return { accepted: false, late: true };
    for (const observed of input.candidates) await this.upsertCandidate(session, observed);
    const count = await this.prisma.cameraDiscoveryCandidate.count({
      where: {
        sessionId: session.id,
        classification: { in: ['CAMERA_CANDIDATE', 'POSSIBLE_CAMERA'] },
      },
    });
    const status =
      input.status === 'FAILED'
        ? 'FAILED'
        : input.status === 'CANCELED'
          ? 'CANCELED'
          : input.status === 'COMPLETED'
            ? 'COMPLETED'
            : count
              ? 'RESULTS_AVAILABLE'
              : 'SCANNING';
    const terminal = ['COMPLETED', 'FAILED', 'CANCELED'].includes(input.status);
    await this.prisma.$transaction(async (tx) => {
      await tx.cameraDiscoverySession.update({
        where: { id: session.id },
        data: { status, ...(terminal ? { completedAt: new Date() } : {}) },
      });
      if (terminal)
        await tx.auditLog.create({
          data: {
            organizationId: auth.organizationId,
            action:
              input.status === 'FAILED'
                ? 'CAMERA_DISCOVERY_FAILED'
                : input.status === 'CANCELED'
                  ? 'CAMERA_DISCOVERY_CANCELED_BY_GATEWAY'
                  : 'CAMERA_DISCOVERY_COMPLETED',
            entityType: 'CameraDiscoverySession',
            entityId: session.id,
            metadata: { gatewayId: auth.gatewayId, candidateCount: count },
          },
        });
    });
    console.info(
      JSON.stringify({
        event:
          input.status === 'FAILED'
            ? 'discovery_failed'
            : input.status === 'COMPLETED'
              ? 'discovery_completed'
              : 'discovery_progress',
        organizationId: auth.organizationId,
        gatewayId: auth.gatewayId,
        sessionId: session.id,
        candidateCount: count,
        durationMs: Date.now() - session.createdAt.getTime(),
      }),
    );
    realtimeService.publish(auth.organizationId, 'DISCOVERY_CHANGED', session.id);
    return { accepted: true, duplicate: false };
  }

  private async upsertCandidate(
    session: {
      id: string;
      organizationId: string;
      expectedManufacturer: string | null;
      expectedModel: string | null;
      expectedVariant: string | null;
      expectedIdentifiers: Prisma.JsonValue | null;
    },
    observed: GatewayDiscoveryResult['candidates'][number],
  ) {
    const fingerprint = createHash('sha256')
      .update(
        `${observed.endpointReference ?? ''}|${observed.networkAddress}|${observed.servicePort}`,
      )
      .digest('hex');
    const factors: string[] = ['ONVIF_DISCOVERY_OBSERVED'];
    let points = 20;
    if (
      normalize(session.expectedManufacturer) &&
      normalize(session.expectedManufacturer) === normalize(observed.manufacturer)
    ) {
      points += 25;
      factors.push('MANUFACTURER_EXACT');
    }
    if (
      normalize(session.expectedModel) &&
      normalize(session.expectedModel) === normalize(observed.model)
    ) {
      points += 35;
      factors.push('MODEL_EXACT');
    }
    if (
      normalize(session.expectedVariant) &&
      normalize(session.expectedVariant) === normalize(observed.hardwareInfo)
    ) {
      points += 20;
      factors.push('VARIANT_EXACT');
    }
    const identifiers = Array.isArray(session.expectedIdentifiers)
      ? (session.expectedIdentifiers as Array<{ type?: string; value?: string }>)
      : [];
    const endpointMatch = identifiers.some(
      (item) =>
        item.type === 'ONVIF_ENDPOINT_REFERENCE' && item.value === observed.endpointReference,
    );
    if (endpointMatch) {
      points += 50;
      factors.push('ENDPOINT_REFERENCE_EXACT');
    }
    const confidence: DiscoveryMatchConfidence =
      endpointMatch && points >= 70
        ? 'EXACT'
        : points >= 75
          ? 'HIGH'
          : points >= 50
            ? 'MEDIUM'
            : points >= 25
              ? 'LOW'
              : 'UNKNOWN';
    const classification = points >= 50 ? 'CAMERA_CANDIDATE' : 'POSSIBLE_CAMERA';
    const alreadyRegistered = Boolean(
      observed.endpointReference &&
        (await this.prisma.camera.findFirst({
          where: {
            organizationId: session.organizationId,
            deletedAt: null,
            identifier: observed.endpointReference,
          },
          select: { id: true },
        })),
    );
    await this.prisma.cameraDiscoveryCandidate.upsert({
      where: { sessionId_fingerprint: { sessionId: session.id, fingerprint } },
      create: {
        organizationId: session.organizationId,
        sessionId: session.id,
        fingerprint,
        networkAddress: observed.networkAddress,
        servicePort: observed.servicePort,
        ...(observed.endpointReference ? { endpointReference: observed.endpointReference } : {}),
        ...(observed.manufacturer ? { manufacturer: observed.manufacturer } : {}),
        ...(observed.model ? { model: observed.model } : {}),
        ...(observed.hardwareInfo ? { hardwareInfo: observed.hardwareInfo } : {}),
        authenticationRequired: observed.authenticationRequired,
        detectedCapabilities: { ONVIF_DISCOVERY: true },
        matchFactors: factors,
        confidence,
        classification,
        alreadyRegistered,
      },
      update: {
        networkAddress: observed.networkAddress,
        servicePort: observed.servicePort,
        authenticationRequired: observed.authenticationRequired,
        matchFactors: factors,
        confidence,
        classification,
        alreadyRegistered,
      },
    });
  }

  private async owned(context: TenantContext, id: string) {
    await this.expire(id, context.organizationId);
    const session = await this.prisma.cameraDiscoverySession.findFirst({
      where: { id, organizationId: context.organizationId },
    });
    if (!session) throw fail(404, 'DISCOVERY_NOT_FOUND', 'Discovery session not found');
    return session;
  }
  private async expire(id: string, organizationId: string) {
    await this.prisma.cameraDiscoverySession.updateMany({
      where: {
        id,
        organizationId,
        expiresAt: { lte: new Date() },
        status: { notIn: ['COMPLETED', 'CANCELED', 'FAILED', 'EXPIRED'] },
      },
      data: { status: 'EXPIRED', completedAt: new Date() },
    });
  }
  async cleanup() {
    const cutoff = new Date();
    await this.prisma.cameraDiscoveryCandidate.deleteMany({
      where: { session: { expiresAt: { lt: cutoff } } },
    });
    await this.prisma.cameraDiscoverySession.deleteMany({ where: { expiresAt: { lt: cutoff } } });
  }
}
