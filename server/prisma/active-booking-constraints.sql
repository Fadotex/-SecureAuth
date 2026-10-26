CREATE UNIQUE INDEX IF NOT EXISTS "Booking_one_active_bed_per_semester"
ON "Booking" ("bedId", "semesterId")
WHERE "status" IN ('HELD', 'CONFIRMED', 'CHECKED_IN');

CREATE UNIQUE INDEX IF NOT EXISTS "Booking_one_active_semester_per_student"
ON "Booking" ("studentId", "semesterId")
WHERE "status" IN ('HELD', 'CONFIRMED', 'CHECKED_IN');