import { BookingStatus, PaymentStatus, Role, SemesterStatus } from '@prisma/client';
import { prisma } from '../db.js';
import { enqueueEmail } from './email.js';

const dayMs = 24 * 60 * 60 * 1000;

async function queueBalanceReminders(now: Date) {
  const semesters = await prisma.semester.findMany({ where: { status: SemesterStatus.ACTIVE, balanceDueAt: { not: null } } });
  for (const semester of semesters) {
    const daysLeft = Math.ceil((semester.balanceDueAt!.getTime() - now.getTime()) / dayMs);
    if (![7, 2].includes(daysLeft)) continue;
    const bookings = await prisma.booking.findMany({
      where: { semesterId: semester.id, status: { in: [BookingStatus.CONFIRMED, BookingStatus.CHECKED_IN] } },
      include: { student: { include: { user: true } }, room: true, payments: { where: { status: PaymentStatus.SUCCESS } } },
      take: 5000,
    });
    for (const booking of bookings) {
      const paid = booking.payments.reduce((sum, payment) => sum + payment.amountPesewas, 0);
      const balance = Math.max(0, booking.pricePesewas - paid);
      if (!balance) continue;
      await enqueueEmail({
        userId: booking.student.userId,
        toEmail: booking.student.user.email,
        template: 'balance-reminder',
        dedupeKey: `balance-${booking.id}-${daysLeft}-${semester.balanceDueAt!.toISOString().slice(0, 10)}`,
        payload: {
          subject: `Hostel balance due in ${daysLeft} days`,
          name: booking.student.user.fullName,
          message: `Your hostel balance is due in ${daysLeft} days. Please pay the remaining balance to keep your room booking current.`,
          room: booking.room.roomNumber,
          totalPaid: `GHS ${(paid / 100).toFixed(2)}`,
          balance: `GHS ${(balance / 100).toFixed(2)}`,
        },
      });
    }
  }
}

async function queueDailySummary(now: Date) {
  if (now.getHours() < 20) return;
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart.getTime() + dayMs);
  const [admins, aggregate, count] = await Promise.all([
    prisma.user.findMany({ where: { role: Role.ADMIN, isActive: true }, select: { id: true, email: true } }),
    prisma.payment.aggregate({ where: { status: PaymentStatus.SUCCESS, verifiedAt: { gte: dayStart, lt: dayEnd } }, _sum: { amountPesewas: true, feePesewas: true, netPesewas: true } }),
    prisma.payment.count({ where: { status: PaymentStatus.SUCCESS, verifiedAt: { gte: dayStart, lt: dayEnd } } }),
  ]);
  for (const admin of admins) {
    await enqueueEmail({
      userId: admin.id,
      toEmail: admin.email,
      template: 'daily-manager-summary',
      dedupeKey: `manager-summary-${admin.id}-${dayStart.toISOString().slice(0, 10)}`,
      payload: {
        subject: 'Daily hostel collection summary',
        name: 'Hostel administrator',
        message: `${count} verified payments today. Gross GHS ${((aggregate._sum.amountPesewas || 0) / 100).toFixed(2)}, fees GHS ${((aggregate._sum.feePesewas || 0) / 100).toFixed(2)}, net GHS ${((aggregate._sum.netPesewas || 0) / 100).toFixed(2)}.`,
      },
    });
  }
}

async function runScheduledTasks() {
  const now = new Date();
  await queueBalanceReminders(now);
  await queueDailySummary(now);
}

export function startScheduledNotificationsWorker() {
  const timer = setInterval(() => {
    void runScheduledTasks().catch((error) => console.error('Scheduled notifications failed:', error));
  }, 60 * 60 * 1000);
  timer.unref();
  return timer;
}