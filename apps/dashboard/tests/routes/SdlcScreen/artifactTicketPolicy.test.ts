import assert from 'node:assert/strict';
import test from 'node:test';
import {
  linkedTicketIds,
  relatedTicketsForArtifact,
  startWorkPrompt,
} from '../../../src/routes/SdlcScreen/artifactTicketPolicy.ts';

const links = [
  {
    sourceType: 'CANVAS',
    sourceId: 'prd-1',
    targetType: 'CANVAS',
    targetId: 'tech-1',
    relationType: 'TECH_DOC',
  },
  {
    sourceType: 'CANVAS',
    sourceId: 'prd-1',
    targetType: 'TICKET',
    targetId: 'ticket-1',
    relationType: 'CONTEXT',
  },
  {
    sourceType: 'CANVAS',
    sourceId: 'tech-1',
    targetType: 'TICKET',
    targetId: 'ticket-2',
    relationType: 'TICKET',
  },
];

void test('collects generic and legacy ticket links once', () => {
  assert.deepEqual(linkedTicketIds([...links, links[1]!]), ['ticket-1', 'ticket-2']);
});

void test('resolves same-project tickets across the PRD and Tech Doc chain', () => {
  const tickets = [
    { id: 'ticket-1', projectId: 'project-1', xyneId: 'APP-1', title: 'One' },
    { id: 'ticket-2', projectId: 'project-1', xyneId: 'APP-2', title: 'Two' },
    { id: 'ticket-2', projectId: 'project-2', xyneId: 'OTHER-2', title: 'Wrong project' },
  ];
  assert.deepEqual(
    relatedTicketsForArtifact({ canvasId: 'tech-1', projectId: 'project-1', links, tickets }).map(
      ticket => ticket.xyneId,
    ),
    ['APP-1', 'APP-2'],
  );
});

void test('builds the exact auto-send prompt', () => {
  assert.equal(
    startWorkPrompt({
      repositoryName: 'spaces',
      artifactKind: 'TECH_DOC',
      artifactTitle: 'Search design',
      ticket: { xyneId: 'APP-2', title: 'Implement search' },
    }),
    'Start work on ticket APP-2: Implement search for the Tech Doc "Search design" in repository "spaces". Inspect the linked artifact and ticket, then begin implementation.',
  );
});
