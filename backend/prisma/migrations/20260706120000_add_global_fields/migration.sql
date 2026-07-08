-- Prisma models: GlobalField (new), FormFields (repurposed as per-form membership)
-- Field definitions now live in global_fields (project-scoped, unique per name + type).
-- form_fields becomes the per-form membership table pointing at a global field via
-- globalFieldId. Legacy (deployed) form_fields rows keep their own definition columns
-- (globalFieldId = null) and continue to resolve directly.

-- CreateTable
CREATE TABLE "public"."global_fields" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "fieldName" TEXT NOT NULL,
    "fieldType" "public"."FormFieldType" NOT NULL,
    "fieldEnum" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "global_fields_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "global_fields_projectId_idx" ON "public"."global_fields"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "global_fields_projectId_fieldName_fieldType_key" ON "public"."global_fields"("projectId", "fieldName", "fieldType");

-- AlterTable: add membership pointer + make legacy definition columns optional
ALTER TABLE "public"."form_fields" ADD COLUMN "globalFieldId" TEXT;
ALTER TABLE "public"."form_fields" ALTER COLUMN "fieldName" DROP NOT NULL;
ALTER TABLE "public"."form_fields" ALTER COLUMN "fieldType" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "form_fields_globalFieldId_idx" ON "public"."form_fields"("globalFieldId");

-- CreateIndex
CREATE UNIQUE INDEX "form_fields_formId_globalFieldId_key" ON "public"."form_fields"("formId", "globalFieldId");
