import { describe, expect, it } from 'vitest';
import { EMPTY_CREATE_FORM } from '@/components/flowUI/nodes/agent/create/types';
import { AGENT_PROPERTIES_HEADING, buildCreateAgentPayload } from './agentCreatePayload';

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

  it('saves custom properties and the schedule, and tells the agent about them', () => {
    const payload = buildCreateAgentPayload(
      {
        ...form,
        customProperties: [
          { id: 'p1', type: 'number', title: 'Budget', value: '500' },
          { id: 'p2', type: 'checkbox', title: 'Needs approval', value: 'true' },
          { id: 'p3', type: 'text', title: 'Empty', value: '' },
        ],
        schedule: { kind: 'repeat', cron: '0 9 * * 1-5', timezone: 'UTC', task: 'Send the brief' },
      },
      'morning-brief',
      'user_1',
    );
    expect(payload.config).toMatchObject({
      customProperties: [{ title: 'Budget' }, { title: 'Needs approval' }, { title: 'Empty' }],
      schedule: { kind: 'repeat', cron: '0 9 * * 1-5' },
    });
    const [instructions, section] = payload.systemPrompt.split(
      `\n\n${AGENT_PROPERTIES_HEADING}\n\n`,
    );
    expect(instructions).toBe('prompt');
    expect(section).toContain('- Budget: 500');
    expect(section).toContain('- Needs approval: Yes');
    expect(section).not.toContain('Empty');
    expect(section).toMatch(
      /- Runs on a schedule: weekdays at 9:00.*\(UTC\)\. Each run: Send the brief/,
    );
  });

  it('leaves the instructions alone when there are no properties', () => {
    expect(buildCreateAgentPayload(form, 'morning-brief', 'user_1').systemPrompt).toBe('prompt');
  });

  it('saves the face the draft had, so it does not change on Save', () => {
    expect(
      buildCreateAgentPayload(form, 'morning-brief', 'user_1', 'draft_9').config,
    ).toMatchObject({
      avatarKey: 'draft_9',
    });
    expect(buildCreateAgentPayload(form, 'morning-brief', 'user_1').config).not.toHaveProperty(
      'avatarKey',
    );
  });
});
