import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildEmailPreview } from '@/src/features/xyne-desks/detail/utils/build-email-preview';

describe('buildEmailPreview', () => {
  it('returns an empty string for empty or missing bodies', () => {
    assert.equal(buildEmailPreview(''), '');
    assert.equal(buildEmailPreview(null), '');
    assert.equal(buildEmailPreview(undefined), '');
  });

  it('strips HTML tags down to readable text', () => {
    assert.equal(buildEmailPreview('<p>Hello <b>world</b></p>'), 'Hello world');
  });

  it('removes embedded UUIDs left over from quoted content', () => {
    const body = 'Ref 123e4567-e89b-12d3-a456-426614174000 done';
    assert.equal(buildEmailPreview(body), 'Ref done');
  });

  it('collapses all whitespace runs into single spaces', () => {
    assert.equal(buildEmailPreview('a\n\n\n   b\tc'), 'a b c');
  });

  it('truncates to the requested maximum length', () => {
    assert.equal(buildEmailPreview('abcdefghij', 5), 'abcde');
  });

  it('defaults to a 160-character cap', () => {
    const long = 'w'.repeat(300);
    assert.equal(buildEmailPreview(long).length, 160);
  });
});
