-- The formContextMappings relationship correlates on formId; without this
-- index every related() lookup full-scans the table (28M rows scanned per
-- getFormsByContextType hydration, 40M per getAllForms).
-- Apply on prod with CREATE INDEX CONCURRENTLY before deploying.
CREATE INDEX IF NOT EXISTS "forms_context_mapping_formId_idx" ON "forms_context_mapping"("formId");
