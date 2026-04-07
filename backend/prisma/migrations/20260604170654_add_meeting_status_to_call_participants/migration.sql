-- CreateEnum
CREATE TYPE "public"."MeetingStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'MAYBE');

-- AlterTable
ALTER TABLE "public"."call_participants"
ADD COLUMN "meetingStatus" "public"."MeetingStatus" NOT NULL DEFAULT 'PENDING';