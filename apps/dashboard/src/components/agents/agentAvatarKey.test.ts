import { describe, expect, it } from 'vitest';
import { agentAvatarKey } from './agentAvatarKey';

describe('agentAvatarKey', () => {
  it('keeps the face the agent was built with', () => {
    expect(agentAvatarKey({ id: 'agent_1', config: { avatarKey: 'draft_9' } })).toBe('draft_9');
  });

  it('falls back to the id for agents made before faces were kept', () => {
    expect(agentAvatarKey({ id: 'agent_1', config: {} })).toBe('agent_1');
    expect(agentAvatarKey({ id: 'agent_1', config: { avatarKey: '' } })).toBe('agent_1');
    expect(agentAvatarKey({ id: 'agent_1' })).toBe('agent_1');
  });
});
