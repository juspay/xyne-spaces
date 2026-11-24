import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { fileCardSubtitle } from '@/src/features/conversation/model/file-card';

describe('fileCardSubtitle', () => {
  it('joins the type, the size and the sender', () => {
    assert.equal(fileCardSubtitle('PDF', 1536, 'Ravi Shah'), 'PDF · 1.5 KB · Ravi Shah');
  });

  it('drops an unknown size', () => {
    assert.equal(fileCardSubtitle('PDF', null, 'Ravi Shah'), 'PDF · Ravi Shah');
    assert.equal(fileCardSubtitle('PDF', 0, 'Ravi Shah'), 'PDF · Ravi Shah');
  });

  it('drops the separator without a sender', () => {
    assert.equal(fileCardSubtitle('PDF', undefined, ''), 'PDF');
  });
});
