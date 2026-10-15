import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { childrenToString, isStringifiableChildren } from '@/src/utils/children-to-string';

type Children = Parameters<typeof isStringifiableChildren>[0];

// Build a value that React.isValidElement() treats as an element, without
// importing React (logic tests may not import React).
const fakeElement = (): Children =>
  ({
    $$typeof: Symbol.for('react.transitional.element'),
    type: 'div',
    props: {},
    key: null,
    ref: null,
  }) as unknown as Children;

describe('childrenToString', () => {
  it('returns null for null', () => {
    assert.equal(childrenToString(null), null);
  });

  it('returns the string unchanged', () => {
    assert.equal(childrenToString('hello'), 'hello');
  });

  it('stringifies a number', () => {
    assert.equal(childrenToString(0), '0');
    assert.equal(childrenToString(42), '42');
  });

  it('returns null for booleans', () => {
    assert.equal(childrenToString(true), null);
    assert.equal(childrenToString(false), null);
  });

  it('returns null for a React element', () => {
    assert.equal(childrenToString(fakeElement()), null);
  });

  it('joins an array of strings and numbers', () => {
    assert.equal(childrenToString(['a', 1, 'b']), 'a1b');
  });

  it('skips null and boolean entries in an array', () => {
    assert.equal(childrenToString(['a', null, true, 1, false, 'b']), 'a1b');
  });

  it('recursively joins nested arrays', () => {
    assert.equal(childrenToString(['x', ['y', 'z']]), 'xyz');
  });

  it('returns null when an array contains a React element', () => {
    assert.equal(childrenToString(['a', fakeElement()]), null);
  });

  it('returns null for an empty array', () => {
    assert.equal(childrenToString([]), null);
  });
});

describe('isStringifiableChildren', () => {
  it('is true for plain strings and numbers', () => {
    assert.equal(isStringifiableChildren('abc'), true);
    assert.equal(isStringifiableChildren(7), true);
  });

  it('is false for React elements', () => {
    assert.equal(isStringifiableChildren(fakeElement()), false);
  });

  it('is false for null and booleans', () => {
    assert.equal(isStringifiableChildren(null), false);
    assert.equal(isStringifiableChildren(true), false);
  });
});
