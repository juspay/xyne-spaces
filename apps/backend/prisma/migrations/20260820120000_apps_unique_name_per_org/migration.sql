-- Enforce app-name uniqueness in the database.
--
-- createApp() checks for an existing name and then inserts, in two statements with nothing
-- holding the gap: at READ COMMITTED a SELECT matching zero rows takes no lock, so two
-- concurrent creates both see "no such app" and both insert. That is where the existing
-- duplicates come from.
--
-- Duplicates are RENAMED, not deleted. The schema runs relationMode = "prisma", so there are
-- no foreign keys on apps at all: a DELETE would not error, it would silently orphan the
-- installed_apps, app_commands and app_permissions rows pointing at it, with nothing to catch
-- it. Some duplicates are also legitimate -- the Slack importer created one apps row per
-- workspace until this release. Renaming loses nothing and leaves the merge to a human.
--
-- Deliberately NOT using CREATE INDEX CONCURRENTLY: a concurrent build cannot run inside a
-- transaction, and the renames below must commit atomically with the indexes or the
-- migration can half-apply. The apps table is small enough that the brief lock is fine.

-- 1. Rename duplicates within an org; oldest row per (orgId, lower(name)) keeps its name.
--    Partitioning on lower(name) also collapses case variants, matching the case-insensitive
--    rule createApp() applies.
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY "orgId", lower(name)
           ORDER BY "createdAt", id
         ) AS rn
  FROM "public"."apps"
)
UPDATE "public"."apps" a
SET name = a.name || ' (duplicate ' || r.rn || ')',
    "updatedAt" = now()
FROM ranked r
WHERE a.id = r.id
  AND r.rn > 1;

-- 2. Same treatment for GLOBAL-scope collisions, which span orgs and so survive step 1.
WITH ranked_global AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY lower(name)
           ORDER BY "createdAt", id
         ) AS rn
  FROM "public"."apps"
  WHERE scope = 'GLOBAL'
)
UPDATE "public"."apps" a
SET name = a.name || ' (global duplicate ' || r.rn || ')',
    "updatedAt" = now()
FROM ranked_global r
WHERE a.id = r.id
  AND r.rn > 1;

-- 3. One app name per owning org. Mirrors @@unique([orgId, name]) in schema.prisma.
CREATE UNIQUE INDEX "apps_orgId_name_key"
  ON "public"."apps" ("orgId", name);

-- 4. One global app name across all orgs. Makes promoteApp()'s name check atomic instead of
--    a read-then-write. Prisma has no partial-unique syntax, so this index exists only here --
--    expect `prisma migrate dev` to report it as drift, and do not let it generate a DROP.
CREATE UNIQUE INDEX "apps_global_name_key"
  ON "public"."apps" (lower(name))
  WHERE scope = 'GLOBAL';
