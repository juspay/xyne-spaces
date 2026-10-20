import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { answerLinkTarget } from '@/src/features/xyne-ai/navigation/answerLink';

const ORIGIN = 'https://spaces.example.net';
const open = (path: string, workspace: string | null = 'w1'): ReturnType<typeof answerLinkTarget> =>
  answerLinkTarget(`${ORIGIN}${path}`, `${ORIGIN}/`, workspace);

describe('answerLinkTarget', () => {
  it('maps a dashboard DM link to its chat', () => {
    assert.deepEqual(open('/w1/chat/dm/c1'), { kind: 'chat', channelId: 'c1' });
    assert.deepEqual(open('/w1/chat/dm/c1?x=1#y'), { kind: 'chat', channelId: 'c1' });
  });

  it('leaves every other dashboard page to the usual link handling', () => {
    for (const path of [
      '/w1/chat/dm',
      '/w1/chat/dm/compose',
      '/w1/chat/c1',
      '/w1/chat/tickets/t1',
      '/w1/chat/canvas/c1',
      '/w1/ai/chat/s1',
    ]) {
      assert.equal(open(path), undefined, path);
    }
  });

  it('leaves links to another workspace or origin alone', () => {
    assert.equal(open('/w2/chat/dm/c1'), undefined);
    assert.equal(open('/w1/chat/dm/c1', null), undefined);
    assert.equal(answerLinkTarget('https://evil.test/w1/chat/dm/c1', ORIGIN, 'w1'), undefined);
  });
});
