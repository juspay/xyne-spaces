import { describe, it, expect } from 'vitest';
import { headerValue } from './headers.js';

describe('headerValue', () => {
  it('matches case-insensitively and takes the first of repeated values', () => {
    expect(headerValue({ 'X-Token': ['a', 'b'] }, 'x-token')).toBe('a');
    expect(headerValue({ 'content-type': 'application/json' }, 'Content-Type')).toBe('application/json');
    expect(headerValue({ other: 'x' }, 'x-token')).toBeUndefined();
  });
});
