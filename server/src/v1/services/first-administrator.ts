import { Role, RoleProfile, type Prisma } from '@prisma/client';
import { writeAudit } from './audit.js';

export async function createFirstAdministrator(
  tx: Prisma.TransactionClient,
  input: { fullName: string; email: string; passwordHash: string; mustChangePassword?: boolean },
) {
  const userCount = await tx.user.count();
  if (userCount !== 0) throw new Error('First Administrator provisioning is allowed only while the user table is empty.');

  const user = await tx.user.create({
    data: {
      fullName: input.fullName,
      email: input.email,
      passwordHash: input.passwordHash,
      role: Role.ADMINISTRATOR,
      roleProfile: RoleProfile.TARGET,
      emailVerifiedAt: new Date(),
      mustChangePassword: input.mustChangePassword ?? false,
    },
    select: { id: true, email: true },
  });
  await writeAudit({
    actorId: user.id,
    action: 'first_administrator_provisioned',
    entityType: 'User',
    entityId: user.id,
    metadata: { email: user.email, role: Role.ADMINISTRATOR },
  }, tx);
  return user;
}
