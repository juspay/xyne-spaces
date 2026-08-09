import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveSdlcDiscussionContext } from './sdlcDiscussionModel.ts';

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
      ticketIds: ['ticket'],
      canvases,
      links,
    })?.owner.canvasId,
    'prd',
  );
});
