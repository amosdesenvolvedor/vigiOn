import { Prisma, type PrismaClient } from '@prisma/client';
import { AuthError } from '../auth/auth.errors';
import type { RequestMetadata } from '../auth/auth.types';
import type { TenantContext } from '../tenancy/tenant-context';
import { ContextEngine } from './context-engine';
import { RiskEngine, RISK_ENGINE_VERSION, type RiskFactor } from './risk-engine';

export class IntelligenceService {
  private readonly context: ContextEngine;
  private readonly risk = new RiskEngine();
  constructor(private readonly prisma: PrismaClient) {
    this.context = new ContextEngine(prisma);
  }
  async process(eventId: string) {
    const started = Date.now();
    const existing = await this.prisma.eventClassification.findUnique({
      where: { eventId_engineVersion: { eventId, engineVersion: RISK_ENGINE_VERSION } },
    });
    if (existing) return existing;
    const context = await this.context.gather(eventId);
    if (context.event.type !== 'MOTION') return null;
    const factors: RiskFactor[] = [];
    if (context.outOfHours) factors.push('OUT_OF_HOURS');
    if (context.sensitiveZone) factors.push('SENSITIVE_ZONE');
    if (context.persistent) factors.push('PERSISTENT_ACTIVITY');
    const result = this.risk.calculate(factors);
    let classification;
    try {
      classification = await this.prisma.eventClassification.create({
        data: {
          organizationId: context.event.organizationId,
          eventId,
          classification: result.classification,
          riskScore: new Prisma.Decimal(result.score),
          riskLevel: result.riskLevel,
          riskFactors: result.factors,
          explanation: result.explanation,
          engineVersion: RISK_ENGINE_VERSION,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        return this.prisma.eventClassification.findUniqueOrThrow({
          where: { eventId_engineVersion: { eventId, engineVersion: RISK_ENGINE_VERSION } },
        });
      throw error;
    }
    console.info(
      JSON.stringify({
        event: 'classification.created',
        organizationId: context.event.organizationId,
        cameraId: context.event.cameraId,
        eventId,
        classification: result.classification,
        riskLevel: result.riskLevel,
        engineVersion: RISK_ENGINE_VERSION,
        processingTimeMs: Date.now() - started,
      }),
    );
    return classification;
  }
  listSchedules(context: TenantContext) {
    return this.prisma.monitoringSchedule.findMany({
      where: { organizationId: context.organizationId },
      include: { intervals: true, exceptions: true },
      orderBy: { createdAt: 'asc' },
    });
  }
  async saveSchedule(
    context: TenantContext,
    input: {
      cameraId: string | null;
      mode: 'ALWAYS' | 'SCHEDULED' | 'DISABLED';
      intervals: Array<{ weekday: number; startMinute: number; endMinute: number }>;
    },
    metadata: RequestMetadata,
  ) {
    if (
      input.cameraId &&
      !(await this.prisma.camera.count({
        where: { id: input.cameraId, organizationId: context.organizationId, deletedAt: null },
      }))
    )
      throw new AuthError(404, 'CAMERA_NOT_FOUND', 'Camera not found');
    const scopeKey = input.cameraId ?? 'ORG';
    return this.prisma.$transaction(async (tx) => {
      const old = await tx.monitoringSchedule.findUnique({
        where: { organizationId_scopeKey: { organizationId: context.organizationId, scopeKey } },
      });
      if (old) await tx.scheduleInterval.deleteMany({ where: { scheduleId: old.id } });
      const schedule = await tx.monitoringSchedule.upsert({
        where: { organizationId_scopeKey: { organizationId: context.organizationId, scopeKey } },
        create: {
          organizationId: context.organizationId,
          scopeKey,
          cameraId: input.cameraId,
          mode: input.mode,
          intervals: { create: input.intervals },
        },
        update: { mode: input.mode, intervals: { create: input.intervals } },
        include: { intervals: true, exceptions: true },
      });
      await tx.auditLog.create({
        data: {
          organizationId: context.organizationId,
          actorUserId: context.userId,
          action: old ? 'MONITORING_SCHEDULE_UPDATED' : 'MONITORING_SCHEDULE_CREATED',
          entityType: 'MonitoringSchedule',
          entityId: schedule.id,
          ...metadata,
        },
      });
      return schedule;
    });
  }
  async addException(
    context: TenantContext,
    scheduleId: string,
    input: {
      localDate: string;
      mode: 'OPEN' | 'CLOSED';
      startMinute: number | null;
      endMinute: number | null;
      label: string | null;
    },
    metadata: RequestMetadata,
  ) {
    const schedule = await this.prisma.monitoringSchedule.findFirst({
      where: { id: scheduleId, organizationId: context.organizationId },
    });
    if (!schedule) throw new AuthError(404, 'SCHEDULE_NOT_FOUND', 'Schedule not found');
    const localDate = new Date(`${input.localDate}T00:00:00.000Z`);
    return this.prisma.$transaction(async (tx) => {
      const item = await tx.scheduleException.upsert({
        where: { scheduleId_localDate: { scheduleId, localDate } },
        create: { organizationId: context.organizationId, scheduleId, ...input, localDate },
        update: { ...input, localDate },
      });
      await tx.auditLog.create({
        data: {
          organizationId: context.organizationId,
          actorUserId: context.userId,
          action: 'SCHEDULE_EXCEPTION_UPDATED',
          entityType: 'ScheduleException',
          entityId: item.id,
          ...metadata,
        },
      });
      return item;
    });
  }
  listZones(context: TenantContext) {
    return this.prisma.cameraZone.findMany({
      where: { organizationId: context.organizationId },
      orderBy: { createdAt: 'asc' },
    });
  }
  async saveZone(
    context: TenantContext,
    input: {
      cameraId: string;
      name: string;
      priority: 'NORMAL' | 'HIGH';
      polygon: Array<{ x: number; y: number }>;
      enabled: boolean;
    },
    metadata: RequestMetadata,
    id?: string,
  ) {
    if (
      !(await this.prisma.camera.count({
        where: { id: input.cameraId, organizationId: context.organizationId, deletedAt: null },
      }))
    )
      throw new AuthError(404, 'CAMERA_NOT_FOUND', 'Camera not found');
    const zone = id
      ? await this.prisma.cameraZone
          .updateMany({
            where: { id, organizationId: context.organizationId },
            data: { ...input, polygon: input.polygon },
          })
          .then(async (r) => {
            if (!r.count) throw new AuthError(404, 'ZONE_NOT_FOUND', 'Zone not found');
            return this.prisma.cameraZone.findUniqueOrThrow({ where: { id } });
          })
      : await this.prisma.cameraZone.create({
          data: { organizationId: context.organizationId, ...input, polygon: input.polygon },
        });
    await this.prisma.auditLog.create({
      data: {
        organizationId: context.organizationId,
        actorUserId: context.userId,
        action: id ? 'CAMERA_ZONE_UPDATED' : 'CAMERA_ZONE_CREATED',
        entityType: 'CameraZone',
        entityId: zone.id,
        ...metadata,
      },
    });
    return zone;
  }
  async deleteZone(context: TenantContext, id: string, metadata: RequestMetadata) {
    const r = await this.prisma.cameraZone.deleteMany({
      where: { id, organizationId: context.organizationId },
    });
    if (!r.count) throw new AuthError(404, 'ZONE_NOT_FOUND', 'Zone not found');
    await this.prisma.auditLog.create({
      data: {
        organizationId: context.organizationId,
        actorUserId: context.userId,
        action: 'CAMERA_ZONE_DELETED',
        entityType: 'CameraZone',
        entityId: id,
        ...metadata,
      },
    });
  }
}
