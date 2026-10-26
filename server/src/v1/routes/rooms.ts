import { Router } from 'express';
import { BlockGender, BookingStatus, Role, RoomStatus, SemesterStatus } from '@prisma/client';
import { z } from 'zod';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { requireAuth, requirePermission, requireRole } from '../middleware/auth.js';
import { writeAudit } from '../services/audit.js';

export const roomRouter = Router();
const managers = [Role.MANAGER, Role.ADMIN, Role.ADMINISTRATOR];
const roomEditorRoles = [Role.INPUTER, Role.MANAGER, Role.ADMIN, Role.ADMINISTRATOR];
const editableRoomStatuses = [RoomStatus.AVAILABLE, RoomStatus.RESERVED, RoomStatus.UNDER_MAINTENANCE] as const;

roomRouter.get('/hostels', requireAuth, async (_req, res) => {
  const hostels = await prisma.hostel.findMany({ include: { blocks: { include: { floors: true } } }, orderBy: { name: 'asc' } });
  return res.json({ hostels });
});

roomRouter.get('/blocks', requireAuth, async (_req, res) => {
  const blocks = await prisma.block.findMany({ include: { hostel: true, floors: true }, orderBy: [{ hostel: { name: 'asc' } }, { name: 'asc' }] });
  return res.json({ blocks });
});

roomRouter.get('/floors', requireAuth, async (_req, res) => {
  const floors = await prisma.floor.findMany({ include: { block: { include: { hostel: true } } }, orderBy: [{ block: { name: 'asc' } }, { sortOrder: 'asc' }] });
  return res.json({ floors });
});

roomRouter.get('/semesters', requireAuth, async (_req, res) => {
  const semesters = await prisma.semester.findMany({ orderBy: { startsAt: 'desc' } });
  return res.json({ semesters });
});

roomRouter.get('/room-types', requireAuth, async (req, res) => {
  const semesterId = typeof req.query.semesterId === 'string'
    ? req.query.semesterId
    : (await prisma.semester.findFirst({ where: { status: SemesterStatus.ACTIVE } }))?.id;
  const types = await prisma.roomType.findMany({
    where: { active: true },
    include: { prices: { where: semesterId ? { semesterId } : { semester: { status: SemesterStatus.ACTIVE } } } },
    orderBy: { capacity: 'asc' },
  });
  return res.json({ roomTypes: types.map((type) => ({
    id: type.id,
    name: type.name,
    capacity: type.capacity,
    pricePesewas: type.prices[0]?.pricePesewas ?? null,
  })) });
});

roomRouter.get('/rooms/availability', requireAuth, async (req, res) => {
  const query = z.object({
    semesterId: z.string().uuid().optional(),
    roomTypeId: z.string().uuid().optional(),
  }).parse(req.query);
  const semester = query.semesterId
    ? await prisma.semester.findUnique({ where: { id: query.semesterId } })
    : await prisma.semester.findFirst({ where: { status: SemesterStatus.ACTIVE } });
  if (!semester) return res.status(404).json({ error: 'No active semester is configured.' });
  const now = new Date();
  const studentGender = req.auth!.role === Role.STUDENT
    ? (await prisma.studentProfile.findUnique({ where: { userId: req.auth!.userId }, select: { gender: true } }))?.gender
    : null;
  const rooms = await prisma.room.findMany({
    where: {
      ...(query.roomTypeId ? { roomTypeId: query.roomTypeId } : {}),
      status: { not: RoomStatus.UNDER_MAINTENANCE },
      ...(req.auth!.role === Role.STUDENT ? { floor: { block: { gender: { in: studentGender ? [studentGender as unknown as BlockGender, BlockGender.MIXED] : [BlockGender.MIXED] } } } } : {}),
    },
    include: {
      floor: { include: { block: { include: { hostel: true } } } },
      roomType: { include: { prices: { where: { semesterId: semester.id } } } },
      beds: {
        where: { active: true },
        include: {
          bookings: {
            where: {
              semesterId: semester.id,
              OR: [
                { status: { in: [BookingStatus.CONFIRMED, BookingStatus.CHECKED_IN] } },
                { status: BookingStatus.HELD, holdExpiresAt: { gt: now } },
              ],
            },
            select: { id: true, status: true, holdExpiresAt: true },
          },
        },
      },
    },
    orderBy: [{ floor: { block: { name: 'asc' } } }, { roomNumber: 'asc' }],
  });
  return res.json({
    semester: { id: semester.id, name: semester.name },
    rooms: rooms.map((room) => {
      const taken = room.beds.filter((bed) => bed.bookings.length > 0).length;
      const capacity = room.beds.length;
      const available = room.status === RoomStatus.RESERVED ? 0 : Math.max(0, capacity - taken);
      const roomStatus = room.status === RoomStatus.UNDER_MAINTENANCE
        ? RoomStatus.UNDER_MAINTENANCE
        : room.status === RoomStatus.RESERVED ? RoomStatus.RESERVED
        : available === 0 ? RoomStatus.FULL : taken === 0 ? RoomStatus.AVAILABLE : RoomStatus.PARTLY_FILLED;
      return {
        id: room.id,
        roomNumber: room.roomNumber,
        hostel: room.floor.block.hostel.name,
        block: room.floor.block.name,
        gender: room.floor.block.gender,
        floor: room.floor.name,
        roomTypeId: room.roomTypeId,
        roomType: room.roomType.name,
        capacity,
        taken,
        available,
        pricePesewas: room.roomType.prices[0]?.pricePesewas ?? null,
        status: roomStatus,
      };
    }),
  });
});

roomRouter.post('/hostels', requireAuth, requireRole(...managers), requirePermission('hostel:manage'), async (req, res) => {
  const input = z.object({ name: z.string().trim().min(2).max(120), address: z.string().trim().max(240).optional() }).parse(req.body);
  const hostel = await prisma.hostel.create({ data: input });
  await writeAudit({ actorId: req.auth!.userId, action: 'hostel_created', entityType: 'Hostel', entityId: hostel.id, metadata: { name: hostel.name }, ipAddress: req.ip });
  return res.status(201).json({ hostel });
});

roomRouter.post('/blocks', requireAuth, requireRole(...managers), requirePermission('hostel:manage'), async (req, res) => {
  const input = z.object({ hostelId: z.string().uuid(), name: z.string().trim().min(1).max(80), gender: z.nativeEnum(BlockGender).default(BlockGender.MIXED) }).parse(req.body);
  const block = await prisma.block.create({ data: input });
  await writeAudit({ actorId: req.auth!.userId, action: 'block_created', entityType: 'Block', entityId: block.id, metadata: { name: block.name, gender: block.gender }, ipAddress: req.ip });
  return res.status(201).json({ block });
});

roomRouter.post('/floors', requireAuth, requireRole(...managers), requirePermission('hostel:manage'), async (req, res) => {
  const input = z.object({ blockId: z.string().uuid(), name: z.string().trim().min(1).max(40), sortOrder: z.number().int().min(0).default(0) }).parse(req.body);
  const floor = await prisma.floor.create({ data: input });
  await writeAudit({ actorId: req.auth!.userId, action: 'floor_created', entityType: 'Floor', entityId: floor.id, metadata: { name: floor.name }, ipAddress: req.ip });
  return res.status(201).json({ floor });
});

roomRouter.post('/semesters', requireAuth, requireRole(...managers), requirePermission('hostel:manage'), async (req, res) => {
  const input = z.object({
    name: z.string().trim().min(2).max(80),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
    depositBps: z.number().int().min(1000).max(10000).default(5000),
    balanceDueAt: z.coerce.date().optional(),
  }).parse(req.body);
  if (input.endsAt <= input.startsAt) return res.status(400).json({ error: 'Semester end must be after its start.' });
  const semester = await prisma.semester.create({ data: input });
  await writeAudit({ actorId: req.auth!.userId, action: 'semester_created', entityType: 'Semester', entityId: semester.id, metadata: { name: semester.name }, ipAddress: req.ip });
  return res.status(201).json({ semester });
});

roomRouter.post('/semesters/:id/activate', requireAuth, requireRole(...managers), requirePermission('hostel:manage'), async (req, res) => {
  const semesterId = z.string().uuid().parse(req.params.id);
  const semester = await prisma.$transaction(async (tx) => {
    await tx.semester.updateMany({ where: { status: SemesterStatus.ACTIVE }, data: { status: SemesterStatus.UPCOMING } });
    return tx.semester.update({ where: { id: semesterId }, data: { status: SemesterStatus.ACTIVE } });
  });
  await writeAudit({ actorId: req.auth!.userId, action: 'semester_activated', entityType: 'Semester', entityId: semester.id, ipAddress: req.ip });
  return res.json({ semester });
});

roomRouter.post('/semesters/:id/close', requireAuth, requireRole(...managers), requirePermission('hostel:manage'), async (req, res) => {
  const semesterId = z.string().uuid().parse(req.params.id);
  const semester = await prisma.semester.update({ where: { id: semesterId }, data: { status: SemesterStatus.CLOSED } });
  await writeAudit({ actorId: req.auth!.userId, action: 'semester_closed', entityType: 'Semester', entityId: semester.id, ipAddress: req.ip });
  return res.json({ semester });
});

roomRouter.post('/room-types', requireAuth, requireRole(...managers), requirePermission('hostel:manage'), async (req, res) => {
  const input = z.object({ name: z.string().trim().min(2).max(60), capacity: z.number().int().min(1).max(20), semesterId: z.string().uuid(), pricePesewas: z.number().int().positive() }).parse(req.body);
  const type = await prisma.$transaction(async (tx) => {
    const created = await tx.roomType.create({ data: { name: input.name, capacity: input.capacity } });
    await tx.roomTypePrice.create({ data: { roomTypeId: created.id, semesterId: input.semesterId, pricePesewas: input.pricePesewas } });
    return created;
  });
  await writeAudit({ actorId: req.auth!.userId, action: 'room_type_created', entityType: 'RoomType', entityId: type.id, metadata: { capacity: type.capacity }, ipAddress: req.ip });
  return res.status(201).json({ roomType: type });
});

roomRouter.put('/room-types/:id/prices/:semesterId', requireAuth, requireRole(...managers), requirePermission('hostel:manage'), async (req, res) => {
  const { id: roomTypeId, semesterId } = z.object({ id: z.string().uuid(), semesterId: z.string().uuid() }).parse(req.params);
  const { pricePesewas } = z.object({ pricePesewas: z.number().int().positive() }).parse(req.body);
  const price = await prisma.roomTypePrice.upsert({
    where: { roomTypeId_semesterId: { roomTypeId, semesterId } },
    create: { roomTypeId, semesterId, pricePesewas },
    update: { pricePesewas },
  });
  await writeAudit({ actorId: req.auth!.userId, action: 'room_price_changed', entityType: 'RoomTypePrice', entityId: price.id, metadata: { roomTypeId, semesterId, pricePesewas }, ipAddress: req.ip });
  return res.json({ price });
});

roomRouter.post('/rooms', requireAuth, requireRole(...roomEditorRoles), requirePermission('hostel:records:write'), async (req, res) => {
  const input = z.object({
    floorId: z.string().uuid(),
    roomTypeId: z.string().uuid(),
    roomNumber: z.string().trim().min(1).max(30),
  }).parse(req.body);
  const type = await prisma.roomType.findUniqueOrThrow({ where: { id: input.roomTypeId } });
  const room = await prisma.room.create({
    data: {
      ...input,
      beds: { create: Array.from({ length: type.capacity }, (_, index) => ({ label: String(index + 1) })) },
    },
    include: { beds: true },
  });
  await writeAudit({ actorId: req.auth!.userId, action: 'room_created', entityType: 'Room', entityId: room.id, metadata: { roomNumber: room.roomNumber }, ipAddress: req.ip });
  return res.status(201).json({ room });
});

roomRouter.patch('/rooms/:id/status', requireAuth, requireRole(...roomEditorRoles), requirePermission('hostel:records:write'), async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const { status } = z.object({ status: z.enum(editableRoomStatuses) }).parse(req.body);
  const room = await prisma.room.update({ where: { id }, data: { status } });
  await writeAudit({ actorId: req.auth!.userId, action: 'room_status_changed', entityType: 'Room', entityId: room.id, metadata: { status }, ipAddress: req.ip });
  return res.json({ room });
});

export { config as roomConfig };