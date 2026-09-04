-- `summary` becomes optional. DEFAULT '' stays, so a writer that omits the column still gets
-- an empty string; dropping NOT NULL only allows a writer that passes NULL explicitly — Zero
-- mutators and raw SQL among them. Reads normalise NULL to '' in toEntry, so app code keeps a
-- plain string.
ALTER TABLE "non_zero"."thread_type_vocabulary" ALTER COLUMN "summary" DROP NOT NULL;

-- ThreadTypeVocabulary.updatedAt also drops Prisma's `@updatedAt` in this change. That is a
-- client-side attribute with no DDL: the column stays "updatedAt" TIMESTAMP(3) NOT NULL and
-- every writer now stamps it itself.
