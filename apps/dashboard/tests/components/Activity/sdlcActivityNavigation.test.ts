import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveSdlcActivityTarget } from '../../../src/components/Activity/sdlcActivityNavigation.ts';

const channelMetadata = { surface: 'SDLC', hiddenFromChat: true, repoId: 'repo/one' };

void test('keeps the existing destination for non-SDLC channels', () => {
  assert.equal(
    resolveSdlcActivityTarget({
      activity: { conversationId: 'conversation-1' },
      channelMetadata: {},
      fallbackPath: '/chat/dir/channel-1',
    }),
    '/chat/dir/channel-1',
  );
});

void test('opens SDLC message activity at the exact conversation and message', () => {
  assert.equal(
    resolveSdlcActivityTarget({
      activity: {
        message: {
          messageId: 'message-1',
          conversation: { conversationId: 'conversation-1' },
        },
      },
      channelMetadata,
      fallbackPath: '/chat/dir/channel-1',
    }),
    '/sdlc/repo%2Fone/overview?discussion=1&chat=conversations&conversation=conversation-1#origin=conversation-1&messageId=message-1',
  );
});

void test('routes SDLC ticket and canvas activity to their native sections', () => {
  assert.equal(
    resolveSdlcActivityTarget({
      activity: { ticketId: 'ticket-1' },
      channelMetadata,
      fallbackPath: '/chat/activity',
    }),
    '/sdlc/repo%2Fone/tickets?ticket=ticket-1',
  );
  assert.equal(
    resolveSdlcActivityTarget({
      activity: {
        canvasId: 'baseline-1',
        canvas: { id: 'baseline-1', metadata: { artifactKind: 'BASELINE' } },
      },
      channelMetadata,
      fallbackPath: '/chat/canvas/baseline-1',
    }),
    '/sdlc/repo%2Fone/baseline?canvas=baseline-1',
  );
  assert.equal(
    resolveSdlcActivityTarget({
      activity: {
        canvasId: 'prd-1',
        canvas: { id: 'prd-1', metadata: { artifactKind: 'PRD' } },
      },
      channelMetadata,
      fallbackPath: '/chat/canvas/prd-1',
    }),
    '/sdlc/repo%2Fone/prds?canvas=prd-1',
  );
  assert.equal(
    resolveSdlcActivityTarget({
      activity: {
        canvasId: 'canvas-1',
        canvas: { id: 'canvas-1', metadata: { artifactKind: 'TECH_DOC' } },
      },
      channelMetadata,
      fallbackPath: '/chat/canvas/canvas-1',
    }),
    '/sdlc/repo%2Fone/tech-docs?canvas=canvas-1',
  );
  assert.equal(
    resolveSdlcActivityTarget({
      activity: {
        canvasId: 'wiki-1',
        canvas: { id: 'wiki-1', metadata: { documentKind: 'WIKI' } },
      },
      channelMetadata,
      fallbackPath: '/chat/canvas/wiki-1',
    }),
    '/sdlc/repo%2Fone/wiki?canvas=wiki-1',
  );
});

void test('routes unsupported SDLC activity to repository overview', () => {
  assert.equal(
    resolveSdlcActivityTarget({
      activity: {},
      channelMetadata,
      fallbackPath: '/calls',
    }),
    '/sdlc/repo%2Fone/overview',
  );
});
