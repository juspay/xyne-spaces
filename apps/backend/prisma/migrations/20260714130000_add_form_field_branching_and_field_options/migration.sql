-- AlterTable
ALTER TABLE "public"."form_fields" ADD COLUMN "parentOptionId" TEXT;

-- AlterTable
ALTER TABLE "public"."global_fields" ADD COLUMN "fieldOptions" TEXT;
ALTER TABLE "public"."form_fields" ADD COLUMN "fieldOptions" TEXT;

-- CreateIndex
CREATE INDEX CONCURRENTLY IF NOT EXISTS "form_fields_parentOptionId_idx" ON "public"."form_fields"("parentOptionId");
