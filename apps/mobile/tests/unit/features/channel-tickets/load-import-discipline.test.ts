import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

/**
 * `load.ts` and `gate.ts` are the only channel-tickets files imported eagerly by
 * route / Info screens. If either grows a static import into `components/`,
 * `hooks/` or `utils/`, the whole table lands on the Info screen's graph and the
 * load-on-Info guarantee silently regresses. Assert on the source text so the
 * discipline is enforced without bundling.
 */
const FEATURE_DIR = resolve(process.cwd(), 'src/features/channel-tickets');
const STATIC_IMPORT = /^\s*import\s[^;]*?from\s+['"]([^'"]+)['"]/gm;

function staticImportsOf(file: string): string[] {
  const source = readFileSync(resolve(FEATURE_DIR, file), 'utf8');
  return Array.from(source.matchAll(STATIC_IMPORT), match => match[1] ?? '');
}

const FORBIDDEN_PREFIXES = ['./components', './hooks', './utils', '../components', '../hooks'];

describe('channel-tickets eager entry points', () => {
  it('load.ts has no static import into components/, hooks/ or utils/', () => {
    const offenders = staticImportsOf('load.ts').filter(specifier =>
      FORBIDDEN_PREFIXES.some(prefix => specifier.startsWith(prefix)),
    );
    assert.deepEqual(offenders, []);
  });

  it('load.ts reaches the screen only through a dynamic import', () => {
    const source = readFileSync(resolve(FEATURE_DIR, 'load.ts'), 'utf8');
    assert.match(source, /import\(\s*['"]\.\/components\/channel-tickets-screen['"]\s*\)/);
  });

  it('gate.ts imports nothing from the feature', () => {
    const local = staticImportsOf('gate.ts').filter(specifier => specifier.startsWith('.'));
    assert.deepEqual(local, []);
  });

  it('query-args.ts stays React-free (shared by warm-up and data hook)', () => {
    const specifiers = staticImportsOf('query-args.ts');
    assert.equal(
      specifiers.some(specifier => specifier === 'react' || specifier === 'react-native'),
      false,
    );
  });
});
