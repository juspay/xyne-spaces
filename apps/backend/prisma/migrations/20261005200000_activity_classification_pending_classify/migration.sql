-- New activities wait for the classifier as PENDING_CLASSIFY. Existing rows keep their value:
-- legacy PENDING rows, written while the classifier was off, are never picked up.
ALTER TABLE "public"."activities" ALTER COLUMN "classification" SET DEFAULT 'PENDING_CLASSIFY';
