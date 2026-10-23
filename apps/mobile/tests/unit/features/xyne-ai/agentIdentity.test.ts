import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  agentIdentity,
  agentInitial,
  buildAgentDirectory,
  conversationAgents,
  rowAgentSlug,
} from '@/src/features/xyne-ai/model/agentIdentity';

describe('buildAgentDirectory', () => {
  it('adds Ask AI, which fetchAgents filters out of the catalogue', () => {
    const directory = buildAgentDirectory([]);
    assert.deepEqual(directory.get('ask-ai'), { name: 'Ask AI' });
  });

  it('carries name, colour and bot user for each agent', () => {
    const directory = buildAgentDirectory([
      { slug: 'doctor', name: 'Xyne Doctor', color: '#2563EB', botUserId: 'bot-1' },
      { slug: 'plain', name: 'Plain', color: '' },
    ]);
    assert.deepEqual(directory.get('doctor'), {
      name: 'Xyne Doctor',
      color: '#2563EB',
      userId: 'bot-1',
    });
    // No colour or bot user: the tile falls back to the accent and a letter.
    assert.deepEqual(directory.get('plain'), { name: 'Plain' });
  });
});

describe('agentIdentity', () => {
  it('falls back to the slug for an agent the viewer can no longer see', () => {
    assert.deepEqual(agentIdentity(buildAgentDirectory([]), 'gone-agent'), { name: 'gone-agent' });
  });
});

describe('conversationAgents / rowAgentSlug', () => {
  it('prefers agentSlugs, in first-use order', () => {
    const row = { agentSlug: 'b', agentSlugs: ['a', 'b'] };
    assert.deepEqual(conversationAgents(row), ['a', 'b']);
    assert.equal(rowAgentSlug(row), 'a');
  });

  it('falls back to agentSlug on older servers or an empty list', () => {
    assert.deepEqual(conversationAgents({ agentSlug: 'ask-ai' }), ['ask-ai']);
    assert.deepEqual(conversationAgents({ agentSlug: 'x', agentSlugs: [] }), ['x']);
  });

  it('returns nothing for a row without an agent', () => {
    assert.equal(rowAgentSlug({ agentSlug: '' }), undefined);
  });
});

describe('agentInitial', () => {
  it('uppercases the first character and handles blanks', () => {
    assert.equal(agentInitial('  xyne'), 'X');
    assert.equal(agentInitial(''), '?');
  });
});
