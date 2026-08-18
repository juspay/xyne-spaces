import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveSdlcDiscussionContext } from '../../../src/routes/SdlcScreen/sdlcDiscussionModel.ts';

void test('resolves Tech Doc and Ticket surfaces to one PRD discussion owner', () => {
  const canvases = [
    { id: 'prd', title: 'PRD', metadata: { artifactKind: 'PRD' } },
    { id: 'tech-doc', title: 'Tech Doc', metadata: { artifactKind: 'TECH_DOC' } },
  ];
  const links = [
    {
      sourceType: 'CANVAS' as const,
      sourceId: 'prd',
      targetType: 'CANVAS' as const,
      targetId: 'tech-doc',
      relationType: 'TECH_DOC' as const,
    },
    {
      sourceType: 'CANVAS' as const,
      sourceId: 'tech-doc',
      targetType: 'TICKET' as const,
      targetId: 'ticket',
      relationType: 'TICKET' as const,
    },
  ];

  assert.equal(
    resolveSdlcDiscussionContext({
      selectedCanvasId: 'tech-doc',
      selectedWikiPage: null,
      selectedTicketId: null,
      selectedConversationId: null,
      ticketIds: ['ticket'],
      canvases,
      links,
    })?.owner.canvasId,
    'prd',
  );
  assert.equal(
    resolveSdlcDiscussionContext({
      selectedCanvasId: null,
      selectedWikiPage: null,
      selectedTicketId: 'ticket',
      selectedConversationId: null,
      ticketIds: ['ticket'],
      canvases,
      links,
    })?.owner.canvasId,
    'prd',
  );
});

void test('resolves an Activity conversation deep link to its SDLC owner', () => {
  const canvases = [{ id: 'prd', title: 'PRD', metadata: { artifactKind: 'PRD' } }];
  const links = [
    {
      sourceType: 'CANVAS' as const,
      sourceId: 'prd',
      targetType: 'CONVERSATION' as const,
      targetId: 'conversation-1',
      relationType: 'DISCUSSION' as const,
    },
  ];

  assert.deepEqual(
    resolveSdlcDiscussionContext({
      selectedCanvasId: null,
      selectedWikiPage: null,
      selectedTicketId: null,
      selectedConversationId: 'conversation-1',
      ticketIds: [],
      canvases,
      links,
    }),
    {
      owner: { canvasId: 'prd', title: 'PRD', kind: 'PIPELINE' },
      surface: { type: 'CANVAS', id: 'prd' },
    },
  );

  assert.equal(
    resolveSdlcDiscussionContext({
      selectedCanvasId: null,
      selectedWikiPage: null,
      selectedTicketId: null,
      selectedConversationId: 'missing',
      ticketIds: [],
      canvases,
      links,
    }),
    null,
  );
});
