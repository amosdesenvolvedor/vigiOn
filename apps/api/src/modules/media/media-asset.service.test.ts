import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CameraCredentialService } from '../cameras/camera-credential.service';
import { MediaAssetService } from './media-asset.service';
import type { ObjectStorageService } from './object-storage.service';

class MemoryStorage implements ObjectStorageService {
  objects = new Map<string, Buffer>();
  failDelete = false;
  async put(key: string, data: Buffer) {
    this.objects.set(key, data);
  }
  async get(key: string) {
    return Readable.from(this.objects.get(key) ?? Buffer.alloc(0));
  }
  async delete(key: string) {
    if (this.failDelete) throw new Error('storage outage');
    this.objects.delete(key);
  }
  async exists(key: string) {
    return this.objects.has(key);
  }
}
const prisma = new PrismaClient();
const storage = new MemoryStorage();
const service = new MediaAssetService(prisma, storage);
const credentials = new CameraCredentialService();
const suffix = randomUUID().slice(0, 8);
const organizationIds: string[] = [];
let planId = '';
const publicKey = generateKeyPairSync('x25519')
  .publicKey.export({ type: 'spki', format: 'pem' })
  .toString();
const jpeg = Buffer.from([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]);
async function tenant(label: string) {
  const organization = await prisma.organization.create({
    data: {
      name: label,
      slug: `media-${label}-${suffix}`,
      resourceCounter: { create: {} },
      storageUsage: { create: {} },
    },
  });
  organizationIds.push(organization.id);
  const user = await prisma.user.create({
    data: {
      organizationId: organization.id,
      name: label,
      email: `${label}-${suffix}@test.invalid`,
      normalizedEmail: `${label}-${suffix}@test.invalid`,
      passwordHash: 'x',
      role: 'OWNER',
      status: 'ACTIVE',
    },
  });
  const membership = await prisma.organizationMembership.create({
    data: { organizationId: organization.id, userId: user.id, role: 'OWNER', status: 'ACTIVE' },
  });
  await prisma.subscription.create({
    data: {
      organizationId: organization.id,
      planId,
      status: 'ACTIVE',
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 86_400_000),
    },
  });
  const gateway = await prisma.gateway.create({
    data: {
      organizationId: organization.id,
      name: 'Edge',
      deviceId: randomUUID(),
      secretHash: 'x',
      status: 'ONLINE',
      lastSeenAt: new Date(),
      encryptionPublicKey: publicKey,
    },
  });
  const camera = await prisma.camera.create({
    data: {
      organizationId: organization.id,
      gatewayId: gateway.id,
      name: 'Camera',
      protocol: 'RTSP',
      administrativeStatus: 'ACTIVE',
    },
  });
  await credentials.store(prisma, organization.id, camera.id, {
    username: 'u',
    password: 'p',
    stream: { host: 'camera.local', port: 554, path: '/live', transport: 'tcp' },
  });
  return {
    organization,
    user,
    gateway,
    camera,
    context: {
      organizationId: organization.id,
      userId: user.id,
      membershipId: membership.id,
      role: 'OWNER' as const,
    },
  };
}
beforeAll(async () => {
  await prisma.$connect();
  planId = (
    await prisma.plan.create({
      data: {
        name: 'Media test',
        slug: `media-${suffix}`,
        code: `MEDIA_${suffix}`,
        maxCameras: 10,
        maxStorageBytes: 200_000_000n,
        retentionDays: 7,
        maxUsers: 10,
        enabledFeatures: ['LIVE_VIEW', 'CLOUD_STORAGE', 'RECORDING'],
      },
    })
  ).id;
});
afterAll(async () => {
  await prisma.gatewayMessage.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.gatewayCommand.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.storageFile.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.cameraCredential.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.auditLog.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.camera.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.gateway.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.subscription.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.storageUsage.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.resourceCounter.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.organizationMembership.deleteMany({
    where: { organizationId: { in: organizationIds } },
  });
  await prisma.user.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
  await prisma.plan.delete({ where: { id: planId } });
  await prisma.$disconnect();
});
describe('media assets and private object storage', () => {
  it('creates an idempotent snapshot, uploads once and commits exact usage', async () => {
    const current = await tenant('upload');
    const key = randomUUID();
    const first = await service.request(current.context, current.camera.id, 'SNAPSHOT', key, {});
    const second = await service.request(current.context, current.camera.id, 'SNAPSHOT', key, {});
    expect(second.id).toBe(first.id);
    expect(
      await prisma.gatewayCommand.count({
        where: { cameraId: current.camera.id, type: 'CAPTURE_SNAPSHOT' },
      }),
    ).toBe(1);
    const uploaded = await service.receiveUpload(
      { gatewayId: current.gateway.id, organizationId: current.organization.id },
      first.id,
      jpeg,
    );
    expect(uploaded.status).toBe('AVAILABLE');
    const access = await service.access(current.context, first.id);
    const signed = new URL(access.url, 'https://vigion.test');
    const content = await service.content(
      first.id,
      Number(signed.searchParams.get('expires')),
      signed.searchParams.get('token')!,
    );
    let downloaded = Buffer.alloc(0);
    for await (const chunk of content.stream)
      downloaded = Buffer.concat([downloaded, Buffer.from(chunk)]);
    expect(downloaded).toEqual(jpeg);
    await expect(
      service.content(first.id, Number(signed.searchParams.get('expires')), 'invalid-token'),
    ).rejects.toMatchObject({ code: 'MEDIA_NOT_AUTHORIZED' });
    await service.receiveUpload(
      { gatewayId: current.gateway.id, organizationId: current.organization.id },
      first.id,
      jpeg,
    );
    const usage = await prisma.storageUsage.findUniqueOrThrow({
      where: { organizationId: current.organization.id },
    });
    expect(usage).toMatchObject({
      usedBytes: BigInt(jpeg.length),
      reservedBytes: 0n,
      fileCount: 1n,
    });
  });
  it('blocks cross-tenant read, upload, access and delete', async () => {
    const a = await tenant('tenant-a');
    const b = await tenant('tenant-b');
    const asset = await service.request(b.context, b.camera.id, 'SNAPSHOT', randomUUID(), {});
    await expect(service.get(a.context, asset.id)).rejects.toMatchObject({
      code: 'MEDIA_ASSET_NOT_FOUND',
    });
    await expect(
      service.receiveUpload(
        { gatewayId: a.gateway.id, organizationId: a.organization.id },
        asset.id,
        jpeg,
      ),
    ).rejects.toMatchObject({ code: 'MEDIA_ASSET_NOT_FOUND' });
    await expect(service.access(a.context, asset.id)).rejects.toMatchObject({
      code: 'MEDIA_ASSET_NOT_FOUND',
    });
    await expect(service.remove(a.context, asset.id, 'manual')).rejects.toMatchObject({
      code: 'MEDIA_ASSET_NOT_FOUND',
    });
  });
  it('deletes object and releases usage exactly once', async () => {
    const current = await tenant('delete');
    const asset = await service.request(
      current.context,
      current.camera.id,
      'SNAPSHOT',
      randomUUID(),
      {},
    );
    await service.receiveUpload(
      { gatewayId: current.gateway.id, organizationId: current.organization.id },
      asset.id,
      jpeg,
    );
    await service.remove(current.context, asset.id, 'manual');
    await service.remove(current.context, asset.id, 'manual');
    const usage = await prisma.storageUsage.findUniqueOrThrow({
      where: { organizationId: current.organization.id },
    });
    expect(usage).toMatchObject({ usedBytes: 0n, fileCount: 0n });
  });
  it('retention preserves accounting when object deletion fails and retries safely', async () => {
    const current = await tenant('retention');
    const asset = await service.request(
      current.context,
      current.camera.id,
      'SNAPSHOT',
      randomUUID(),
      {},
    );
    await service.receiveUpload(
      { gatewayId: current.gateway.id, organizationId: current.organization.id },
      asset.id,
      jpeg,
    );
    await prisma.storageFile.update({ where: { id: asset.id }, data: { expiresAt: new Date(0) } });
    storage.failDelete = true;
    expect(await service.retentionBatch()).toBe(0);
    expect(
      (
        await prisma.storageUsage.findUniqueOrThrow({
          where: { organizationId: current.organization.id },
        })
      ).usedBytes,
    ).toBe(BigInt(jpeg.length));
    storage.failDelete = false;
    expect(await service.retentionBatch()).toBe(1);
    expect(
      (
        await prisma.storageUsage.findUniqueOrThrow({
          where: { organizationId: current.organization.id },
        })
      ).usedBytes,
    ).toBe(0n);
  });
  it('marks an exhausted upload failed and releases its reservation once', async () => {
    const current = await tenant('upload-failed');
    const asset = await service.request(
      current.context,
      current.camera.id,
      'SNAPSHOT',
      randomUUID(),
      {},
    );
    await service.failUpload(
      { gatewayId: current.gateway.id, organizationId: current.organization.id },
      asset.id,
      'UPLOAD_RETRY_EXHAUSTED',
    );
    await service.failUpload(
      { gatewayId: current.gateway.id, organizationId: current.organization.id },
      asset.id,
      'UPLOAD_RETRY_EXHAUSTED',
    );
    expect(await prisma.storageFile.findUniqueOrThrow({ where: { id: asset.id } })).toMatchObject({
      status: 'FAILED',
      reservedBytes: 0n,
    });
    expect(
      (
        await prisma.storageUsage.findUniqueOrThrow({
          where: { organizationId: current.organization.id },
        })
      ).reservedBytes,
    ).toBe(0n);
  });
});
