import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import type { AuthenticatedUser } from '../auth/auth.types';
import { AuthError } from '../auth/auth.errors';
import { EntitlementService } from '../billing/entitlement.service';
import type { AiToolDefinition } from './ai-provider';
import { sanitizeForAi } from './sanitize';

const empty = z.object({}).strict();
const id = z.object({ id: z.string().uuid() }).strict();
type Tool = { description: string; schema: z.ZodTypeAny; parameters: object; run: (args: unknown) => Promise<unknown>; admin?: boolean };

export class AiTools {
  private readonly entitlements: EntitlementService;
  constructor(private readonly prisma: PrismaClient, private readonly auth: AuthenticatedUser) { this.entitlements = new EntitlementService(prisma); }

  private tools(): Record<string, Tool> {
    const org = this.auth.organizationId;
    const user = this.auth.userId;
    const camera = { id: { type: 'string', format: 'uuid' } };
    return {
      get_my_account: { description: 'Dados seguros da conta autenticada', schema: empty, parameters: { type: 'object', properties: {}, additionalProperties: false }, run: () => this.prisma.user.findFirst({ where: { id: user, organizationId: org }, select: { id: true, name: true, email: true, role: true, status: true, timezone: true, lastLoginAt: true } }) },
      get_my_organization: { description: 'Dados da organização autenticada', schema: empty, parameters: { type: 'object', properties: {}, additionalProperties: false }, run: () => this.prisma.organization.findFirst({ where: { id: org, deletedAt: null }, select: { id: true, name: true, status: true, timezone: true } }) },
      list_cameras: { description: 'Lista câmeras e estados da organização', schema: empty, parameters: { type: 'object', properties: {}, additionalProperties: false }, run: () => this.prisma.camera.findMany({ where: { organizationId: org, deletedAt: null }, take: 50, select: { id: true, name: true, administrativeStatus: true, connectionStatus: true, protocol: true, manufacturer: true, model: true, gatewayId: true, lastSeenAt: true, healthFailureCode: true } }) },
      get_camera_status: { description: 'Status seguro de uma câmera', schema: id, parameters: { type: 'object', properties: camera, required: ['id'], additionalProperties: false }, run: (args) => this.camera(id.parse(args).id) },
      get_camera_connection_health: { description: 'Saúde de conexão de uma câmera', schema: id, parameters: { type: 'object', properties: camera, required: ['id'], additionalProperties: false }, run: (args) => this.camera(id.parse(args).id) },
      list_gateways: { description: 'Lista gateways e estados da organização', schema: empty, parameters: { type: 'object', properties: {}, additionalProperties: false }, run: () => this.prisma.gateway.findMany({ where: { organizationId: org, deletedAt: null }, take: 50, select: { id: true, name: true, status: true, version: true, lastSeenAt: true, lastUptime: true, _count: { select: { cameras: true } } } }) },
      get_gateway_status: { description: 'Status seguro de um gateway', schema: id, parameters: { type: 'object', properties: camera, required: ['id'], additionalProperties: false }, run: (args) => this.gateway(id.parse(args).id) },
      get_gateway_health: { description: 'Saúde operacional de um gateway', schema: id, parameters: { type: 'object', properties: camera, required: ['id'], additionalProperties: false }, run: (args) => this.gateway(id.parse(args).id) },
      get_camera_recent_events: { description: 'Eventos recentes de uma câmera', schema: id, parameters: { type: 'object', properties: camera, required: ['id'], additionalProperties: false }, run: async (args) => { const cameraId = id.parse(args).id; await this.requireCamera(cameraId); return this.prisma.cameraEvent.findMany({ where: { organizationId: org, cameraId }, take: 10, orderBy: { occurredAt: 'desc' }, select: { id: true, type: true, severity: true, status: true, occurredAt: true } }); } },
      get_notification_status: { description: 'Resumo de notificações do usuário', schema: empty, parameters: { type: 'object', properties: {}, additionalProperties: false }, run: () => this.prisma.notification.groupBy({ by: ['status'], where: { organizationId: org, userId: user }, _count: true }) },
      get_recent_notification_failures: { description: 'Falhas recentes de notificação sem conteúdo sensível', schema: empty, parameters: { type: 'object', properties: {}, additionalProperties: false }, run: () => this.prisma.notification.findMany({ where: { organizationId: org, userId: user, status: 'FAILED' }, take: 10, orderBy: { createdAt: 'desc' }, select: { channel: true, status: true, errorCode: true, attempts: true, createdAt: true } }) },
      get_storage_usage: { description: 'Uso e limite de armazenamento', schema: empty, parameters: { type: 'object', properties: {}, additionalProperties: false }, run: () => this.entitlements.getUsage(org) },
      get_plan_status: { description: 'Plano e status da assinatura, somente leitura', schema: empty, parameters: { type: 'object', properties: {}, additionalProperties: false }, run: async () => { const { subscription, plan } = await this.entitlements.getEntitlements(org); return { plan: { code: plan.code, name: plan.name, maxCameras: plan.maxCameras, maxUsers: plan.maxUsers, maxStorageBytes: plan.maxStorageBytes }, subscription: { status: subscription.status, currentPeriodEnd: subscription.currentPeriodEnd, cancelAtPeriodEnd: subscription.cancelAtPeriodEnd } }; } },
      get_entitlements: { description: 'Recursos autorizados no plano', schema: empty, parameters: { type: 'object', properties: {}, additionalProperties: false }, run: async () => { const value = await this.entitlements.getEntitlements(org); return { plan: value.plan.code, features: value.features }; } },
      get_platform_health: { admin: true, description: 'Saúde global resumida da plataforma', schema: empty, parameters: { type: 'object', properties: {}, additionalProperties: false }, run: async () => ({ database: (await this.prisma.$queryRaw`SELECT 1`) ? 'healthy' : 'unavailable', workers: await this.prisma.workerHealth.findMany({ select: { name: true, status: true, lastSuccessAt: true, lastErrorCode: true } }) }) },
      get_worker_health: { admin: true, description: 'Saúde dos workers', schema: empty, parameters: { type: 'object', properties: {}, additionalProperties: false }, run: () => this.prisma.workerHealth.findMany({ select: { name: true, status: true, lastSuccessAt: true, lastFailureAt: true, lastErrorCode: true, durationMs: true } }) },
      get_recent_platform_errors: { admin: true, description: 'Erros operacionais auditados recentes', schema: empty, parameters: { type: 'object', properties: {}, additionalProperties: false }, run: () => this.prisma.workerHealth.findMany({ where: { status: { not: 'HEALTHY' } }, select: { name: true, status: true, lastFailureAt: true, lastErrorCode: true } }) },
      get_organization_health: { admin: true, description: 'Saúde resumida de uma organização por ID', schema: id, parameters: { type: 'object', properties: camera, required: ['id'], additionalProperties: false }, run: async (args) => { const organizationId = id.parse(args).id; const organization = await this.prisma.organization.findFirst({ where: { id: organizationId, deletedAt: null }, select: { id: true, name: true, status: true } }); if (!organization) throw new AuthError(404, 'ORGANIZATION_NOT_FOUND', 'Organization not found'); const [cameras, gateways, failedNotifications] = await Promise.all([this.prisma.camera.groupBy({ by: ['connectionStatus'], where: { organizationId, deletedAt: null }, _count: true }), this.prisma.gateway.groupBy({ by: ['status'], where: { organizationId, deletedAt: null }, _count: true }), this.prisma.notification.count({ where: { organizationId, status: 'FAILED', createdAt: { gte: new Date(Date.now() - 86_400_000) } } })]); return { organization, cameras, gateways, failedNotificationsLast24h: failedNotifications }; } },
    };
  }

  async definitions() {
    const admin = await this.isPlatformAdmin();
    return Object.entries(this.tools()).filter(([, tool]) => !tool.admin || admin).map(([name, tool]) => ({ type: 'function', function: { name, description: tool.description, parameters: tool.parameters } }) satisfies AiToolDefinition);
  }
  async execute(name: string, args: unknown) {
    const tool = this.tools()[name];
    if (!tool || (tool.admin && !(await this.isPlatformAdmin()))) throw new AuthError(403, 'AI_TOOL_FORBIDDEN', 'Tool is not available');
    tool.schema.parse(args);
    return sanitizeForAi(await tool.run(args));
  }
  private async isPlatformAdmin() { return Boolean(await this.prisma.user.findFirst({ where: { id: this.auth.userId, organizationId: this.auth.organizationId, platformRole: 'PLATFORM_ADMIN', sessions: { some: { id: this.auth.sessionId, mfaVerifiedAt: { not: null }, revokedAt: null } } }, select: { id: true } })); }
  private async requireCamera(cameraId: string) { const camera = await this.prisma.camera.findFirst({ where: { id: cameraId, organizationId: this.auth.organizationId, deletedAt: null }, select: { id: true } }); if (!camera) throw new AuthError(404, 'CAMERA_NOT_FOUND', 'Camera not found'); return camera; }
  private async camera(cameraId: string) { await this.requireCamera(cameraId); return this.prisma.camera.findFirst({ where: { id: cameraId, organizationId: this.auth.organizationId, deletedAt: null }, select: { id: true, name: true, administrativeStatus: true, connectionStatus: true, protocol: true, manufacturer: true, model: true, gatewayId: true, lastSeenAt: true, lastHealthCheckAt: true, lastSuccessfulHealthCheckAt: true, consecutiveFailures: true, healthFailureCode: true, credential: { select: { id: true } } } }).then((value) => value && ({ ...value, credentialConfigured: Boolean(value.credential), credential: undefined })); }
  private async gateway(gatewayId: string) { const value = await this.prisma.gateway.findFirst({ where: { id: gatewayId, organizationId: this.auth.organizationId, deletedAt: null }, select: { id: true, name: true, status: true, version: true, protocolVersion: true, lastSeenAt: true, lastUptime: true, _count: { select: { cameras: true } } } }); if (!value) throw new AuthError(404, 'GATEWAY_NOT_FOUND', 'Gateway not found'); return value; }
}
