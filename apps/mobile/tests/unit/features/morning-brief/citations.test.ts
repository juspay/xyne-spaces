import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { BriefToolInvocation } from '@/src/features/morning-brief/api/dailyBriefApi';
import {
  buildClawCitationUrl,
  findCitationForChunk,
  getClawCitationLabel,
  parseCiteGroupHref,
  parseCiteHref,
} from '@/src/features/morning-brief/utils/citations';

describe('parseCiteHref / parseCiteGroupHref', () => {
  it('round-trips a single citation href', () => {
    assert.deepEqual(parseCiteHref('xyne-cite://clf-tool.a:0#3'), {
      toolCallId: 'tool.a:0',
      chunkIndex: 3,
    });
    assert.equal(parseCiteHref('xyne-cite://nope'), null);
  });

  it('parses a group href into refs', () => {
    assert.deepEqual(parseCiteGroupHref('xyne-cite-group://clf-a#1,clf-b#2'), [
      { toolCallId: 'a', chunkIndex: 1 },
      { toolCallId: 'b', chunkIndex: 2 },
    ]);
  });
});

describe('findCitationForChunk', () => {
  const invocations: BriefToolInvocation[] = [
    {
      toolCallId: 'tool.a:0',
      citations: [
        { kind: 'thread', channelId: 'c1', chunkIndex: 1 },
        { kind: 'thread', channelId: 'c2', chunkIndex: 2 },
      ],
    },
  ];

  it('matches the exact chunk and falls back to the first citation', () => {
    assert.equal(findCitationForChunk(invocations, 'tool.a:0', 2)?.channelId, 'c2');
    assert.equal(findCitationForChunk(invocations, 'tool.a:0', 9)?.channelId, 'c1');
    assert.equal(findCitationForChunk(invocations, 'missing', 1), null);
  });
});

describe('buildClawCitationUrl', () => {
  it('builds thread URLs with origin hash and optional messageId', () => {
    assert.equal(
      buildClawCitationUrl({ kind: 'thread', channelId: 'c1', conversationId: 'v1' }),
      '/chat/dir/c1/v1#origin=v1',
    );
    assert.equal(
      buildClawCitationUrl({
        kind: 'thread',
        channelId: 'c1',
        conversationId: 'v1',
        messageId: 'm1',
      }),
      '/chat/dir/c1/v1#origin=v1&messageId=m1',
    );
  });

  it('passes external and collection-item URLs through', () => {
    assert.equal(buildClawCitationUrl({ kind: 'external', url: 'https://x.dev' }), 'https://x.dev');
  });

  it('builds canvas, recording and ticket URLs', () => {
    assert.equal(buildClawCitationUrl({ kind: 'canvas', viewAccessId: 'va1' }), '/chat/canvas/va1');
    assert.equal(buildClawCitationUrl({ kind: 'recording', recordingId: 'r1' }), '/recordings/r1');
    assert.equal(
      buildClawCitationUrl({
        kind: 'ticket',
        ticketId: 't1',
        channelId: 'c1',
        conversationId: 'v1',
      }),
      '/chat/dir/c1/v1/t1?selectedTab=thread',
    );
  });

  it('returns null when a citation cannot be routed', () => {
    assert.equal(buildClawCitationUrl({ kind: 'canvas' }), null);
  });
});

describe('getClawCitationLabel', () => {
  it('prefers the explicit label and falls back per kind', () => {
    assert.equal(getClawCitationLabel({ kind: 'thread', label: 'Roadmap' }), 'Roadmap');
    assert.equal(
      getClawCitationLabel({ kind: 'thread', channelName: 'launch' }),
      'Thread in #launch',
    );
    assert.equal(getClawCitationLabel({ kind: 'ticket', ticketId: 'T-9' }), 'Ticket T-9');
  });
});
