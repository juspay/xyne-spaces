import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { alsoSendLabel } from '@/src/features/conversation/model/also-send';

describe('alsoSendLabel', () => {
  it('names the channel', () => {
    assert.equal(alsoSendLabel('design', 'channel'), 'Also send to #design');
  });

  it('falls back while the channel name is unknown', () => {
    assert.equal(alsoSendLabel('', 'channel'), 'Also send to channel');
    assert.equal(alsoSendLabel('  ', 'channel'), 'Also send to channel');
  });

  it('calls a person or group chat the conversation', () => {
    assert.equal(alsoSendLabel('Priya Rao', 'dm'), 'Also send to conversation');
    assert.equal(alsoSendLabel('Launch crew', 'group'), 'Also send to conversation');
  });
});
