/**
 * Catalog coverage for the v1 SDK surface.
 *
 * Every Zero query and mutator must be accounted for: either an SDK operation
 * maps to it (`mapper.ts`) or `exclusions.json` says why none does. A new catalog
 * operation therefore fails here until someone decides, and a removed one fails
 * here instead of in a caller's hands at runtime.
 */

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { V1_MAPPER } from './mapper';
import exclusionsFile from './exclusions.json';

interface Exclusion {
  readonly name: string;
  readonly kind?: 'query' | 'mutator';
  readonly reason: string;
  readonly note?: string;
}

const SHARED_ZERO = path.resolve(__dirname, '../../../../../../packages/shared/src/zero');

/**
 * The catalog's operation names, read from the shared package's source.
 *
 * In a child process because the catalog is built on `@rocicorp/zero`, which is
 * ESM-only and cannot be loaded into jest's CommonJS runtime; `tsx` runs the
 * TypeScript source as it is in the tree, rather than as last built. Mutator
 * names come out as the mapper writes them: `namespace.key`, or a bare
 * top-level name. Zero hangs its own metadata off both objects under `~`.
 */
function readCatalog(): { query: Set<string>; mutator: Set<string> } {
  const script = `
    const { queries } = await import(${JSON.stringify(path.join(SHARED_ZERO, 'queries.ts'))});
    const { mutators } = await import(${JSON.stringify(path.join(SHARED_ZERO, 'mutators.ts'))});
    const META = '~';
    const query = Object.keys(queries).filter((name) => name !== META);
    const mutator = [];
    for (const [namespace, value] of Object.entries(mutators)) {
      if (namespace === META) continue;
      if (typeof value === 'function') { mutator.push(namespace); continue; }
      for (const key of Object.keys(value)) if (key !== META) mutator.push(namespace + '.' + key);
    }
    process.stdout.write(JSON.stringify({ query, mutator }));
  `;
  const out = execFileSync(
    process.execPath,
    [require.resolve('tsx/cli'), '--input-type=module', '-e', script],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
  );
  const parsed = JSON.parse(out) as { query: string[]; mutator: string[] };
  return { query: new Set(parsed.query), mutator: new Set(parsed.mutator) };
}

const catalog = readCatalog();
const exclusions = (exclusionsFile as { exclusions: Exclusion[] }).exclusions;

const mapped = { query: new Set<string>(), mutator: new Set<string>() };
for (const target of Object.values(V1_MAPPER)) {
  if (target.kind === 'query' || target.kind === 'mutator') mapped[target.kind].add(target.name);
}

function isMapped(name: string): boolean {
  return mapped.query.has(name) || mapped.mutator.has(name);
}

describe('v1 catalog coverage', () => {
  it('reads a non-empty catalog', () => {
    expect(catalog.query.size).toBeGreaterThan(0);
    expect(catalog.mutator.size).toBeGreaterThan(0);
  });

  it('maps or excludes every catalog operation', () => {
    const excluded = new Set(exclusions.map((e) => e.name));
    const unhandled = [...catalog.query, ...catalog.mutator].filter(
      (name) => !isMapped(name) && !excluded.has(name),
    );
    expect(unhandled).toEqual([]);
  });

  it('maps only to operations that exist', () => {
    const dangling = Object.entries(V1_MAPPER)
      .filter(([, target]) =>
        (target.kind === 'query' || target.kind === 'mutator') && !catalog[target.kind].has(target.name),
      )
      .map(([id, target]) => `${id} -> ${'name' in target ? target.name : ''}`);
    expect(dangling).toEqual([]);
  });

  it('excludes only operations that exist, under their own kind', () => {
    const stale = exclusions
      .filter((e) => !(e.kind && catalog[e.kind].has(e.name)))
      .map((e) => `${e.name} (${e.kind ?? 'no kind'})`);
    expect(stale).toEqual([]);
  });

  it('never both maps and excludes an operation', () => {
    expect(exclusions.filter((e) => isMapped(e.name)).map((e) => e.name)).toEqual([]);
  });

  it('lists each exclusion once', () => {
    const seen = new Set<string>();
    const duplicates = exclusions.filter((e) => seen.has(e.name) || !seen.add(e.name));
    expect(duplicates.map((e) => e.name)).toEqual([]);
  });

  it('points every superseded-by at a mapped operation', () => {
    const PREFIX = 'superseded-by:';
    const broken = exclusions
      .filter((e) => e.reason.startsWith(PREFIX) && !isMapped(e.reason.slice(PREFIX.length)))
      .map((e) => `${e.name} -> ${e.reason}`);
    expect(broken).toEqual([]);
  });

  it('gives every retired id a reason', () => {
    const silent = Object.entries(V1_MAPPER)
      .filter(([, target]) => target.kind === 'retired' && !target.reason.trim())
      .map(([id]) => id);
    expect(silent).toEqual([]);
  });
});
