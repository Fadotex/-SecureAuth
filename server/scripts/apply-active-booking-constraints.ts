import { prisma } from '../src/v1/db.js';

async function main() {
  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "Booking_one_active_bed_per_semester"
    ON "Booking" ("bedId", "semesterId")
    WHERE "status" IN ('HELD', 'CONFIRMED', 'CHECKED_IN')
  `);
  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "Booking_one_active_semester_per_student"
    ON "Booking" ("studentId", "semesterId")
    WHERE "status" IN ('HELD', 'CONFIRMED', 'CHECKED_IN')
  `);
  console.info('Active booking constraints applied.');
}

main().catch((error) => {
  console.error('Could not apply active booking constraints:', error);
  process.exitCode = 1;
}).finally(async () => prisma.$disconnect());