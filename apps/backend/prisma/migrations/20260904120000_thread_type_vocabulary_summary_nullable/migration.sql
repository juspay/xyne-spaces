-- `summary` loses its database default. The column stays NOT NULL, so every writer has to send
-- a value: the Prisma model drops @default("") alongside this, which makes the field required
-- at the type level instead of silently filled. Callers of the API are unaffected — the request
-- schema still defaults an omitted summary to ''.
ALTER TABLE "non_zero"."thread_type_vocabulary" ALTER COLUMN "summary" DROP DEFAULT;

-- ThreadTypeVocabulary.updatedAt also drops Prisma's @updatedAt in this change. That is a
-- client-side attribute with no DDL: the column stays "updatedAt" TIMESTAMP(3) NOT NULL and
-- every writer stamps it itself.
