/**
 * The table is generated. This re-derives it from the installed `jsonata` and
 * fails if they have parted company, so an upgrade cannot leave it stale — and
 * so nobody is tempted to hand-edit it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import jsonata from 'jsonata';
import { BUILTIN_SIGNATURES, builtinSignature, isBuiltin } from './signatures.js';

/** Where the installed package actually is, to read its registrations. */
const source = createRequire(import.meta.url).resolve('jsonata');

async function derive(): Promise<Record<string, string>> {
  const names = [
    ...new Set(
      [...readFileSync(source, 'utf8').matchAll(/staticFrame\.bind\('([^']+)'/g)].map((m) => m[1]!),
    ),
  ].sort();
  const out: Record<string, string> = {};
  for (const name of names) {
    const value = (await jsonata(`$${name}`).evaluate({})) as
      | { _jsonata_function?: boolean; signature?: { definition?: string } }
      | undefined;
    if (value?._jsonata_function) out[name] = value.signature?.definition ?? '';
  }
  return out;
}

describe('the generated builtin table', () => {
  it('matches what the installed jsonata declares', async () => {
    expect(BUILTIN_SIGNATURES).toEqual(await derive());
  });

  it('covers every name jsonata binds', async () => {
    const derived = Object.keys(await derive());
    expect(derived.length).toBeGreaterThan(50);
    expect(Object.keys(BUILTIN_SIGNATURES).sort()).toEqual(derived.sort());
  });

  it('answers with or without the sigil', () => {
    expect(isBuiltin('sum')).toBe(true);
    expect(isBuiltin('$sum')).toBe(true);
    expect(builtinSignature('$sum')).toBe('<a<n>:n>');
    expect(isBuiltin('$summ')).toBe(false);
    expect(builtinSignature('$nope')).toBeUndefined();
  });
});
