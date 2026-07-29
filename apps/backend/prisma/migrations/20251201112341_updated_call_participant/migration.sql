/*
  Warnings:

  - You are about to drop the column `status` on the `call_participants` table. All the data in the column will be lost.
  - You are about to drop the `call_exceptions` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `call_invited_users` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `invitedBy` to the `call_participants` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "InvitationResponse" AS ENUM ('INVITED', 'ACCEPTED', 'DECLINED');

-- DropIndex
DROP INDEX "call_participants_status_idx";

-- AlterTable
ALTER TABLE "call_participants" DROP COLUMN "status",
ADD COLUMN     "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "invitedBy" TEXT NOT NULL,
ADD COLUMN     "respondedAt" TIMESTAMP(3),
ADD COLUMN     "response" "InvitationResponse";

-- DropTable
DROP TABLE "call_exceptions";

-- DropTable
DROP TABLE "call_invited_users";

-- DropEnum
DROP TYPE "CallExceptionType";

-- DropEnum
DROP TYPE "ParticipantStatus";

-- CreateIndex
CREATE INDEX "call_participants_response_idx" ON "call_participants"("response");
