import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

/**
 * Every place that writes a Call row must decide its end-to-end encryption state
 * (`metadata.e2ee`) as it does so, or be listed here with the reason it does not.
 * Joins only read the state back, so a creator that skips it produces calls that
 * silently run unencrypted; scheduled, recurring and automation calls once did.
 */
const UNENCRYPTED_CREATORS: Record<string, string> = {
  'database/repositories/noteTakerCallRepository.ts':
    'HEADLESS recordings: the recorder and the agent are their only participants, and neither holds a key.',
  'controllers/testAuthSeeder.ts': 'Local-login seed data; no LiveKit room ever exists for these rows.',
};

const SRC_ROOT = join(__dirname, '..', '..');
const CREATE_CALL = /\.(call\.create|calls\.insert)\(\{/g;
/** How far above a create to look for the state being prepared, when it is not inline. */
const CONTEXT_LINES_ABOVE = 20;

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'generated' ? [] : sourceFiles(path);
    return path.endsWith('.ts') && !path.endsWith('.test.ts') ? [path] : [];
  });

interface CreateSite {
  file: string;
  line: number;
  stampsEncryption: boolean;
}

const findCreateSites = (): CreateSite[] =>
  sourceFiles(SRC_ROOT).flatMap((path) => {
    const source = readFileSync(path, 'utf8');
    return [...source.matchAll(CREATE_CALL)].map((match) => {
      const start = match.index ?? 0;
      const line = source.slice(0, start).split('\n').length;
      const windowStart = source.split('\n').slice(0, Math.max(0, line - 1 - CONTEXT_LINES_ABOVE)).join('\n').length;
      const end = source.indexOf('});', start);
      const window = source.slice(windowStart, end === -1 ? undefined : end);
      return { file: relative(SRC_ROOT, path), line, stampsEncryption: /\be2ee\b/.test(window) };
    });
  });

describe('every Call creator decides encryption', () => {
  const sites = findCreateSites();

  it('finds the known creators', () => {
    const files = new Set(sites.map((s) => s.file));
    expect(files).toContain('database/repositories/callRepository.ts');
    expect(files).toContain('bypassAcl/transactions/callRepository.ts');
    expect(files).toContain('zero/mutators.ts');
    expect(sites.length).toBeGreaterThanOrEqual(6);
  });

  it.each(sites.map((s) => [`${s.file}:${s.line}`, s] as const))(
    '%s stamps metadata.e2ee or is listed as intentionally unencrypted',
    (_label, site) => {
      expect(site.stampsEncryption || site.file in UNENCRYPTED_CREATORS).toBe(true);
    },
  );

  it('lists no creator that has started stamping encryption', () => {
    for (const file of Object.keys(UNENCRYPTED_CREATORS)) {
      const own = sites.filter((s) => s.file === file);
      expect(own.length).toBeGreaterThan(0);
      expect(own.some((s) => !s.stampsEncryption)).toBe(true);
    }
  });
});
