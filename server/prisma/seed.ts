import 'dotenv/config';
import { BookingStatus, PaymentNetwork, PaymentSource, PaymentStatus, PrismaClient, Role, SemesterStatus } from '@prisma/client';
import { hashPassword } from '../src/v1/services/password.js';

const prisma = new PrismaClient();

async function ensureAccount(email: string | undefined, password: string | undefined, role: Role, fullName: string) {
  if (!email || !password) return null;
  const normalized = email.trim().toLowerCase();
  return prisma.user.upsert({
    where: { email: normalized },
    update: {},
    create: {
      email: normalized,
      fullName,
      role,
      passwordHash: await hashPassword(password),
      emailVerifiedAt: new Date(),
      mustChangePassword: role === Role.STAFF,
      permissions: role === Role.STAFF ? ['students:read', 'payments:manual', 'residents:check-in', 'maintenance:manage', 'visitors:manage', 'notices:read', 'room-changes:manage'] : [],
    },
  });
}

async function main() {
  await ensureAccount(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD, Role.ADMIN, 'Hostel Administrator');
  await ensureAccount(process.env.STAFF_EMAIL, process.env.STAFF_PASSWORD, Role.STAFF, 'Hostel Secretary');

  const semester = await prisma.semester.upsert({
    where: { name: '2026/2027 First Semester' },
    update: {},
    create: {
      name: '2026/2027 First Semester',
      startsAt: new Date('2026-09-01T00:00:00.000Z'),
      endsAt: new Date('2027-01-31T23:59:59.000Z'),
      status: SemesterStatus.ACTIVE,
      depositBps: 5000,
      balanceDueAt: new Date('2026-12-15T23:59:59.000Z'),
    },
  });
  await prisma.semester.updateMany({ where: { id: { not: semester.id }, status: SemesterStatus.ACTIVE }, data: { status: SemesterStatus.UPCOMING } });

  const hostel = await prisma.hostel.findFirst({ where: { name: 'Secure Residence' } })
    || await prisma.hostel.create({ data: { name: 'Secure Residence', address: process.env.HOSTEL_ADDRESS || 'Campus, Ghana' } });
  const maleBlock = await prisma.block.upsert({ where: { hostelId_name: { hostelId: hostel.id, name: 'North Block' } }, update: {}, create: { hostelId: hostel.id, name: 'North Block', gender: 'MALE' } });
  const femaleBlock = await prisma.block.upsert({ where: { hostelId_name: { hostelId: hostel.id, name: 'South Block' } }, update: {}, create: { hostelId: hostel.id, name: 'South Block', gender: 'FEMALE' } });
  const maleFloor = await prisma.floor.upsert({ where: { blockId_name: { blockId: maleBlock.id, name: 'Ground Floor' } }, update: {}, create: { blockId: maleBlock.id, name: 'Ground Floor', sortOrder: 0 } });
  const femaleFloor = await prisma.floor.upsert({ where: { blockId_name: { blockId: femaleBlock.id, name: 'Ground Floor' } }, update: {}, create: { blockId: femaleBlock.id, name: 'Ground Floor', sortOrder: 0 } });

  const roomTypes = [
    { name: '1 in a room', capacity: 1, pricePesewas: 2_000_000 },
    { name: '2 in a room', capacity: 2, pricePesewas: 1_000_000 },
    { name: '4 in a room', capacity: 4, pricePesewas: 300_000 },
    { name: '8 in a room', capacity: 8, pricePesewas: 200_000 },
  ];
  const seededRooms: Array<{ id: string; floorId: string; roomNumber: string; roomTypeId: string; priceId: string; capacity: number }> = [];

  for (const typeInput of roomTypes) {
    const type = await prisma.roomType.upsert({ where: { name: typeInput.name }, update: { capacity: typeInput.capacity }, create: { name: typeInput.name, capacity: typeInput.capacity } });
    const price = await prisma.roomTypePrice.upsert({
      where: { roomTypeId_semesterId: { roomTypeId: type.id, semesterId: semester.id } },
      update: { pricePesewas: typeInput.pricePesewas },
      create: { roomTypeId: type.id, semesterId: semester.id, pricePesewas: typeInput.pricePesewas },
    });
    for (const [index, floorId] of [maleFloor.id, femaleFloor.id].entries()) {
      const number = `${index === 0 ? '1' : '2'}${String(type.capacity).padStart(2, '0')}`;
      const room = await prisma.room.upsert({
        where: { floorId_roomNumber: { floorId, roomNumber: number } },
        update: { roomTypeId: type.id },
        create: { floorId, roomNumber: number, roomTypeId: type.id },
      });
      await prisma.bed.createMany({
        data: Array.from({ length: type.capacity }, (_, bedIndex) => ({ roomId: room.id, label: String(bedIndex + 1) })),
        skipDuplicates: true,
      });
      seededRooms.push({ id: room.id, floorId, roomNumber: number, roomTypeId: type.id, priceId: price.id, capacity: type.capacity });
    }
  }

  if (process.env.SEED_DEMO_DATA === 'true' && process.env.DEMO_STUDENT_PASSWORD) {
    const demos = [
      { studentId: 'DEMO-1001', fullName: 'Ama Owusu', email: 'ama.demo@hostel.local', gender: 'FEMALE' as const, roomCapacity: 4, paymentFraction: 1 },
      { studentId: 'DEMO-1002', fullName: 'Kofi Mensah', email: 'kofi.demo@hostel.local', gender: 'MALE' as const, roomCapacity: 2, paymentFraction: 0.5 },
      { studentId: 'DEMO-1003', fullName: 'Esi Boateng', email: 'esi.demo@hostel.local', gender: 'FEMALE' as const, roomCapacity: 8, paymentFraction: 0 },
    ];
    for (const [index, demo] of demos.entries()) {
      const user = await prisma.user.upsert({
        where: { email: demo.email },
        update: {},
        create: { email: demo.email, fullName: demo.fullName, phone: `024000000${index}`, role: Role.STUDENT, passwordHash: await hashPassword(process.env.DEMO_STUDENT_PASSWORD), emailVerifiedAt: new Date() },
      });
      const profile = await prisma.studentProfile.upsert({
        where: { userId: user.id },
        update: {},
        create: { userId: user.id, studentId: demo.studentId, gender: demo.gender, guardianName: 'Demo Guardian', guardianPhone: '02400000000', consentAt: new Date() },
      });
      const room = seededRooms.find((entry) => entry.capacity === demo.roomCapacity && entry.floorId === (demo.gender === 'MALE' ? maleFloor.id : femaleFloor.id));
      if (!room) continue;
      const bed = await prisma.bed.findFirst({ where: { roomId: room.id }, orderBy: { label: 'asc' } });
      if (!bed) continue;
      const booking = await prisma.booking.upsert({
        where: { id: `${profile.id.slice(0, 8)}-0000-4000-8000-${String(index + 1).padStart(12, '0')}` },
        update: {},
        create: {
          id: `${profile.id.slice(0, 8)}-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
          studentId: profile.id,
          semesterId: semester.id,
          roomId: room.id,
          bedId: bed.id,
          priceId: room.priceId,
          pricePesewas: roomTypes.find((type) => type.capacity === demo.roomCapacity)!.pricePesewas,
          status: BookingStatus.CONFIRMED,
          confirmedAt: new Date(),
        },
      });
      const amount = Math.floor(booking.pricePesewas * demo.paymentFraction);
      if (amount > 0) {
        await prisma.payment.upsert({
          where: { idempotencyKey: `seed-demo-${demo.studentId}` },
          update: {},
          create: {
            studentId: profile.id,
            semesterId: semester.id,
            bookingId: booking.id,
            amountPesewas: amount,
            feePesewas: 0,
            netPesewas: amount,
            network: index === 0 ? PaymentNetwork.MTN_MOMO : PaymentNetwork.TELECEL_CASH,
            source: PaymentSource.MANUAL_MOMO,
            status: PaymentStatus.SUCCESS,
            momoReference: `DEMO-${demo.studentId}`,
            idempotencyKey: `seed-demo-${demo.studentId}`,
            receiptNumber: `DEMO-${demo.studentId}`,
            verifiedAt: new Date(),
          },
        });
      }
    }
  }

  console.info(`Seed complete: ${seededRooms.length} rooms across four room types; demo students ${process.env.SEED_DEMO_DATA === 'true' ? 'processed' : 'skipped'}.`);
}

main().catch((error) => {
  console.error('Seed failed:', error);
  process.exitCode = 1;
}).finally(async () => prisma.$disconnect());