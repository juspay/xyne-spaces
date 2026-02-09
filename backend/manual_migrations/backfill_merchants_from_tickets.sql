-- Manual Migration: Backfill merchants table from existing ticket merchantIds
-- This should be run AFTER the schema migration 20260206104842_add_ticket_merchant_relation
-- Run this manually when ready to populate the merchants table

-- Backfill merchants table from existing ticket merchantIds
INSERT INTO "merchants" ("id", "mid")
SELECT 
  gen_random_uuid()::text,
  t."merchantId"
FROM (
  SELECT DISTINCT "merchantId"
  FROM "tickets" 
  WHERE "merchantId" IS NOT NULL 
    AND "merchantId" != ''
    AND "merchantId" NOT IN (SELECT "mid" FROM "merchants")
) t
ON CONFLICT ("mid") DO NOTHING;
