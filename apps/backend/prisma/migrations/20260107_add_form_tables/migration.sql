-- CreateEnum
CREATE TYPE "FormFieldType" AS ENUM ('STRING', 'NUMBER', 'BOOLEAN', 'DATE', 'ENUM');

-- CreateEnum
CREATE TYPE "FormContextType" AS ENUM ('BOARD');

-- CreateEnum
CREATE TYPE "FormEntityType" AS ENUM ('TICKET');

-- CreateTable
CREATE TABLE "forms" (
    "id" TEXT NOT NULL,
    "formName" TEXT NOT NULL,
    "formDescription" TEXT,
    "entityType" "FormEntityType" NOT NULL,
    "contextType" "FormContextType" NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "forms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "forms_context_mapping" (
    "id" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "contextId" TEXT NOT NULL,
    "contextType" "FormContextType" NOT NULL,
    "entityType" "FormEntityType" NOT NULL,

    CONSTRAINT "forms_context_mapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "form_fields" (
    "id" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "fieldName" TEXT NOT NULL,
    "fieldType" "FormFieldType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "form_fields_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "form_entity_values" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "fieldId" TEXT NOT NULL,
    "fieldValue" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "form_entity_values_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "forms_createdBy_idx" ON "forms"("createdBy");

-- CreateIndex
CREATE INDEX "forms_entityType_contextType_idx" ON "forms"("entityType", "contextType");

-- CreateIndex
CREATE UNIQUE INDEX "forms_context_mapping_contextId_contextType_formId_key" ON "forms_context_mapping"("contextId", "contextType", "formId");

-- CreateIndex
CREATE UNIQUE INDEX "forms_context_mapping_contextId_entityType_key" ON "forms_context_mapping"("contextId", "entityType");

-- CreateIndex
CREATE INDEX "forms_context_mapping_contextId_contextType_idx" ON "forms_context_mapping"("contextId", "contextType");

-- CreateIndex
CREATE UNIQUE INDEX "form_fields_formId_fieldName_key" ON "form_fields"("formId", "fieldName");

-- CreateIndex
CREATE INDEX "form_fields_formId_idx" ON "form_fields"("formId");

-- CreateIndex
CREATE INDEX "form_entity_values_entityId_entityType_idx" ON "form_entity_values"("entityId", "entityType");

-- CreateIndex
CREATE INDEX "form_entity_values_fieldId_idx" ON "form_entity_values"("fieldId");

-- CreateIndex
CREATE UNIQUE INDEX "form_entity_values_entityId_entityType_fieldId_key" ON "form_entity_values"("entityId", "entityType", "fieldId");
