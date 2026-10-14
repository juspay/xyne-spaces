import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { summarizeRecipients } from '@/src/features/xyne-desks/detail/utils/summarize-recipients';

describe('summarizeRecipients', () => {
  it('reports no recipients when both lists are empty', () => {
    assert.deepEqual(summarizeRecipients([], [], null), {
      label: 'no recipients',
      hasMultiple: false,
    });
  });

  it('says "to me" when the only recipient is the current user', () => {
    assert.deepEqual(summarizeRecipients(['me@x.com'], [], 'me@x.com'), {
      label: 'to me',
      hasMultiple: false,
    });
  });

  it('says "to me and 1 other" for the current user plus one', () => {
    assert.deepEqual(summarizeRecipients(['me@x.com', 'a@x.com'], [], 'me@x.com'), {
      label: 'to me and 1 other',
      hasMultiple: true,
    });
  });

  it('pluralises "others" beyond one additional recipient', () => {
    assert.deepEqual(summarizeRecipients(['me@x.com', 'a@x.com', 'b@x.com'], [], 'me@x.com'), {
      label: 'to me and 2 others',
      hasMultiple: true,
    });
  });

  it('matches the current user case-insensitively and across the cc list', () => {
    assert.deepEqual(summarizeRecipients(['a@x.com'], ['ME@X.COM'], 'me@x.com'), {
      label: 'to me and 1 other',
      hasMultiple: true,
    });
  });

  it('uses the first recipient display name when the user is not a recipient', () => {
    assert.deepEqual(summarizeRecipients(['Alice <alice@x.com>'], [], null), {
      label: 'to Alice',
      hasMultiple: false,
    });
  });

  it('adds an "and N others" suffix for multiple non-user recipients', () => {
    assert.deepEqual(summarizeRecipients(['Alice <alice@x.com>', 'b@x.com'], [], null), {
      label: 'to Alice and 1 other',
      hasMultiple: true,
    });
  });

  it('ignores falsy entries when counting recipients', () => {
    assert.deepEqual(summarizeRecipients(['', 'alice@x.com'], [''], null), {
      label: 'to alice',
      hasMultiple: false,
    });
  });
});
