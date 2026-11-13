import { describe, it, expect } from 'vitest';
import { addMultipartValue, coerceTextFields } from './multipart-values.js';

describe('addMultipartValue', () => {
  it('keeps repeats of one field as a list', () => {
    const payload: Record<string, unknown> = {};
    addMultipartValue(payload, 'tag', 'a');
    expect(payload).toEqual({ tag: 'a' });
    addMultipartValue(payload, 'tag', 'b');
    expect(payload).toEqual({ tag: ['a', 'b'] });
    addMultipartValue(payload, 'tag', 'c');
    expect(payload).toEqual({ tag: ['a', 'b', 'c'] });
  });
});

describe('coerceTextFields', () => {
  const schema = {
    type: 'object',
    properties: {
      buildNumber: { type: 'string' },
      attempt: { type: 'number' },
      passed: { type: 'boolean' },
      meta: { type: 'object' },
      tags: { type: 'array', items: { type: 'string' } },
    },
  };

  it('leaves a declared string exactly as sent', () => {
    // The case a blanket JSON.parse gets wrong.
    expect(coerceTextFields({ buildNumber: '7003' }, schema)).toEqual({ buildNumber: '7003' });
    expect(coerceTextFields({ buildNumber: 'null' }, schema)).toEqual({ buildNumber: 'null' });
  });

  it('reads the other declared types out of their text', () => {
    expect(
      coerceTextFields({ attempt: '3', passed: 'true', meta: '{"branch":"main"}' }, schema),
    ).toEqual({ attempt: 3, passed: true, meta: { branch: 'main' } });
  });

  it('keeps list items as strings when the list declares strings', () => {
    expect(coerceTextFields({ tags: ['7', 'main'] }, schema)).toEqual({ tags: ['7', 'main'] });
  });

  it('parses a field the contract never declared', () => {
    expect(coerceTextFields({ extra: '42' }, schema)).toEqual({ extra: 42 });
  });

  it('leaves an unparseable value as text', () => {
    expect(coerceTextFields({ attempt: 'soon' }, schema)).toEqual({ attempt: 'soon' });
  });

  it('passes a non-object payload straight through', () => {
    expect(coerceTextFields('plain', schema)).toBe('plain');
  });
});
