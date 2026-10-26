import { BookingStatus } from '@prisma/client';
import { prisma } from '../db.js';

async function expireHolds() {
  const expired = await prisma.booking.findMany({ where: { status: BookingStatus.HELD, holdExpiresAt: { lte: new Date() } }, select: { id: true, student: { select: { userId: true } } }, take: 500 });
  if (!expired.length) return;
  await prisma.booking.updateMany({ where: { id: { in: expired.map((booking) => booking.id) }, status: BookingStatus.HELD }, data: { status: BookingStatus.EXPIRED, holdExpiresAt: null } });
  await prisma.auditLog.createMany({
    data: expired.map((booking) => ({ actorId: booking.student.userId, action: 'bed_hold_expired', entityType: 'Booking', entityId: booking.id })),
    skipDuplicates: true,
  });
}

export function startHoldExpiryWorker() {
  const timer = setInterval(() => {
    void expireHolds().catch((error) => console.error('Hold expiry poll failed:', error));
  }, 30_000);
  timer.unref();
  return timer;
}