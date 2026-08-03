import * as fs from 'fs';
import * as path from 'path';

/**
 * CI backstop for XYNE-55063.
 *
 * These backfill / migration endpoints mutate production data in bulk. Every one
 * of them must be admin-gated. Historically the gate was applied "by convention"
 * in each route file, which drifted — some routes shipped authenticated-only or
 * fully open. This test fails the build the moment a `*Backfill.ts` route file
 * lacks an admin authorization, so a new backfill cannot regress the boundary.
 *
 * Accepted admin-authorization signals in a route file:
 *   - `backfillAdminAuth`                      (shared TICKET-MIGRATION ADMIN guard)
 *   - `authorize('<RESOURCE>', AccessType.ADMIN)`
 *   - the Vespa exception: `authorize('VESPA', AccessType.WRITE)` / `requireVespaAccess`
 *     (WRITE on the VESPA resource is that subsystem's admin-equivalent)
 */
const ROUTES_DIR = path.join(__dirname, '..', '..', 'routes');

const ADMIN_AUTH_SIGNAL =
  /backfillAdminAuth|requireVespaAccess|authorize\s*\([\s\S]*?AccessType\.(ADMIN|WRITE)/;

function listBackfillRouteFiles(): string[] {
  return fs
    .readdirSync(ROUTES_DIR)
    .filter((f) => /Backfill\.ts$/.test(f))
    .map((f) => path.join(ROUTES_DIR, f));
}

describe('backfill/migration route guard coverage (XYNE-55063)', () => {
  const files = listBackfillRouteFiles();

  it('discovers the backfill route files to check', () => {
    // Guard against the glob silently matching nothing (which would make the
    // per-file assertions vacuously pass).
    expect(files.length).toBeGreaterThan(10);
  });

  it.each(listBackfillRouteFiles().map((f) => [path.basename(f), f]))(
    '%s enforces an admin authorization',
    (_name, file) => {
      const src = fs.readFileSync(file, 'utf8');
      expect(src).toMatch(ADMIN_AUTH_SIGNAL);
    },
  );

  it('every SELF_GUARDED_BACKFILLS entry maps to a real route file with its own authorize', () => {
    // Parse the declared exception list straight from the middleware source so
    // this test stays static (no app/config boot) while still validating that
    // each self-guarded backfill exists and carries its own admin authorize.
    const middlewareSrc = fs.readFileSync(
      path.join(__dirname, '..', 'backfillAdminAuth.ts'),
      'utf8',
    );
    const block = middlewareSrc.match(/SELF_GUARDED_BACKFILLS[\s\S]*?\]\)/);
    expect(block).not.toBeNull();
    const names = Array.from(
      (block as RegExpMatchArray)[0].matchAll(/['"]([a-z-]+-backfill)['"]/g),
    ).map((m) => m[1]);
    expect(names.length).toBeGreaterThan(0);

    for (const name of names) {
      // 'vespa-backfill' -> 'vespaBackfill.ts'
      const camel = name.replace(/-([a-z])/g, (_m, c) => c.toUpperCase());
      const file = path.join(ROUTES_DIR, `${camel}.ts`);
      expect(fs.existsSync(file)).toBe(true);
      expect(fs.readFileSync(file, 'utf8')).toMatch(ADMIN_AUTH_SIGNAL);
    }
  });

  it('app.ts registers the mount-layer default guard for admin backfill paths', () => {
    const appSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'app.ts'), 'utf8');
    expect(appSrc).toMatch(/backfillMountGuard/);
    expect(appSrc).toMatch(/this\.app\.use\(\s*['"]\/api\/admin['"]\s*,\s*backfillMountGuard\s*\)/);
    expect(appSrc).toMatch(
      /this\.app\.use\(\s*['"]\/migrate\/api\/admin['"]\s*,\s*backfillMountGuard\s*\)/,
    );
  });
});
