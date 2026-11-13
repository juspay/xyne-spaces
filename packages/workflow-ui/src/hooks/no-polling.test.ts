import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    if (!/\.(ts|tsx)$/.test(entry) || /\.test\.tsx?$/.test(entry)) return [];
    return [path];
  });
}

/** Strip comments, so prose *about* the old polling does not trip the guard. */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe('reads are event-driven, not polled', () => {
  const files = sourceFiles(SRC).map((path) => ({
    path: path.slice(SRC.length + 1),
    source: code(readFileSync(path, 'utf8')),
  }));

  it('starts no timers', () => {
    // `setTimeout` is fine — debouncing and one-shot delays are not polling.
    // A repeating clock is what this forbids.
    const offenders = files
      .filter(({ source }) => /\bsetInterval\s*\(/.test(source))
      .map(({ path }) => path);

    expect(offenders).toEqual([]);
  });

  it("does not ask React Query to poll either", () => {
    // `refetchInterval` is the same thing wearing a nicer API.
    const offenders = files
      .filter(({ source }) => /refetchInterval/.test(source))
      .map(({ path }) => path);

    expect(offenders).toEqual([]);
  });

  it('pages by cursor, never by offset', () => {
    // Scoped to PAGING offsets — an `offset` beside a `limit`. The word has
    // honest unrelated uses here (a text anchor, a trigger's start delay).
    const offenders = files
      .filter(({ source }) =>
        /\blimit\s*:[^}]{0,120}\boffset\s*:/s.test(source) ||
        /\boffset\s*:[^}]{0,120}\blimit\s*:/s.test(source),
      )
      .map(({ path }) => path);

    expect(offenders).toEqual([]);
  });
});
