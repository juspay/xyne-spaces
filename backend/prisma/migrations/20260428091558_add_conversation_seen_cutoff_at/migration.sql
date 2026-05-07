/*
  Warnings:

  - Added the required column `conversationSeenCutoffAt` to the `channel_user_status` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "public"."channel_user_status" ADD COLUMN     "conversationSeenCutoffAt" TIMESTAMP(3);
