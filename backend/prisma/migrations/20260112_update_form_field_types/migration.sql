-- Add new enum values to FormFieldType
ALTER TYPE "FormFieldType" ADD VALUE 'SINGLE_SELECT';
ALTER TYPE "FormFieldType" ADD VALUE 'MULTI_SELECT';
ALTER TYPE "FormFieldType" ADD VALUE 'USER';

-- Add columns to form_fields
ALTER TABLE "form_fields" ADD COLUMN "fieldEnum" JSONB;
ALTER TABLE "form_fields" ADD COLUMN "isOptional" BOOLEAN NOT NULL DEFAULT false;

-- Add actualFieldValue column for JSON storage (fieldValue remains as String for backward compatibility)
ALTER TABLE "form_entity_values" ADD COLUMN "actualFieldValue" JSONB;
