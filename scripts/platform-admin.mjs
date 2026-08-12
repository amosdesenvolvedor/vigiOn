import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const [action, email, reason] = process.argv.slice(2);
if (
  !['grant', 'revoke'].includes(action) ||
  !email ||
  !reason ||
  reason.length < 10 ||
  reason.length > 500
) {
  console.error(
    'Usage: npm run platform-admin -- <grant|revoke> <existing-user-email> "reason (10-500 chars)"',
  );
  process.exit(2);
}

try {
  const user = await prisma.user.findUnique({
    where: { normalizedEmail: email.trim().toLowerCase() },
  });
  if (!user || user.deletedAt) throw new Error('Active user not found');
  if (action === 'revoke') {
    const administrators = await prisma.user.count({
      where: { platformRole: 'PLATFORM_ADMIN', status: 'ACTIVE', deletedAt: null },
    });
    if (user.platformRole === 'PLATFORM_ADMIN' && administrators <= 1)
      throw new Error('Cannot revoke the last PLATFORM_ADMIN');
  }
  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { platformRole: action === 'grant' ? 'PLATFORM_ADMIN' : null },
    }),
    prisma.platformAuditLog.create({
      data: {
        action: action === 'grant' ? 'PLATFORM_ADMIN_GRANTED' : 'PLATFORM_ADMIN_REVOKED',
        entityType: 'User',
        entityId: user.id,
        reason,
        metadata: { bootstrap: true },
      },
    }),
  ]);
  console.log(`Platform role ${action === 'grant' ? 'granted' : 'revoked'} for existing user.`);
} finally {
  await prisma.$disconnect();
}
