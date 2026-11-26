import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { toolRowLeading } from '@/src/features/conversation/model/tool-row';

describe('toolRowLeading', () => {
  it('shows the tools until Aa opens the formatting strip', () => {
    assert.equal(toolRowLeading({ formatting: false, dictating: false }), 'tools');
    assert.equal(toolRowLeading({ formatting: true, dictating: false }), 'formatting');
  });

  it('gives the whole row to the dictation controls while listening', () => {
    assert.equal(toolRowLeading({ formatting: false, dictating: true }), 'none');
    assert.equal(toolRowLeading({ formatting: true, dictating: true }), 'none');
  });
});
