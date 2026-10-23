import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildEmailPreview } from '@/src/features/xyne-desks/detail/utils/build-email-preview';

describe('buildEmailPreview', () => {
  it('returns empty string for empty/nullish bodies', () => {
    assert.equal(buildEmailPreview(null), '');
    assert.equal(buildEmailPreview(undefined), '');
    assert.equal(buildEmailPreview(''), '');
  });

  it('strips markup and collapses whitespace', () => {
    assert.equal(buildEmailPreview('<p>Hello <b>world</b></p>'), 'Hello world');
  });

  it('removes UUID tokens from the preview', () => {
    assert.equal(buildEmailPreview('ref 123e4567-e89b-12d3-a456-426614174000 end'), 'ref end');
  });

  it('truncates to the requested max length', () => {
    assert.equal(buildEmailPreview('abcdefghij', 5), 'abcde');
  });

  it('leaves short content within the default limit intact', () => {
    assert.equal(buildEmailPreview('short body'), 'short body');
  });
});
