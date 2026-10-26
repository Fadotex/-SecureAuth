import { Router } from 'express';
import { BookingStatus, EmailJobStatus, MaintenanceStatus, Notice, PaymentStatus, Role, RoleProfile, RoomChangeStatus, SemesterStatus, VisitorStatus } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAuth, requirePermission, requireRole } from '../middleware/auth.js';
import { writeAudit } from '../services/audit.js';
import { enqueueEmail } from '../services/email.js';
import { hostelPaymentState, remainingBalancePesewas } from '../services/money.js';
import { hashPassword } from '../services/password.js';
import { isEligibleLegacyStudentMapping } from '../services/student-role-mapping.js';

export const operationsRouter = Router();
const adminOnly = [Role.ADMINISTRATOR];
const staffAndAdmin = [Role.INPUTER, Role.MANAGER, Role.ADMIN, Role.ADMINISTRATOR, Role.STAFF];
const studentRoles = [Role.STUDENT];
const staffPermissions = ['students:read', 'payments:manual', 'residents:check-in', 'maintenance:manage', 'visitors:manage', 'notices:read', 'room-changes:manage'];

operationsRouter.get('/student/dashboard', requireAuth, requireRole(...studentRoles), async (req, res) => {
  const profile = await prisma.studentProfile.findUniqueOrThrow({ where: { userId: req.auth!.userId } });
  const activeSemester = await prisma.semester.findFirst({ where: { status: SemesterStatus.ACTIVE } });
  const [booking, requests, notices] = await Promise.all([
    activeSemester ? prisma.booking.findFirst({
      where: { studentId: profile.id, semesterId: activeSemester.id, status: { in: [BookingStatus.HELD, BookingStatus.CONFIRMED, BookingStatus.CHECKED_IN] } },
      include: {
        room: { include: { roomType: true, floor: { include: { block: true } } } },
        bed: true,
        payments: { orderBy: { createdAt: 'desc' } },
      },
      orderBy: { createdAt: 'desc' },
    }) : null,
    prisma.maintenanceRequest.findMany({ where: { studentId: profile.id }, include: { room: true }, orderBy: { createdAt: 'desc' }, take: 10 }),
    prisma.notice.findMany({
      where: {
        AND: [
          { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
          { OR: [{ targetRoles: { isEmpty: true } }, { targetRoles: { has: req.auth!.role } }] },
        ],
      },
      include: { blocks: { include: { block: true } }, reads: { where: { studentId: profile.id }, select: { readAt: true } } },
      orderBy: { publishedAt: 'desc' },
      take: 20,
    }),
  ]);
  const visibleNotices = notices.filter((notice: Notice & { blocks: { block: { id: string } }[] }) =>
    notice.blocks.length === 0 || (booking && notice.blocks.some((entry) => entry.block.id === booking.room.floor.blockId)),
  );
  const successfulPayments = booking?.payments.filter((payment) => payment.status === PaymentStatus.SUCCESS) || [];
  const totalPaidPesewas = successfulPayments.reduce((total, payment) => total + payment.amountPesewas, 0);
  const roommates = booking
    ? await prisma.booking.count({ where: { roomId: booking.roomId, semesterId: booking.semesterId, status: { in: [BookingStatus.CONFIRMED, BookingStatus.CHECKED_IN] } } })
    : 0;

  return res.json({
    semester: activeSemester,
    booking: booking ? {
      id: booking.id,
      status: booking.status,
      roomNumber: booking.room.roomNumber,
      block: booking.room.floor.block.name,
      floor: booking.room.floor.name,
      roomType: booking.room.roomType.name,
      bed: booking.bed.label,
      roommates: Math.max(0, roommates - 1),
      pricePesewas: booking.pricePesewas,
      totalPaidPesewas,
      balancePesewas: remainingBalancePesewas(booking.pricePesewas, totalPaidPesewas),
      holdExpiresAt: booking.holdExpiresAt,
      paymentStatus: hostelPaymentState(booking.pricePesewas, totalPaidPesewas),
      payments: successfulPayments,
    } : null,
    maintenance: requests,
    notices: visibleNotices.map(({ reads, ...notice }) => ({ ...notice, read: reads.length > 0 })),
  });
});

operationsRouter.get('/students', requireAuth, requireRole(...staffAndAdmin), requirePermission('students:read'), async (req, res) => {
  const query = z.object({ q: z.string().trim().max(100).optional(), semesterId: z.string().uuid().optional() }).parse(req.query);
  const profiles = await prisma.studentProfile.findMany({
    where: query.q ? {
      OR: [
        { studentId: { contains: query.q, mode: 'insensitive' } },
        { user: { fullName: { contains: query.q, mode: 'insensitive' } } },
        { bookings: { some: { room: { roomNumber: { contains: query.q, mode: 'insensitive' } } } } },
      ],
    } : undefined,
    include: {
      user: { select: { id: true, email: true, fullName: true, phone: true } },
      bookings: {
        where: { ...(query.semesterId ? { semesterId: query.semesterId } : {}), status: { in: [BookingStatus.HELD, BookingStatus.CONFIRMED, BookingStatus.CHECKED_IN] } },
        include: { room: true, semester: true, payments: { where: { status: PaymentStatus.SUCCESS } } },
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
    orderBy: { user: { fullName: 'asc' } },
    take: 100,
  });
  return res.json({ students: profiles.map((profile) => {
    const booking = profile.bookings[0];
    const paid = booking?.payments.reduce((total, payment) => total + payment.amountPesewas, 0) || 0;
    return {
      studentId: profile.studentId,
      name: profile.user.fullName,
      email: profile.user.email,
      phone: profile.user.phone,
      guardianName: req.auth!.role === Role.ADMIN ? profile.guardianName : undefined,
      guardianPhone: req.auth!.role === Role.ADMIN ? profile.guardianPhone : undefined,
      booking: booking ? { id: booking.id, roomNumber: booking.room.roomNumber, semester: booking.semester.name, status: booking.status, paidPesewas: paid, balancePesewas: Math.max(0, booking.pricePesewas - paid) } : null,
    };
  }) });
});

operationsRouter.post('/maintenance', requireAuth, requireRole(Role.STUDENT), async (req, res) => {
  const input = z.object({ bookingId: z.string().uuid(), title: z.string().trim().min(3).max(120), description: z.string().trim().min(5).max(3000), photoUrl: z.string().url().max(1000).optional() }).parse(req.body);
  const profile = await prisma.studentProfile.findUniqueOrThrow({ where: { userId: req.auth!.userId } });
  const booking = await prisma.booking.findFirst({ where: { id: input.bookingId, studentId: profile.id, status: { in: [BookingStatus.CONFIRMED, BookingStatus.CHECKED_IN] } } });
  if (!booking) return res.status(404).json({ error: 'Active room booking not found.' });
  const request = await prisma.maintenanceRequest.create({ data: { studentId: profile.id, roomId: booking.roomId, title: input.title, description: input.description, photoUrl: input.photoUrl } });
  await writeAudit({ actorId: req.auth!.userId, action: 'maintenance_requested', entityType: 'MaintenanceRequest', entityId: request.id, ipAddress: req.ip });
  return res.status(201).json({ request });
});

operationsRouter.get('/maintenance', requireAuth, requireRole(...staffAndAdmin, Role.STUDENT), requirePermission('maintenance:manage'), async (req, res) => {
  const where = req.auth!.role === Role.STUDENT
    ? { student: { userId: req.auth!.userId } }
    : undefined;
  if (req.auth!.role === Role.SECURITY) return res.status(403).json({ error: 'You do not have permission to view maintenance.' });
  const requests = await prisma.maintenanceRequest.findMany({ where, include: { student: { include: { user: true } }, room: true, assignedTo: { select: { fullName: true } } }, orderBy: { createdAt: 'desc' }, take: 200 });
  return res.json({ requests });
});

operationsRouter.patch('/maintenance/:id', requireAuth, requireRole(...staffAndAdmin), requirePermission('maintenance:manage'), async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const input = z.object({ status: z.nativeEnum(MaintenanceStatus), assignedToId: z.string().uuid().nullable().optional() }).parse(req.body);
  const request = await prisma.maintenanceRequest.update({
    where: { id },
    data: { ...input, resolvedAt: input.status === MaintenanceStatus.RESOLVED ? new Date() : null },
  });
  await writeAudit({ actorId: req.auth!.userId, action: 'maintenance_updated', entityType: 'MaintenanceRequest', entityId: id, metadata: { status: input.status, assignedToId: input.assignedToId }, ipAddress: req.ip });
  return res.json({ request });
});

operationsRouter.post('/room-change-requests', requireAuth, requireRole(Role.STUDENT), async (req, res) => {
  const input = z.object({ bookingId: z.string().uuid(), requestedRoomId: z.string().uuid(), reason: z.string().trim().min(5).max(1000) }).parse(req.body);
  const profile = await prisma.studentProfile.findUniqueOrThrow({ where: { userId: req.auth!.userId } });
  const booking = await prisma.booking.findFirst({ where: { id: input.bookingId, studentId: profile.id, status: { in: [BookingStatus.CONFIRMED, BookingStatus.CHECKED_IN] } }, include: { semester: true } });
  if (!booking) return res.status(404).json({ error: 'Active booking not found.' });
  if (booking.semester.status === SemesterStatus.CLOSED) return res.status(409).json({ error: 'Closed-semester bookings are read-only.' });
  const change = await prisma.roomChangeRequest.create({ data: { studentId: profile.id, bookingId: booking.id, requestedRoomId: input.requestedRoomId, reason: input.reason } });
  await writeAudit({ actorId: req.auth!.userId, action: 'room_change_requested', entityType: 'RoomChangeRequest', entityId: change.id, ipAddress: req.ip });
  return res.status(201).json({ request: change });
});

operationsRouter.get('/room-change-requests', requireAuth, requireRole(Role.MANAGER, Role.ADMIN, Role.ADMINISTRATOR, Role.STAFF), requirePermission('room-changes:manage'), async (_req, res) => {
  const requests = await prisma.roomChangeRequest.findMany({ include: { student: { include: { user: true } }, booking: { include: { room: true } }, requestedRoom: true }, orderBy: { createdAt: 'asc' } });
  return res.json({ requests });
});

operationsRouter.post('/room-change-requests/:id/decision', requireAuth, requireRole(Role.MANAGER, Role.ADMIN, Role.ADMINISTRATOR), requirePermission('room-changes:manage'), async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const { decision } = z.object({ decision: z.enum(['APPROVED', 'REJECTED']) }).parse(req.body);
  const request = await prisma.roomChangeRequest.findUniqueOrThrow({ where: { id }, include: { booking: true, requestedRoom: { include: { beds: true } } } });
  if (request.status !== RoomChangeStatus.PENDING) return res.status(409).json({ error: 'This request has already been decided.' });
  if (decision === 'REJECTED') {
    const updated = await prisma.roomChangeRequest.update({ where: { id }, data: { status: RoomChangeStatus.REJECTED, decidedById: req.auth!.userId, decidedAt: new Date() } });
    await writeAudit({ actorId: req.auth!.userId, action: 'room_change_rejected', entityType: 'RoomChangeRequest', entityId: id, ipAddress: req.ip });
    return res.json({ request: updated });
  }

  const moved = await prisma.$transaction(async (tx) => {
    const bed = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT b."id" FROM "Bed" b WHERE b."roomId" = ${request.requestedRoomId}::uuid AND b."active" = true
      AND NOT EXISTS (SELECT 1 FROM "Booking" x WHERE x."bedId" = b."id" AND x."semesterId" = ${request.booking.semesterId}::uuid AND x."status" IN ('CONFIRMED', 'CHECKED_IN', 'HELD'))
      ORDER BY b."label" LIMIT 1 FOR UPDATE OF b SKIP LOCKED
    `;
    if (!bed[0]) throw Object.assign(new Error('No bed is available in the requested room.'), { status: 409 });
    const booking = await tx.booking.update({ where: { id: request.bookingId }, data: { roomId: request.requestedRoomId, bedId: bed[0].id } });
    const updatedRequest = await tx.roomChangeRequest.update({ where: { id }, data: { status: RoomChangeStatus.APPROVED, decidedById: req.auth!.userId, decidedAt: new Date() } });
    await writeAudit({ actorId: req.auth!.userId, action: 'room_change_approved', entityType: 'RoomChangeRequest', entityId: id, metadata: { roomId: request.requestedRoomId }, ipAddress: req.ip }, tx);
    return { booking, request: updatedRequest };
  }, { isolationLevel: 'Serializable' });
  return res.json(moved);
});

operationsRouter.post('/visitors', requireAuth, requireRole(Role.MANAGER, Role.ADMIN, Role.ADMINISTRATOR, Role.STAFF, Role.SECURITY), requirePermission('visitors:manage'), async (req, res) => {
  const input = z.object({ fullName: z.string().trim().min(2).max(120), studentId: z.string().trim().min(1).max(40).optional(), identityRef: z.string().trim().max(80).optional(), purpose: z.string().trim().max(240).optional(), flaggedReason: z.string().trim().max(500).optional() }).parse(req.body);
  const student = input.studentId ? await prisma.studentProfile.findUnique({ where: { studentId: input.studentId } }) : null;
  if (input.studentId && !student) return res.status(404).json({ error: 'Host student not found.' });
  const visitor = await prisma.visitor.create({
    data: {
      fullName: input.fullName,
      studentId: student?.id,
      identityRef: input.identityRef,
      purpose: input.purpose,
      loggedById: req.auth!.userId,
      status: input.flaggedReason ? VisitorStatus.FLAGGED : VisitorStatus.CHECKED_IN,
      flaggedReason: input.flaggedReason,
    },
  });
  await writeAudit({ actorId: req.auth!.userId, action: 'visitor_checked_in', entityType: 'Visitor', entityId: visitor.id, metadata: { flagged: Boolean(input.flaggedReason) }, ipAddress: req.ip });
  return res.status(201).json({ visitor });
});

operationsRouter.get('/visitors', requireAuth, requireRole(Role.MANAGER, Role.ADMIN, Role.ADMINISTRATOR, Role.STAFF, Role.SECURITY), requirePermission('visitors:manage'), async (req, res) => {
  const visitors = await prisma.visitor.findMany({ include: { student: { include: { user: { select: { fullName: true } } } }, loggedBy: { select: { fullName: true } } }, orderBy: { checkedInAt: 'desc' }, take: 500 });
  return res.json({ visitors });
});

operationsRouter.post('/visitors/:id/check-out', requireAuth, requireRole(Role.MANAGER, Role.ADMIN, Role.ADMINISTRATOR, Role.STAFF, Role.SECURITY), requirePermission('visitors:manage'), async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const visitor = await prisma.visitor.update({ where: { id }, data: { status: VisitorStatus.CHECKED_OUT, checkedOutAt: new Date() } });
  await writeAudit({ actorId: req.auth!.userId, action: 'visitor_checked_out', entityType: 'Visitor', entityId: id, ipAddress: req.ip });
  return res.json({ visitor });
});

operationsRouter.post('/notices', requireAuth, requireRole(Role.MANAGER, Role.ADMIN, Role.ADMINISTRATOR), async (req, res) => {
  const input = z.object({ title: z.string().trim().min(3).max(160), body: z.string().trim().min(3).max(8000), targetRoles: z.array(z.nativeEnum(Role)).default([]), blockIds: z.array(z.string().uuid()).default([]), expiresAt: z.coerce.date().optional() }).parse(req.body);
  const notice = await prisma.notice.create({
    data: {
      authorId: req.auth!.userId,
      title: input.title,
      body: input.body,
      targetRoles: input.targetRoles,
      expiresAt: input.expiresAt,
      blocks: { create: input.blockIds.map((blockId) => ({ blockId })) },
    },
    include: { blocks: true },
  });
  await writeAudit({ actorId: req.auth!.userId, action: 'notice_published', entityType: 'Notice', entityId: notice.id, ipAddress: req.ip });
  return res.status(201).json({ notice });
});

operationsRouter.get('/notices', requireAuth, requireRole(Role.INPUTER, Role.MANAGER, Role.ADMIN, Role.ADMINISTRATOR, Role.STAFF, Role.STUDENT), requirePermission('notices:read'), async (req, res) => {
  const profile = req.auth!.role === Role.STUDENT ? await prisma.studentProfile.findUnique({ where: { userId: req.auth!.userId } }) : null;
  const notices = await prisma.notice.findMany({
    where: {
      AND: [
        { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
        { OR: [{ targetRoles: { isEmpty: true } }, { targetRoles: { has: req.auth!.role } }] },
      ],
    },
    include: { blocks: { include: { block: true } }, reads: profile ? { where: { studentId: profile.id } } : false },
    orderBy: { publishedAt: 'desc' },
  });
  return res.json({ notices });
});

operationsRouter.post('/notices/:id/read', requireAuth, requireRole(Role.STUDENT), async (req, res) => {
  const noticeId = z.string().uuid().parse(req.params.id);
  const profile = await prisma.studentProfile.findUniqueOrThrow({ where: { userId: req.auth!.userId } });
  const read = await prisma.noticeRead.upsert({ where: { noticeId_studentId: { noticeId, studentId: profile.id } }, create: { noticeId, studentId: profile.id }, update: { readAt: new Date() } });
  return res.json({ read });
});

operationsRouter.post('/admin/staff', requireAuth, requireRole(...adminOnly), async (req, res) => {
  const input = z.object({ fullName: z.string().trim().min(2).max(120), email: z.string().trim().email().max(254), phone: z.string().trim().max(32).optional(), temporaryPassword: z.string().min(12).max(128), permissions: z.array(z.enum(staffPermissions as [string, ...string[]])).default(staffPermissions) }).parse(req.body);
  const user = await prisma.user.create({
    data: {
      fullName: input.fullName,
      email: input.email.toLowerCase(),
      phone: input.phone,
      passwordHash: await hashPassword(input.temporaryPassword),
      role: Role.STAFF,
      emailVerifiedAt: new Date(),
      mustChangePassword: true,
      permissions: input.permissions,
    },
  });
  await enqueueEmail({ userId: user.id, toEmail: user.email, template: 'staff-invitation', payload: { name: user.fullName, message: 'An administrator created your staff account. Sign in with the temporary password and change it immediately.' } });
  await writeAudit({ actorId: req.auth!.userId, action: 'staff_created', entityType: 'User', entityId: user.id, metadata: { email: user.email, permissions: input.permissions }, ipAddress: req.ip });
  return res.status(201).json({ user: { id: user.id, email: user.email, fullName: user.fullName, role: user.role, permissions: user.permissions, mustChangePassword: user.mustChangePassword } });
});

operationsRouter.post('/admin/security', requireAuth, requireRole(...adminOnly), async (req, res) => {
  const input = z.object({ fullName: z.string().trim().min(2).max(120), email: z.string().trim().email().max(254), temporaryPassword: z.string().min(12).max(128) }).parse(req.body);
  const user = await prisma.user.create({
    data: {
      fullName: input.fullName,
      email: input.email.toLowerCase(),
      passwordHash: await hashPassword(input.temporaryPassword),
      role: Role.SECURITY,
      emailVerifiedAt: new Date(),
      mustChangePassword: true,
      permissions: ['residents:check-in', 'visitors:manage'],
    },
  });
  await enqueueEmail({ userId: user.id, toEmail: user.email, template: 'security-invitation', payload: { name: user.fullName, message: 'An administrator created your security desk account. Change the temporary password before using the visitor and check-in desk.' } });
  await writeAudit({ actorId: req.auth!.userId, action: 'security_account_created', entityType: 'User', entityId: user.id, metadata: { email: user.email }, ipAddress: req.ip });
  return res.status(201).json({ user: { id: user.id, email: user.email, fullName: user.fullName, role: user.role, permissions: user.permissions, mustChangePassword: user.mustChangePassword } });
});

operationsRouter.get('/admin/staff', requireAuth, requireRole(...adminOnly), async (_req, res) => {
  const staff = await prisma.user.findMany({ where: { role: { in: [Role.STAFF, Role.SECURITY] }, isActive: true }, select: { id: true, email: true, fullName: true, role: true, phone: true, permissions: true, mustChangePassword: true, twoFactorEnabled: true, createdAt: true }, orderBy: { fullName: 'asc' } });
  return res.json({ staff });
});

operationsRouter.delete('/admin/staff/:id', requireAuth, requireRole(...adminOnly), async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const staff = await prisma.user.findFirstOrThrow({ where: { id, role: { in: [Role.STAFF, Role.SECURITY] }, isActive: true } });
  await prisma.$transaction([
    prisma.user.update({ where: { id }, data: { isActive: false } }),
    prisma.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } }),
    prisma.auditLog.create({ data: { actorId: req.auth!.userId, action: 'staff_deactivated', entityType: 'User', entityId: id, metadata: { email: staff.email }, ipAddress: req.ip } }),
  ]);
  return res.status(204).end();
});

operationsRouter.patch('/admin/staff/:id/permissions', requireAuth, requireRole(...adminOnly), async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const { permissions } = z.object({ permissions: z.array(z.enum(staffPermissions as [string, ...string[]])) }).parse(req.body);
  const user = await prisma.user.update({ where: { id, role: Role.STAFF }, data: { permissions } });
  await writeAudit({ actorId: req.auth!.userId, action: 'staff_permissions_changed', entityType: 'User', entityId: id, metadata: { permissions }, ipAddress: req.ip });
  return res.json({ user: { id: user.id, email: user.email, role: user.role, permissions: user.permissions } });
});

operationsRouter.get('/admin/audit-logs', requireAuth, requireRole(...adminOnly), async (req, res) => {
  const { cursor } = z.object({ cursor: z.string().uuid().optional() }).parse(req.query);
  const logs = await prisma.auditLog.findMany({
    include: { actor: { select: { fullName: true, email: true, role: true } } },
    orderBy: { createdAt: 'desc' },
    take: 100,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
  });
  return res.json({ logs, nextCursor: logs.length === 100 ? logs[logs.length - 1]?.id : null });
});

operationsRouter.get('/admin/settings', requireAuth, requireRole(...adminOnly), async (_req, res) => {
  const settings = await prisma.appSetting.findMany({ orderBy: { key: 'asc' } });
  return res.json({ settings });
});

operationsRouter.put('/admin/settings/:key', requireAuth, requireRole(...adminOnly), async (req, res) => {
  const key = z.string().regex(/^[a-z][a-z0-9_.-]{1,99}$/).parse(req.params.key);
  const { value } = z.object({ value: z.unknown() }).parse(req.body);
  const setting = await prisma.appSetting.upsert({ where: { key }, create: { key, value: value as never }, update: { value: value as never } });
  await writeAudit({ actorId: req.auth!.userId, action: 'setting_changed', entityType: 'AppSetting', entityId: key, metadata: { value: value as never }, ipAddress: req.ip });
  return res.json({ setting });
});

operationsRouter.get('/admin/email-jobs', requireAuth, requireRole(...adminOnly), async (_req, res) => {
  const jobs = await prisma.emailJob.findMany({ orderBy: { createdAt: 'desc' }, take: 200 });
  return res.json({ jobs: jobs.map(({ payload: _payload, ...job }) => job) });
});

operationsRouter.post('/system/users', requireAuth, requireRole(Role.ADMINISTRATOR), async (req, res) => {
  const input = z.object({
    fullName: z.string().trim().min(2).max(120),
    email: z.string().trim().email().max(254),
    temporaryPassword: z.string().min(12).max(128),
    role: z.enum([Role.INPUTER, Role.MANAGER, Role.ADMIN, Role.ADMINISTRATOR]),
  }).parse(req.body);
  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        fullName: input.fullName,
        email: input.email.toLowerCase(),
        passwordHash: await hashPassword(input.temporaryPassword),
        role: input.role,
        roleProfile: RoleProfile.TARGET,
        emailVerifiedAt: new Date(),
        mustChangePassword: true,
      },
    });
    await writeAudit({ actorId: req.auth!.userId, action: 'system_user_created', entityType: 'User', entityId: created.id, metadata: { email: created.email, role: created.role }, ipAddress: req.ip }, tx);
    return created;
  });
  return res.status(201).json({ user: { id: user.id, email: user.email, fullName: user.fullName, role: user.role, mustChangePassword: true } });
});

operationsRouter.get('/system/users', requireAuth, requireRole(Role.ADMINISTRATOR), async (_req, res) => {
  const users = await prisma.user.findMany({
    select: { id: true, email: true, fullName: true, role: true, roleProfile: true, isActive: true, twoFactorEnabled: true, mustChangePassword: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });
  return res.json({ users });
});

operationsRouter.post('/system/users/:id/map-student', requireAuth, requireRole(Role.ADMINISTRATOR), async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  if (id === req.auth!.userId) return res.status(400).json({ error: 'You cannot map your own account.' });
  const candidate = await prisma.user.findUniqueOrThrow({
    where: { id },
    select: {
      role: true,
      roleProfile: true,
      isActive: true,
      emailVerifiedAt: true,
      email: true,
      studentProfile: { select: { id: true } },
    },
  });
  if (!isEligibleLegacyStudentMapping({ ...candidate, hasStudentProfile: candidate.studentProfile !== null })) {
    return res.status(409).json({ error: 'Only an active, verified legacy STUDENT with a student profile can be mapped to the STUDENT portal.' });
  }

  await prisma.$transaction(async (tx) => {
    const mapped = await tx.user.updateMany({
      where: { id, role: Role.STUDENT, roleProfile: RoleProfile.LEGACY, isActive: true, emailVerifiedAt: { not: null }, studentProfile: { isNot: null } },
      data: { roleProfile: RoleProfile.TARGET, mustChangePassword: true, sessionVersion: { increment: 1 } },
    });
    if (mapped.count !== 1) throw Object.assign(new Error('This student account changed before mapping; reload and review it again.'), { status: 409 });
    await tx.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    await writeAudit({
      actorId: req.auth!.userId,
      action: 'legacy_student_mapped',
      entityType: 'User',
      entityId: id,
      metadata: { email: candidate.email, oldRole: Role.STUDENT, oldRoleProfile: RoleProfile.LEGACY, newRole: Role.STUDENT, newRoleProfile: RoleProfile.TARGET },
      ipAddress: req.ip,
    }, tx);
  });
  return res.json({ user: { id, role: Role.STUDENT, roleProfile: RoleProfile.TARGET, mustChangePassword: true } });
});

operationsRouter.post('/admin/inputers', requireAuth, requireRole(Role.MANAGER, Role.ADMINISTRATOR), requirePermission('inputers:create'), async (req, res) => {
  const input = z.object({
    fullName: z.string().trim().min(2).max(120),
    email: z.string().trim().email().max(254),
    temporaryPassword: z.string().min(12).max(128),
  }).parse(req.body);
  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        fullName: input.fullName,
        email: input.email.toLowerCase(),
        passwordHash: await hashPassword(input.temporaryPassword),
        role: Role.INPUTER,
        roleProfile: RoleProfile.TARGET,
        emailVerifiedAt: new Date(),
        mustChangePassword: true,
      },
    });
    await writeAudit({ actorId: req.auth!.userId, action: 'inputer_created', entityType: 'User', entityId: created.id, metadata: { email: created.email }, ipAddress: req.ip }, tx);
    return created;
  });
  return res.status(201).json({ user: { id: user.id, email: user.email, fullName: user.fullName, role: user.role, mustChangePassword: true } });
});

operationsRouter.delete('/admin/inputers/:id', requireAuth, requireRole(Role.ADMIN, Role.ADMINISTRATOR), requirePermission('inputers:deactivate'), async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  if (id === req.auth!.userId) return res.status(400).json({ error: 'You cannot deactivate your own account.' });
  const inputer = await prisma.user.findFirstOrThrow({ where: { id, role: Role.INPUTER, roleProfile: RoleProfile.TARGET, isActive: true } });
  await prisma.$transaction([
    prisma.user.update({ where: { id }, data: { isActive: false, deactivatedAt: new Date(), deactivatedById: req.auth!.userId, sessionVersion: { increment: 1 } } }),
    prisma.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } }),
    prisma.auditLog.create({ data: { actorId: req.auth!.userId, action: 'inputer_deactivated', entityType: 'User', entityId: id, metadata: { email: inputer.email }, ipAddress: req.ip } }),
  ]);
  return res.status(204).end();
});

operationsRouter.get('/admin/inputers', requireAuth, requireRole(Role.MANAGER, Role.ADMIN, Role.ADMINISTRATOR), async (_req, res) => {
  const users = await prisma.user.findMany({
    where: { role: Role.INPUTER, roleProfile: RoleProfile.TARGET, isActive: true },
    select: { id: true, email: true, fullName: true, role: true, isActive: true, twoFactorEnabled: true, mustChangePassword: true, createdAt: true },
    orderBy: { fullName: 'asc' },
  });
  return res.json({ users });
});

operationsRouter.get('/system/inputer-archive', requireAuth, requireRole(Role.ADMINISTRATOR), async (_req, res) => {
  const users = await prisma.user.findMany({
    where: { role: Role.INPUTER, roleProfile: RoleProfile.TARGET, isActive: false, deactivatedAt: { not: null } },
    select: { id: true, email: true, fullName: true, deactivatedAt: true, deactivatedById: true },
    orderBy: { deactivatedAt: 'desc' },
  });
  return res.json({ users });
});

operationsRouter.post('/system/inputer-archive/:id/restore', requireAuth, requireRole(Role.ADMINISTRATOR), async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const user = await prisma.user.findFirstOrThrow({ where: { id, role: Role.INPUTER, roleProfile: RoleProfile.TARGET, isActive: false, deactivatedAt: { not: null } } });
  const restored = await prisma.$transaction(async (tx) => {
    const account = await tx.user.update({ where: { id }, data: { isActive: true, deactivatedAt: null, deactivatedById: null } });
    await writeAudit({ actorId: req.auth!.userId, action: 'inputer_restored', entityType: 'User', entityId: id, metadata: { email: user.email }, ipAddress: req.ip }, tx);
    return account;
  });
  return res.json({ user: { id: restored.id, email: restored.email, fullName: restored.fullName, role: restored.role, isActive: restored.isActive } });
});

operationsRouter.patch('/system/users/:id/role', requireAuth, requireRole(Role.ADMINISTRATOR), async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const { role } = z.object({ role: z.enum([Role.INPUTER, Role.MANAGER, Role.ADMIN, Role.ADMINISTRATOR]) }).parse(req.body);
  if (id === req.auth!.userId) return res.status(400).json({ error: 'You cannot change your own role.' });
  const existing = await prisma.user.findUniqueOrThrow({ where: { id }, select: { role: true, roleProfile: true, email: true, mustChangePassword: true } });
  if (existing.roleProfile === RoleProfile.LEGACY && existing.role === Role.STUDENT) {
    return res.status(409).json({ error: 'Legacy STUDENT accounts can only be explicitly mapped to the STUDENT portal.' });
  }
  if (existing.roleProfile === RoleProfile.TARGET && existing.role === Role.ADMINISTRATOR && role !== Role.ADMINISTRATOR) {
    const administratorCount = await prisma.user.count({ where: { role: Role.ADMINISTRATOR, roleProfile: RoleProfile.TARGET, isActive: true } });
    if (administratorCount <= 1) return res.status(409).json({ error: 'The last active administrator cannot be demoted.' });
  }
  const updated = await prisma.$transaction(async (tx) => {
    const changed = await tx.user.update({
      where: { id },
      data: {
        role,
        roleProfile: RoleProfile.TARGET,
        mustChangePassword: existing.roleProfile === RoleProfile.TARGET ? existing.mustChangePassword : true,
        sessionVersion: { increment: 1 },
      },
    });
    await tx.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    await writeAudit({ actorId: req.auth!.userId, action: existing.roleProfile === RoleProfile.TARGET ? 'user_role_changed' : 'legacy_user_mapped', entityType: 'User', entityId: id, metadata: { email: existing.email, oldRole: existing.role, oldRoleProfile: existing.roleProfile, newRole: role, newRoleProfile: RoleProfile.TARGET }, ipAddress: req.ip }, tx);
    return changed;
  });
  return res.json({ user: { id: updated.id, email: updated.email, role: updated.role } });
});

export { EmailJobStatus, PaymentStatus };