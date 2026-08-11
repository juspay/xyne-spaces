import assert from 'node:assert/strict';
import test from 'node:test';
import { artifactCta } from './artifactCtaPolicy.ts';

void test('PRD creates a Tech Doc when none is linked', () => {
  assert.deepEqual(artifactCta('PRD', null), {
    action: 'CREATE_TECH_DOC',
    label: 'Create Tech Doc',
  });
});

void test('PRD views its linked Tech Doc', () => {
  assert.deepEqual(artifactCta('PRD', 'tech-doc-1'), {
    action: 'VIEW_TECH_DOC',
    label: 'View Tech Doc',
    targetId: 'tech-doc-1',
  });
});

void test('Tech Doc creates a ticket when none is linked', () => {
  assert.deepEqual(artifactCta('TECH_DOC', null), {
    action: 'CREATE_TICKET',
    label: 'Create Ticket',
  });
});

void test('Tech Doc views its linked ticket', () => {
  assert.deepEqual(artifactCta('TECH_DOC', 'ticket-1'), {
    action: 'VIEW_TICKET',
    label: 'View Ticket',
    targetId: 'ticket-1',
  });
});
