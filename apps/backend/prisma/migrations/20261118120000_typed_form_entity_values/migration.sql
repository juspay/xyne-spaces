-- AlterTable
ALTER TABLE "public"."form_entity_values" ADD COLUMN "textValue" TEXT,
ADD COLUMN "textHash" TEXT,
ADD COLUMN "numberValue" DOUBLE PRECISION,
ADD COLUMN "dateValue" TIMESTAMP(3),
ADD COLUMN "boolValue" BOOLEAN,
ADD COLUMN "plainValue" TEXT;

-- CreateTable
CREATE TABLE "public"."form_entity_value_items" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "valueId" TEXT NOT NULL,
    "item" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "form_entity_value_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "form_entity_value_items_valueId_item_key" ON "public"."form_entity_value_items"("valueId", "item");

-- CreateIndex
CREATE INDEX "form_entity_value_items_item_idx" ON "public"."form_entity_value_items"("item");

-- CreateIndex
CREATE INDEX CONCURRENTLY IF NOT EXISTS "form_entity_values_fieldId_textHash_idx" ON "public"."form_entity_values"("fieldId", "textHash");

-- CreateIndex
CREATE INDEX CONCURRENTLY IF NOT EXISTS "form_entity_values_fieldId_numberValue_idx" ON "public"."form_entity_values"("fieldId", "numberValue");

-- CreateIndex
CREATE INDEX CONCURRENTLY IF NOT EXISTS "form_entity_values_fieldId_dateValue_idx" ON "public"."form_entity_values"("fieldId", "dateValue");

-- CreateIndex
CREATE INDEX CONCURRENTLY IF NOT EXISTS "form_entity_values_fieldId_plainValue_idx" ON "public"."form_entity_values"("fieldId", "plainValue");
