import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canDebugRepoKnowledge,
  isRepoKnowledgeRunning,
  repoKnowledgeAction,
  repoKnowledgeControl,
  repoKnowledgeState,
} from '../../../src/routes/SdlcScreen/repoKnowledgePolicy.ts';

void test('selects one lifecycle control for every Repo Knowledge phase', () => {
  assert.equal(repoKnowledgeControl('NOT_STARTED'), 'GENERATE');
  assert.equal(repoKnowledgeControl('QUEUED'), 'CANCEL');
  assert.equal(repoKnowledgeControl('CLONING'), 'CANCEL');
  assert.equal(repoKnowledgeControl('GENERATING'), 'CANCEL');
  assert.equal(repoKnowledgeControl('PARTIALLY_FAILED'), 'RETRY');
  assert.equal(repoKnowledgeControl('CANCELLED'), 'RETRY');
  assert.equal(repoKnowledgeControl('READY_FOR_REVIEW'), 'REFRESH');
  assert.equal(repoKnowledgeControl('APPROVED'), 'REFRESH');
});

void test('maps lifecycle controls to their only supported endpoint', () => {
  assert.equal(repoKnowledgeAction('GENERATE').path, 'setup');
  assert.equal(repoKnowledgeAction('CANCEL').path, 'setup/cancel');
  assert.equal(repoKnowledgeAction('RETRY').path, 'setup/retry');
  assert.equal(repoKnowledgeAction('REFRESH').path, 'setup/refresh');
});

void test('offers debugger only to an admin with an execution conversation', () => {
  assert.equal(
    canDebugRepoKnowledge({
      isAdmin: true,
      executionId: 'execution-1',
      conversationId: 'conversation-1',
    }),
    true,
  );
  assert.equal(
    canDebugRepoKnowledge({
      isAdmin: false,
      executionId: 'execution-1',
      conversationId: 'conversation-1',
    }),
    false,
  );
  assert.equal(
    canDebugRepoKnowledge({
      isAdmin: true,
      executionId: 'execution-1',
      conversationId: undefined,
    }),
    false,
  );
});

void test('normalizes backend terminal and running execution statuses', () => {
  assert.equal(repoKnowledgeState({ status: 'FAILURE' }).phase, 'PARTIALLY_FAILED');
  assert.equal(repoKnowledgeState({ status: 'CANCELLED' }).phase, 'CANCELLED');
  assert.equal(repoKnowledgeState({ status: 'SUCCESS' }).phase, 'READY_FOR_REVIEW');
  assert.equal(repoKnowledgeState({ status: 'RUNNING' }).phase, 'GENERATING');
  assert.equal(isRepoKnowledgeRunning(repoKnowledgeState({ status: 'RUNNING' }).phase), true);
});

void test('preserves durable debugger and progress context', () => {
  const state = repoKnowledgeState({
    status: 'RUNNING',
    context: JSON.stringify({
      phase: 'GENERATING',
      conversationId: 'conversation-1',
      sessionId: 'session-1',
      currentBaselineKind: 'RUN_GUIDE',
      completedBaselineKinds: ['CORE_CODE_MAP'],
    }),
    updatedAt: 123,
  });
  assert.deepEqual(state, {
    phase: 'GENERATING',
    conversationId: 'conversation-1',
    sessionId: 'session-1',
    currentBaselineKind: 'RUN_GUIDE',
    completedCount: 1,
    updatedAt: 123,
  });
});
