import { PrismaClient, PlanInterval, PlanStatus } from '@prisma/client';

const prisma = new PrismaClient();

const plans = [
  {
    name: 'Free',
    slug: 'free',
    maxCameras: 1,
    maxStorageBytes: 1_073_741_824n,
    retentionDays: 1,
    maxUsers: 1,
  },
  {
    name: 'Basic',
    slug: 'basic',
    maxCameras: 4,
    maxStorageBytes: 10_737_418_240n,
    retentionDays: 7,
    maxUsers: 3,
  },
  {
    name: 'Pro',
    slug: 'pro',
    maxCameras: 16,
    maxStorageBytes: 107_374_182_400n,
    retentionDays: 30,
    maxUsers: 10,
  },
  {
    name: 'Business',
    slug: 'business',
    maxCameras: 64,
    maxStorageBytes: 1_099_511_627_776n,
    retentionDays: 90,
    maxUsers: 50,
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
        enabledFeatures: [],
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
