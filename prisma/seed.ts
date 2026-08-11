import { PrismaClient, PlanInterval, PlanStatus } from '@prisma/client';

const prisma = new PrismaClient();

const plans = [
  {
    name: 'Free',
    slug: 'free',
    code: 'FREE',
    maxCameras: 1,
    maxStorageBytes: 1_073_741_824n,
    retentionDays: 1,
    maxUsers: 1,
    trialDays: 0,
    enabledFeatures: ['LIVE_VIEW', 'MOTION_DETECTION'],
  },
  {
    name: 'Basic',
    slug: 'basic',
    code: 'BASIC',
    maxCameras: 4,
    maxStorageBytes: 10_737_418_240n,
    retentionDays: 7,
    maxUsers: 3,
    trialDays: 7,
    enabledFeatures: ['LIVE_VIEW', 'CLOUD_STORAGE', 'RECORDING', 'MOTION_DETECTION', 'MULTI_USER'],
  },
  {
    name: 'Pro',
    slug: 'pro',
    code: 'PRO',
    maxCameras: 16,
    maxStorageBytes: 107_374_182_400n,
    retentionDays: 30,
    maxUsers: 10,
    trialDays: 14,
    enabledFeatures: [
      'LIVE_VIEW',
      'CLOUD_STORAGE',
      'RECORDING',
      'MOTION_DETECTION',
      'PERSON_DETECTION',
      'SMART_ALERTS',
      'MULTI_USER',
      'ADVANCED_EVENTS',
    ],
  },
  {
    name: 'Business',
    slug: 'business',
    code: 'BUSINESS',
    maxCameras: 64,
    maxStorageBytes: 1_099_511_627_776n,
    retentionDays: 90,
    maxUsers: 50,
    trialDays: 30,
    enabledFeatures: [
      'LIVE_VIEW',
      'CLOUD_STORAGE',
      'RECORDING',
      'MOTION_DETECTION',
      'PERSON_DETECTION',
      'SMART_ALERTS',
      'MULTI_USER',
      'ADVANCED_EVENTS',
    ],
  },
] as const;

async function main() {
  for (const plan of plans) {
    await prisma.plan.upsert({
      where: { slug: plan.slug },
      update: { ...plan },
      create: {
        ...plan,
        priceCents: null,
        currency: 'BRL',
        billingInterval: PlanInterval.MONTHLY,
        enabledFeatures: plan.enabledFeatures,
        status: PlanStatus.ACTIVE,
      },
    });
  }
}

main()
  .finally(async () => prisma.$disconnect())
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
