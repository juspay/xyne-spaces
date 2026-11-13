import { describe, it, expect } from 'vitest';
import { parseSignature, paramAt } from './signature.js';
import { BUILTIN_SIGNATURES } from './signatures.js';

describe('parseSignature', () => {
  it('reads what a list is a list of — the distinction this exists for', () => {
    expect(parseSignature('<a<n>:n>')).toEqual({
      params: [{ type: { array: 'number' }, optional: false, variadic: false, fromContext: false, isFunction: false }],
      returns: 'number',
    });
    expect(parseSignature('<a<s>s?:s>')?.params[0]?.type).toEqual({ array: 'string' });
    expect(parseSignature('<x-:a<s>>')?.returns).toEqual({ array: 'string' });
  });

  it('reads a bare list as a list of anything', () => {
    expect(parseSignature('<a:n>')?.params[0]?.type).toBe('array');
    expect(parseSignature('<af?:a>')?.returns).toBe('array');
  });

  it('reads the modifiers', () => {
    const round = parseSignature('<n-n?:n>');
    expect(round?.params).toEqual([
      { type: 'number', optional: false, variadic: false, fromContext: true, isFunction: false },
      { type: 'number', optional: true, variadic: false, fromContext: false, isFunction: false },
    ]);
    expect(parseSignature('<a+>')?.params[0]).toMatchObject({ type: 'array', variadic: true });
  });

  it('declines to describe what it cannot, rather than guessing', () => {
    // A union, a function, and "anything" are all unverifiable — and `unknown`
    // is a wildcard everywhere, so nothing is refused on their account.
    expect(parseSignature('<(nsb)-:n>')?.params[0]?.type).toBe('unknown');
    expect(parseSignature('<af>')?.params[1]?.type).toBe('unknown');
    expect(parseSignature('<x:x>')).toEqual({
      params: [{ type: 'unknown', optional: false, variadic: false, fromContext: false, isFunction: false }],
      returns: 'unknown',
    });
  });

  it('treats a missing return as unknown, not as an error', () => {
    expect(parseSignature('<af>')?.returns).toBe('unknown');
    expect(parseSignature('<a+>')?.returns).toBe('unknown');
  });

  it('is not fooled by a colon inside a nested function signature', () => {
    // `$match` is `<s-f<s:o>n?:a<o>>` — the inner `:` is not the separator.
    const match = parseSignature('<s-f<s:o>n?:a<o>>');
    expect(match?.params.map((p) => p.type)).toEqual(['string', 'unknown', 'number']);
    expect(match?.params[2]?.optional).toBe(true);
    expect(match?.returns).toEqual({ array: 'object' });
  });

  it('reads an empty parameter list', () => {
    expect(parseSignature('<:n>')).toEqual({ params: [], returns: 'number' });
  });

  it('returns null for what is not a signature', () => {
    for (const bad of ['', 'n:n', '<', '<@:n>', '<n:@>']) {
      expect(parseSignature(bad), bad).toBeNull();
    }
  });

  it('reads every signature JSONata actually declares', () => {
    // The guard that matters: if a signature in the table cannot be read, the
    // function silently loses its typing.
    for (const [name, definition] of Object.entries(BUILTIN_SIGNATURES)) {
      expect(parseSignature(definition), `$${name} ${definition}`).not.toBeNull();
    }
  });
});

describe('paramAt', () => {
  const round = parseSignature('<n-n?:n>')!;
  const zip = parseSignature('<a+>')!;

  it('gives the parameter at that position', () => {
    expect(paramAt(round, 0)?.type).toBe('number');
    expect(paramAt(round, 1)?.optional).toBe(true);
  });

  it('gives nothing past the end of a fixed signature', () => {
    expect(paramAt(round, 2)).toBeUndefined();
  });

  it('lets a variadic parameter govern everything after it', () => {
    for (const index of [0, 1, 5, 50]) expect(paramAt(zip, index)?.type).toBe('array');
  });
});
