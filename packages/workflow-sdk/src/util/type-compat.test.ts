import { describe, it, expect } from 'vitest';
import { kindsCompatible, TYPE_KINDS, type TypeKind, kindOfJsonType } from './type-compat.js';
import { assignableToField, assignableToArgument, unify, sayType } from '../expression/types.js';

describe('kindsCompatible', () => {
  it('string is the universal sink — any source binds into a string target', () => {
    for (const source of TYPE_KINDS) {
      expect(kindsCompatible(source, 'string')).toBe(true);
    }
  });

  it('unknown is a wildcard on either side', () => {
    for (const k of TYPE_KINDS) {
      expect(kindsCompatible('unknown', k)).toBe(true);
      expect(kindsCompatible(k, 'unknown')).toBe(true);
    }
  });

  it('equal kinds are compatible', () => {
    for (const k of TYPE_KINDS) {
      expect(kindsCompatible(k, k)).toBe(true);
    }
  });

  it('scalar kinds are mutually compatible (number↔enum, etc.)', () => {
    const scalars: TypeKind[] = ['string', 'number', 'boolean', 'scalar'];
    for (const a of scalars) {
      for (const b of scalars) {
        expect(kindsCompatible(a, b)).toBe(true);
      }
    }
  });

  it('array/object only accept their own kind (plus string sink / unknown)', () => {
    expect(kindsCompatible('array', 'number')).toBe(false);
    expect(kindsCompatible('array', 'boolean')).toBe(false);
    expect(kindsCompatible('array', 'object')).toBe(false);
    expect(kindsCompatible('object', 'number')).toBe(false);
    expect(kindsCompatible('object', 'array')).toBe(false);
    expect(kindsCompatible('number', 'array')).toBe(false);
    expect(kindsCompatible('array', 'array')).toBe(true);
    expect(kindsCompatible('object', 'object')).toBe(true);
  });

  it('a list/object cannot be bound into a number or boolean field', () => {
    expect(kindsCompatible('array', 'number')).toBe(false);
    expect(kindsCompatible('object', 'boolean')).toBe(false);
  });
});

// ─── Expression types ───

describe('a field coerces, a function does not', () => {
  it('lets anything into a text field, because the runtime stringifies', () => {
    for (const from of ['number', 'boolean', 'object'] as const) {
      expect(assignableToField(from, 'string'), from).toBe(true);
    }
    // But a function parameter gets no such favour — this is `T0410` at runtime.
    expect(assignableToArgument('number', 'string')).toBe(false);
    expect(assignableToArgument('boolean', 'string')).toBe(false);
  });

  it('does not let text into a number field, unlike the loose ref rule', () => {
    // `kindsCompatible` says yes — scalar↔scalar — because a declared type may
    // be an enum or a date and it has never had enough information. A computed
    // result is known exactly, so there is nothing to be generous about.
    expect(kindsCompatible('string', 'number')).toBe(true);
    expect(assignableToField('string', 'number')).toBe(false);
  });

  it('compares lists by their elements', () => {
    expect(assignableToArgument({ array: 'number' }, { array: 'number' })).toBe(true);
    expect(assignableToArgument({ array: 'string' }, { array: 'number' })).toBe(false);
    expect(assignableToArgument({ array: 'number' }, 'number')).toBe(false);
  });

  it('takes one value where a list is wanted, because JSONata wraps it', () => {
    // `$sum(5)` is 5 and `$reverse(5)` is `[5]` — measured, not assumed.
    expect(assignableToArgument('number', { array: 'number' })).toBe(true);
    // Only the element type is enforced: `$sum("x")` is still a T0412.
    expect(assignableToArgument('string', { array: 'number' })).toBe(false);
  });

  it('treats unknown as compatible at every depth', () => {
    expect(assignableToArgument('unknown', { array: 'number' })).toBe(true);
    expect(assignableToArgument({ array: 'unknown' }, { array: 'number' })).toBe(true);
    expect(assignableToArgument({ array: 'string' }, { array: 'unknown' })).toBe(true);
    expect(assignableToField({ array: 'unknown' }, 'array')).toBe(true);
  });

  it('still refuses a list where a single value belongs, elements unknown or not', () => {
    // Only the *elements* are unverifiable. That it is a list at all is known,
    // and a list cannot go in a number field however little is known about it.
    expect(assignableToField({ array: 'unknown' }, 'number')).toBe(false);
    expect(assignableToArgument({ array: 'unknown' }, 'number')).toBe(false);
    // Except into text, which takes anything.
    expect(assignableToField({ array: 'unknown' }, 'string')).toBe(true);
  });

  it('collapses a disagreement rather than picking a winner', () => {
    expect(unify(['number', 'number'])).toBe('number');
    expect(unify(['number', 'string'])).toBe('unknown');
    expect(unify([{ array: 'number' }, { array: 'number' }])).toEqual({ array: 'number' });
    expect(unify([{ array: 'number' }, { array: 'string' }])).toBe('array');
    expect(unify([])).toBe('unknown');
  });

  it('says a type the way an author reads it', () => {
    expect(sayType('number')).toBe('number');
    expect(sayType('string')).toBe('text');
    expect(sayType({ array: 'number' })).toBe('list of numbers');
    expect(sayType({ array: 'string' })).toBe('list of texts');
  });

  it('reads a JSON-Schema type keyword, and shrugs at anything else', () => {
    expect(kindOfJsonType('integer')).toBe('number');
    expect(kindOfJsonType('array')).toBe('array');
    expect(kindOfJsonType(undefined)).toBe('unknown');
    expect(kindOfJsonType('date-time')).toBe('unknown');
  });
});
