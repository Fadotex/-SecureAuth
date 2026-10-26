import { Router } from 'express';
import { BookingStatus, PaymentSource, PaymentStatus, Role, SemesterStatus } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { hostelPaymentState, remainingBalancePesewas } from '../services/money.js';

export const reportRouter = Router();
const nonBillableBookingStatuses = new Set<BookingStatus>([BookingStatus.CANCELLED, BookingStatus.EXPIRED, BookingStatus.RELEASED]);

reportRouter.get('/admin/reports/summary', requireAuth, requireRole(Role.ADMIN, Role.ADMINISTRATOR), async (req, res) => {
  const { semesterId } = z.object({ semesterId: z.string().uuid().optional() }).parse(req.query);
  const semester = semesterId
    ? await prisma.semester.findUnique({ where: { id: semesterId } })
    : await prisma.semester.findFirst({ where: { status: SemesterStatus.ACTIVE } });
  if (!semester) return res.status(404).json({ error: 'Semester not found.' });

  const [bookings, payments, roomRows, paymentGroups, paymentsByDay, paymentCount] = await Promise.all([
    prisma.booking.findMany({
      where: { semesterId: semester.id },
      include: { room: { include: { roomType: true, floor: { include: { block: true } } } }, student: { include: { user: true } }, payments: { where: { status: PaymentStatus.SUCCESS } } },
    }),
    prisma.payment.aggregate({ where: { semesterId: semester.id, status: PaymentStatus.SUCCESS }, _sum: { amountPesewas: true, feePesewas: true, netPesewas: true } }),
    prisma.room.findMany({ include: { beds: { where: { active: true } }, bookings: { where: { semesterId: semester.id, status: { in: [BookingStatus.CONFIRMED, BookingStatus.CHECKED_IN] } } } } }),
    prisma.payment.groupBy({ by: ['network', 'source'], where: { semesterId: semester.id, status: PaymentStatus.SUCCESS }, _sum: { amountPesewas: true, feePesewas: true, netPesewas: true }, _count: true }),
    prisma.$queryRaw<Array<{ day: Date; total: bigint }>>`
      SELECT date_trunc('day', "verifiedAt") AS day, SUM("amountPesewas") AS total
      FROM "Payment" WHERE "semesterId" = ${semester.id}::uuid AND "status" = 'SUCCESS'
      GROUP BY date_trunc('day', "verifiedAt") ORDER BY day ASC
    `,
    prisma.payment.count({ where: { semesterId: semester.id, status: PaymentStatus.SUCCESS } }),
  ]);

  const expectedPesewas = bookings
    .filter((booking) => !nonBillableBookingStatuses.has(booking.status))
    .reduce((sum, booking) => sum + booking.pricePesewas, 0);
  const collectedPesewas = payments._sum.amountPesewas || 0;
  const ledgerSumPesewas = bookings.reduce((sum, booking) => sum + booking.payments.reduce((partial, payment) => partial + payment.amountPesewas, 0), 0);
  const occupiedBeds = roomRows.reduce((sum, room) => sum + room.bookings.length, 0);
  const activeBeds = roomRows.reduce((sum, room) => sum + room.beds.length, 0);
  const roomBuckets = {
    full: roomRows.filter((room) => room.beds.length > 0 && room.bookings.length >= room.beds.length).length,
    partlyFilled: roomRows.filter((room) => room.bookings.length > 0 && room.bookings.length < room.beds.length).length,
    empty: roomRows.filter((room) => room.bookings.length === 0).length,
  };
  const byRoomType = new Map<string, number>();
  const paymentStatusCounts = { COMPLETE: 0, INCOMPLETE: 0, UNPAID: 0, CANCELLED: 0 };
  const outstanding = bookings.map((booking) => {
    const amountPaid = booking.payments.reduce((sum, payment) => sum + payment.amountPesewas, 0);
    const balance = remainingBalancePesewas(booking.pricePesewas, amountPaid);
    if (nonBillableBookingStatuses.has(booking.status)) paymentStatusCounts.CANCELLED += 1;
    else paymentStatusCounts[hostelPaymentState(booking.pricePesewas, amountPaid)] += 1;
    if (amountPaid > 0) byRoomType.set(booking.room.roomType.name, (byRoomType.get(booking.room.roomType.name) || 0) + amountPaid);
    return { studentId: booking.student.studentId, name: booking.student.user.fullName, room: booking.room.roomNumber, amountPaidPesewas: amountPaid, balancePesewas: balance };
  }).filter((entry) => entry.balancePesewas > 0).sort((left, right) => right.balancePesewas - left.balancePesewas).slice(0, 20);

  return res.json({
    semester,
    students: {
      totalRegistered: await prisma.studentProfile.count(),
      totalBooked: bookings.filter((booking) => !nonBillableBookingStatuses.has(booking.status)).length,
      checkedIn: bookings.filter((booking) => booking.status === BookingStatus.CHECKED_IN).length,
      paymentStatusCounts,
    },
    money: {
      expectedPesewas,
      collectedPesewas,
      outstandingPesewas: Math.max(0, expectedPesewas - collectedPesewas),
      collectionRateBps: expectedPesewas ? Math.round(collectedPesewas * 10_000 / expectedPesewas) : 0,
      feesPesewas: payments._sum.feePesewas || 0,
      netPesewas: payments._sum.netPesewas || 0,
      grossVsNetPesewas: (payments._sum.amountPesewas || 0) - (payments._sum.netPesewas || 0),
      byRoomType: [...byRoomType].map(([roomType, amountPesewas]) => ({ roomType, amountPesewas })),
      byNetworkAndSource: paymentGroups,
      byDay: paymentsByDay.map((entry) => ({ day: entry.day, amountPesewas: Number(entry.total) })),
      reconciled: ledgerSumPesewas === collectedPesewas && paymentCount === bookings.reduce((sum, booking) => sum + booking.payments.length, 0),
      ledgerDifferencePesewas: collectedPesewas - ledgerSumPesewas,
    },
    rooms: { total: roomRows.length, occupiedBeds, availableBeds: Math.max(0, activeBeds - occupiedBeds), occupancyBps: activeBeds ? Math.round(occupiedBeds * 10_000 / activeBeds) : 0, ...roomBuckets },
    topBalances: outstanding,
  });
});

const csvCell = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;

reportRouter.get('/admin/reports/payments.csv', requireAuth, requireRole(Role.ADMIN, Role.ADMINISTRATOR), async (req, res) => {
  const { semesterId } = z.object({ semesterId: z.string().uuid().optional() }).parse(req.query);
  const payments = await prisma.payment.findMany({
    where: { ...(semesterId ? { semesterId } : {}), status: PaymentStatus.SUCCESS },
    include: { student: { include: { user: true } }, booking: { include: { room: true } } },
    orderBy: { verifiedAt: 'desc' },
    take: 10_000,
  });
  const headers = ['Receipt', 'Student ID', 'Student', 'Room', 'Network', 'Source', 'Reference', 'Amount GHS', 'Fee GHS', 'Net GHS', 'Paid at'];
  const rows = payments.map((payment) => [
    payment.receiptNumber,
    payment.student.studentId,
    payment.student.user.fullName,
    payment.booking.room.roomNumber,
    payment.network,
    payment.source,
    payment.paystackReference || payment.momoReference,
    (payment.amountPesewas / 100).toFixed(2),
    (payment.feePesewas / 100).toFixed(2),
    (payment.netPesewas / 100).toFixed(2),
    payment.verifiedAt?.toISOString(),
  ]);
  const csv = [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="hostel-payments.csv"');
  return res.send(csv);
});

reportRouter.get('/staff/payments.csv', requireAuth, requireRole(Role.MANAGER, Role.ADMIN, Role.ADMINISTRATOR, Role.STAFF), async (req, res) => {
  const { q } = z.object({ q: z.string().trim().max(100).optional() }).parse(req.query);
  const payments = await prisma.payment.findMany({
    where: q ? { student: { studentId: { contains: q, mode: 'insensitive' } } } : undefined,
    include: { student: { include: { user: true } }, booking: { include: { room: true } } },
    orderBy: { createdAt: 'desc' },
    take: 1000,
  });
  const headers = ['Student ID', 'Student', 'Room', 'Status', 'Amount GHS', 'Reference', 'Created at'];
  const rows = payments.map((payment) => [payment.student.studentId, payment.student.user.fullName, payment.booking.room.roomNumber, payment.status, (payment.amountPesewas / 100).toFixed(2), payment.paystackReference || payment.momoReference, payment.createdAt.toISOString()]);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="hostel-payment-ledger.csv"');
  return res.send([headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n'));
});

export { PaymentSource };