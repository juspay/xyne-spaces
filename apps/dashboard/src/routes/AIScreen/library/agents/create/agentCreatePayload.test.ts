import { describe, expect, it } from 'vitest';
import { EMPTY_CREATE_FORM } from '@/components/flowUI/nodes/agent/create/types';
import { buildCreateAgentPayload } from './agentCreatePayload';

const form = {
  ...EMPTY_CREATE_FORM,
  name: '  Morning Brief ',
  description: 'Daily DM brief',
  systemPrompt: ' prompt ',
  permissionMode: 'read-only' as const,
  tools: {
    subagents: ['spaces'],
    direct: ['xyne-spaces__list_dms'],
    custom: [],
    gateway: [],
    callableAgents: ['helper'],
  },
  selectedSkillIds: ['s1', 's1'],
  selectedKbResources: [{ collectionId: 'c1', fileId: null }],
};

describe('buildCreateAgentPayload', () => {
  it('sends tools, permission mode and skills in the create POST', () => {
    const payload = buildCreateAgentPayload(form, 'morning-brief', 'user_1');
    expect(payload).toMatchObject({
      slug: 'morning-brief',
      name: 'Morning Brief',
      systemPrompt: 'prompt',
      ownerUserId: 'user_1',
      knowledgeBase: [{ collectionId: 'c1', fileId: null }],
      skills: ['s1'],
      config: {
        permissionMode: 'read-only',
        tools: {
          subagents: ['spaces'],
          direct: ['xyne-spaces__list_dms'],
          callableAgents: ['helper'],
        },
      },
    });
  });

  it('omits grants for whole-KB scope and skills when none are picked', () => {
    const payload = buildCreateAgentPayload(
      { ...form, selectedKbScope: 'USER', selectedSkillIds: [] },
      'morning-brief',
      undefined,
    );
    expect(payload.knowledgeBase).toBeUndefined();
    expect(payload.skills).toBeUndefined();
    expect(payload.ownerUserId).toBeUndefined();
  });
});
