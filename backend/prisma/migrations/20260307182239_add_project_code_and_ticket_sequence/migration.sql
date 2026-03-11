-- AlterTable
ALTER TABLE "public"."projects" ADD COLUMN     "code" TEXT NOT NULL DEFAULT 'XYNE',
ADD COLUMN     "ticketSequence" INTEGER NOT NULL DEFAULT 0;



/*
  Warnings:
  - ############# NOTE : to be runned post ticket migration API

  - A unique constraint covering the columns `[code]` on the table `projects` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "public"."projects" ALTER COLUMN "code" DROP DEFAULT;

-- CreateIndex
CREATE UNIQUE INDEX "projects_code_key" ON "public"."projects"("code");
