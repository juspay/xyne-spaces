import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { summarizeRecipients } from '@/src/features/xyne-desks/detail/utils/summarize-recipients';

describe('summarizeRecipients', () => {
  it('reports when there are no recipients', () => {
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

  it('matches the current user case-insensitively and trimmed', () => {
    assert.deepEqual(summarizeRecipients(['ME@X.com'], [], '  me@x.com '), {
      label: 'to me',
      hasMultiple: false,
    });
  });

  it('counts the current user plus one other', () => {
    assert.deepEqual(summarizeRecipients(['me@x.com', 'a@x.com'], [], 'me@x.com'), {
      label: 'to me and 1 other',
      hasMultiple: true,
    });
  });

  it('counts the current user plus many others (to + cc)', () => {
    assert.deepEqual(summarizeRecipients(['me@x.com', 'a@x.com'], ['b@x.com'], 'me@x.com'), {
      label: 'to me and 2 others',
      hasMultiple: true,
    });
  });

  it('uses the first recipient display name when the user is absent', () => {
    assert.deepEqual(summarizeRecipients(['Alice <alice@x.com>'], [], 'me@x.com'), {
      label: 'to Alice',
      hasMultiple: false,
    });
  });

  it('summarizes multiple non-me recipients from the first name', () => {
    assert.deepEqual(summarizeRecipients(['Alice <alice@x.com>', 'bob@x.com'], [], null), {
      label: 'to Alice and 1 other',
      hasMultiple: true,
    });
    assert.deepEqual(summarizeRecipients(['Alice <a@x.com>'], ['b@x.com', 'c@x.com'], null), {
      label: 'to Alice and 2 others',
      hasMultiple: true,
    });
  });

  it('ignores empty-string recipients', () => {
    assert.deepEqual(summarizeRecipients(['', 'x@y.com'], [], null), {
      label: 'to x',
      hasMultiple: false,
    });
  });
});
