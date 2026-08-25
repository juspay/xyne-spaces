-- Platform agents (scope='platform') belong to no tenant org. orgId becomes
-- nullable; NULL is the platform scope. Runtime org context for platform-agent
-- runs is resolved from the caller's org at dispatch (routes/run.ts).
-- @@unique([orgId, slug]) is unchanged: Postgres treats NULLs as distinct, so
-- tenant slug uniqueness is preserved and platform slugs are guarded at the
-- app level (only the seed script writes scope='platform' rows).

ALTER TABLE "agents" ALTER COLUMN "orgId" DROP NOT NULL;

UPDATE "agents" SET "orgId" = NULL WHERE scope = 'platform';
