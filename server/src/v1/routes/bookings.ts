import { Router } from 'express';
import { BookingStatus, Role, RoomStatus, SemesterStatus } from '@prisma/client';
import { z } from 'zod';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { requireAuth, requirePermission, requireRole } from '../middleware/auth.js';
import { writeAudit } from '../services/audit.js';

export const bookingRouter = Router();
const activeStatuses = [BookingStatus.HELD, BookingStatus.CONFIRMED, BookingStatus.CHECKED_IN];
const cancellableStatuses = new Set<BookingStatus>([BookingStatus.HELD, BookingStatus.CONFIRMED]);
const managerRoles = new Set<Role>([Role.MANAGER, Role.ADMIN, Role.ADMINISTRATOR]);

bookingRouter.post('/bookings/hold', requireAuth, requireRole(Role.STUDENT), async (req, res) => {
  const input = z.object({
    roomTypeId: z.string().uuid(),
    roomId: z.string().uuid().optional(),
    semesterId: z.string().uuid().optional(),
  }).parse(req.body);
  const now = new Date();
  const holdExpiresAt = new Date(now.getTime() + config.HOLD_MINUTES * 60_000);

  try {
    const booking = await prisma.$transaction(async (tx) => {
      const student = await tx.studentProfile.findUnique({ where: { userId: req.auth!.userId } });
      if (!student) throw Object.assign(new Error('Student profile is missing.'), { status: 404 });
      if (!student.gender) throw Object.assign(new Error('Set your accommodation details before selecting a room.'), { status: 400 });
      await tx.$queryRaw`SELECT "id" FROM "StudentProfile" WHERE "id" = ${student.id}::uuid FOR UPDATE`;

      const semester = input.semesterId
        ? await tx.semester.findUnique({ where: { id: input.semesterId } })
        : await tx.semester.findFirst({ where: { status: SemesterStatus.ACTIVE } });
      if (!semester || semester.status === SemesterStatus.CLOSED) throw Object.assign(new Error('This semester is not open for bookings.'), { status: 409 });

      const existing = await tx.booking.findFirst({ where: { studentId: student.id, semesterId: semester.id, status: { in: activeStatuses } } });
      if (existing && (existing.status !== BookingStatus.HELD || (existing.holdExpiresAt && existing.holdExpiresAt > now))) {
        throw Object.assign(new Error('You already have an active booking for this semester.'), { status: 409 });
      }
      if (existing?.status === BookingStatus.HELD) await tx.booking.update({ where: { id: existing.id }, data: { status: BookingStatus.EXPIRED } });

      const beds = await tx.$queryRaw<Array<{ id: string; roomId: string; roomTypeId: string; priceId: string; pricePesewas: number }>>`
        SELECT b."id", r."id" AS "roomId", rt."id" AS "roomTypeId", p."id" AS "priceId", p."pricePesewas"
        FROM "Bed" b
        JOIN "Room" r ON r."id" = b."roomId"
        JOIN "RoomType" rt ON rt."id" = r."roomTypeId"
        JOIN "Floor" f ON f."id" = r."floorId"
        JOIN "Block" bl ON bl."id" = f."blockId"
        JOIN "RoomTypePrice" p ON p."roomTypeId" = rt."id" AND p."semesterId" = ${semester.id}::uuid
        WHERE b."active" = true
          AND r."status" NOT IN ('UNDER_MAINTENANCE', 'RESERVED')
          AND rt."id" = ${input.roomTypeId}::uuid
          AND (${input.roomId ?? null}::uuid IS NULL OR r."id" = ${input.roomId ?? null}::uuid)
          AND (bl."gender" = 'MIXED' OR bl."gender"::text = ${student.gender})
          AND NOT EXISTS (
            SELECT 1 FROM "Booking" active
            WHERE active."bedId" = b."id" AND active."semesterId" = ${semester.id}::uuid
              AND (active."status" IN ('CONFIRMED', 'CHECKED_IN') OR (active."status" = 'HELD' AND active."holdExpiresAt" > ${now}))
          )
        ORDER BY (
          SELECT COUNT(*) FROM "Booking" occupied
          WHERE occupied."roomId" = r."id" AND occupied."semesterId" = ${semester.id}::uuid
            AND (occupied."status" IN ('CONFIRMED', 'CHECKED_IN') OR (occupied."status" = 'HELD' AND occupied."holdExpiresAt" > ${now}))
        ) DESC, bl."name" ASC, r."roomNumber" ASC, b."label" ASC
        LIMIT 1
        FOR UPDATE OF b SKIP LOCKED
      `;
      const bed = beds[0];
      if (!bed) throw Object.assign(new Error('No beds are available for this room type.'), { status: 409 });

      const created = await tx.booking.create({
        data: {
          studentId: student.id,
          semesterId: semester.id,
          roomId: bed.roomId,
          bedId: bed.id,
          priceId: bed.priceId,
          pricePesewas: bed.pricePesewas,
          status: BookingStatus.HELD,
          holdExpiresAt,
        },
        include: { room: { include: { roomType: true, floor: { include: { block: true } } } }, bed: true, semester: true },
      });
      await writeAudit({ actorId: req.auth!.userId, action: 'bed_held', entityType: 'Booking', entityId: created.id, metadata: { roomId: created.roomId, bedId: created.bedId, expiresAt: holdExpiresAt.toISOString() }, ipAddress: req.ip }, tx);
      return created;
    }, { isolationLevel: 'Serializable', timeout: 10_000 });

    return res.status(201).json({
      booking: {
        id: booking.id,
        status: booking.status,
        holdExpiresAt: booking.holdExpiresAt,
        pricePesewas: booking.pricePesewas,
        room: { roomNumber: booking.room.roomNumber, block: booking.room.floor.block.name, type: booking.room.roomType.name },
        bed: booking.bed.label,
        semester: booking.semester.name,
      },
    });
  } catch (error) {
    const status = (error as { status?: number; code?: string }).status;
    if (status) return res.status(status).json({ error: (error as Error).message });
    if ((error as { code?: string }).code === 'P2034') return res.status(409).json({ error: 'Availability changed. Please choose again.' });
    throw error;
  }
});

bookingRouter.get('/bookings/me', requireAuth, requireRole(Role.STUDENT), async (req, res) => {
  const student = await prisma.studentProfile.findUniqueOrThrow({ where: { userId: req.auth!.userId } });
  const bookings = await prisma.booking.findMany({
    where: { studentId: student.id },
    include: {
      room: { include: { roomType: true, floor: { include: { block: true } } } },
      semester: true,
      payments: { where: { status: 'SUCCESS' }, orderBy: { verifiedAt: 'asc' } },
    },
    orderBy: { createdAt: 'desc' },
  });
  return res.json({ bookings: bookings.map((booking) => {
    const totalPaidPesewas = booking.payments.reduce((total, payment) => total + payment.amountPesewas, 0);
    return {
      id: booking.id,
      status: booking.status,
      room: booking.room.roomNumber,
      block: booking.room.floor.block.name,
      roomType: booking.room.roomType.name,
      semester: booking.semester.name,
      pricePesewas: booking.pricePesewas,
      totalPaidPesewas,
      balancePesewas: Math.max(0, booking.pricePesewas - totalPaidPesewas),
      holdExpiresAt: booking.holdExpiresAt,
      payments: booking.payments,
    };
  }) });
});

bookingRouter.post('/bookings/:id/cancel', requireAuth, async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const booking = await prisma.booking.findUniqueOrThrow({ where: { id }, include: { student: true, semester: true } });
  const isOwner = booking.student.userId === req.auth!.userId;
  const isManager = managerRoles.has(req.auth!.role);
  if (!isOwner && !isManager) return res.status(403).json({ error: 'You cannot cancel this booking.' });
  if (booking.semester.status === SemesterStatus.CLOSED) return res.status(409).json({ error: 'Closed-semester bookings are read-only.' });
  if (!cancellableStatuses.has(booking.status)) return res.status(409).json({ error: 'This booking can no longer be cancelled.' });
  const updated = await prisma.booking.update({ where: { id }, data: { status: BookingStatus.CANCELLED, cancelledAt: new Date(), holdExpiresAt: null } });
  await writeAudit({ actorId: req.auth!.userId, action: 'booking_cancelled', entityType: 'Booking', entityId: id, ipAddress: req.ip });
  return res.json({ booking: updated });
});

bookingRouter.post('/bookings/:id/check-in', requireAuth, requireRole(Role.MANAGER, Role.ADMIN, Role.ADMINISTRATOR, Role.STAFF, Role.SECURITY), requirePermission('residents:check-in'), async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const booking = await prisma.booking.findUniqueOrThrow({ where: { id }, include: { semester: true } });
  if (booking.semester.status === SemesterStatus.CLOSED) return res.status(409).json({ error: 'Closed-semester bookings are read-only.' });
  if (booking.status !== BookingStatus.CONFIRMED) return res.status(409).json({ error: 'Only confirmed bookings can be checked in.' });
  const updated = await prisma.booking.update({ where: { id }, data: { status: BookingStatus.CHECKED_IN, checkedInAt: new Date() } });
  await writeAudit({ actorId: req.auth!.userId, action: 'resident_checked_in', entityType: 'Booking', entityId: id, ipAddress: req.ip });
  return res.json({ booking: updated });
});

bookingRouter.post('/bookings/:id/check-out', requireAuth, requireRole(Role.MANAGER, Role.ADMIN, Role.ADMINISTRATOR, Role.STAFF, Role.SECURITY), requirePermission('residents:check-in'), async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const booking = await prisma.booking.findUniqueOrThrow({ where: { id }, include: { semester: true } });
  if (booking.semester.status === SemesterStatus.CLOSED) return res.status(409).json({ error: 'Closed-semester bookings are read-only.' });
  if (booking.status !== BookingStatus.CHECKED_IN) return res.status(409).json({ error: 'Only checked-in bookings can be checked out.' });
  const updated = await prisma.booking.update({ where: { id }, data: { status: BookingStatus.CHECKED_OUT, checkedOutAt: new Date() } });
  await writeAudit({ actorId: req.auth!.userId, action: 'resident_checked_out', entityType: 'Booking', entityId: id, ipAddress: req.ip });
  return res.json({ booking: updated });
});

export const roomStatusForBooking = RoomStatus;