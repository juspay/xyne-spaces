-- CreateEnum
CREATE TYPE "public"."CalendarVisibility" AS ENUM ('PUBLIC', 'PRIVATE');

-- AlterTable
ALTER TABLE "public"."users"
ADD COLUMN "calendarVisibility" "public"."CalendarVisibility" NOT NULL DEFAULT 'PUBLIC';
