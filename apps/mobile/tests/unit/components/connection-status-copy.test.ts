import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CONNECTION_STATE_COPY,
  CONNECTION_STATE_ORDER,
  CONNECTION_TONE_COLOR,
  LIVE_SYNC_EXPLAINER,
  LIVE_SYNC_GUIDE_ID,
  describeConnectionState,
  isZeroConnectionName,
} from '@/src/components/connection-status-sheet/connection-status-copy';
import { USER_GUIDES } from '@/src/features/user-guide/guides';

const ZERO_STATES = ['connected', 'connecting', 'disconnected', 'needs-auth', 'error', 'closed'];

describe('connection status copy', () => {
  it('covers every state Zero can report, in the listed order', () => {
    assert.deepEqual([...CONNECTION_STATE_ORDER], ZERO_STATES);
    for (const name of ZERO_STATES) {
      assert.ok(isZeroConnectionName(name), `missing copy for ${name}`);
    }
  });

  it('gives every state a label, a meaning, an action and a tone colour', () => {
    for (const entry of Object.values(CONNECTION_STATE_COPY)) {
      assert.ok(entry.label.length > 0, `${entry.name}: label`);
      assert.ok(entry.meaning.endsWith('.'), `${entry.name}: meaning is a sentence`);
      assert.ok(entry.whatToDo.endsWith('.'), `${entry.name}: whatToDo is a sentence`);
      assert.equal(entry.dotColor, CONNECTION_TONE_COLOR[entry.tone]);
    }
  });

  it('keeps the header colours the dashboard uses', () => {
    assert.equal(describeConnectionState('connected').dotColor, '#00C851');
    assert.equal(describeConnectionState('connecting').dotColor, '#FFD600');
    assert.equal(describeConnectionState('disconnected').dotColor, '#FF5252');
    assert.equal(describeConnectionState('error').dotColor, '#FF5252');
  });

  it('only offers Refresh where reconnecting makes sense', () => {
    assert.equal(CONNECTION_STATE_COPY.connected.canRefresh, false);
    assert.equal(CONNECTION_STATE_COPY.connecting.canRefresh, false);
    assert.equal(CONNECTION_STATE_COPY.disconnected.canRefresh, true);
    assert.equal(CONNECTION_STATE_COPY.error.canRefresh, true);
    assert.equal(CONNECTION_STATE_COPY['needs-auth'].canRefresh, true);
    assert.equal(CONNECTION_STATE_COPY.closed.canRefresh, true);
  });

  it('falls back safely for a state name it does not know', () => {
    const unknown = describeConnectionState('something-new');
    assert.equal(unknown.name, 'unknown');
    assert.equal(unknown.tone, 'neutral');
    assert.equal(unknown.canRefresh, true);
    assert.equal(isZeroConnectionName('something-new'), false);
  });

  it('names the sync engine once in the explainer and links to a real guide', () => {
    assert.match(LIVE_SYNC_EXPLAINER, /Zero/);
    assert.ok(
      USER_GUIDES.some(guide => guide.id === LIVE_SYNC_GUIDE_ID),
      `no guide with id ${LIVE_SYNC_GUIDE_ID}`,
    );
  });
});
