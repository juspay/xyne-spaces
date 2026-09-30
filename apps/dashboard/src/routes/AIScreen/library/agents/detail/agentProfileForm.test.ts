import { describe, expect, it } from 'vitest';
import type { Agent } from '@/services/claw/clawAuthAgentTypes';
import { buildCreateAgentPayload } from '../create/agentCreatePayload';
import {
  buildUpdateAgentPayload,
  formFromAgent,
  instructionsFromSaved,
  validateHandle,
} from './agentProfileForm';

const property = { id: 'p1', type: 'number' as const, title: 'Budget', value: '500' };

const agent = {
  id: 'a1',
  slug: 'pr-digest',
  name: 'PR Digest',
  description: 'Posts a PR digest',
  systemPrompt: 'Summarise open PRs.\n\n## Agent properties\n\n- Budget: 500',
  activePromptVersion: 2,
  scope: 'personal',
  ownerUserId: 'u1',
  enabled: true,
  color: '#FF8904',
  config: {
    permissionMode: 'read-only',
    tools: {
      subagents: [],
      direct: ['github__list_prs'],
      custom: [],
      gateway: [],
      callableAgents: [],
    },
    customProperties: [property],
    promptInjection: 'Be brief.',
  },
  skills: [{ id: 's-row', skillId: 'skill-1', skill: { slug: 'x', name: 'X', description: '' } }],
  collections: [{ id: 'c-row', agentId: 'a1', collectionId: 'c1', fileId: null, createdAt: '' }],
  kbScope: 'COLLECTIONS',
  tools: [],
  spacesAppId: null,
  spacesAppUserId: null,
  spacesAppToken: null,
  createdAt: '',
  updatedAt: '',
} as unknown as Agent;

describe('instructionsFromSaved', () => {
  it('drops the generated properties section', () => {
    expect(instructionsFromSaved(agent.systemPrompt ?? '')).toBe('Summarise open PRs.');
  });

  it('keeps a prompt without one as written', () => {
    expect(instructionsFromSaved('Just do it.\n')).toBe('Just do it.\n');
  });

  it('round-trips what the create flow saves', () => {
    const created = buildCreateAgentPayload(
      { ...formFromAgent(agent), systemPrompt: 'Be helpful.' },
      'x',
      undefined,
    );
    expect(instructionsFromSaved(created.systemPrompt ?? '')).toBe('Be helpful.');
  });
});

describe('formFromAgent', () => {
  it('reads the canvas fields off a saved agent', () => {
    const form = formFromAgent(agent);
    expect(form).toMatchObject({
      name: 'PR Digest',
      slug: 'pr-digest',
      slugManual: true,
      systemPrompt: 'Summarise open PRs.',
      permissionMode: 'read-only',
      selectedSkillIds: ['skill-1'],
      selectedKbResources: [{ collectionId: 'c1' }],
      customProperties: [property],
      schedule: null,
    });
    expect(form.tools.direct).toEqual(['github__list_prs']);
  });
});

describe('buildUpdateAgentPayload', () => {
  const baseline = formFromAgent(agent);

  it('sends nothing when nothing changed', () => {
    expect(buildUpdateAgentPayload(baseline, baseline, agent.config, true)).toEqual({});
  });

  it('sends only the changed name, not the prompt', () => {
    const payload = buildUpdateAgentPayload(
      { ...baseline, name: ' PR Digest v2 ' },
      baseline,
      agent.config,
      true,
    );
    expect(payload).toEqual({ name: 'PR Digest v2' });
  });

  it('rebuilds the properties section when the prompt changes', () => {
    const payload = buildUpdateAgentPayload(
      { ...baseline, systemPrompt: 'Summarise merged PRs.' },
      baseline,
      agent.config,
      true,
    );
    expect(payload.systemPrompt).toBe(
      'Summarise merged PRs.\n\n## Agent properties\n\n- Budget: 500',
    );
  });

  it('writes tools over the latest config, keeping settings made elsewhere', () => {
    const latest = { ...agent.config, verifyResponses: true };
    const payload = buildUpdateAgentPayload(
      { ...baseline, tools: { ...baseline.tools, direct: [] } },
      baseline,
      latest,
      true,
    );
    expect(payload.config).toMatchObject({
      verifyResponses: true,
      promptInjection: 'Be brief.',
      tools: { direct: [] },
    });
    expect(payload.systemPrompt).toBeUndefined();
  });

  it('drops custom properties from the config and the prompt when the last one goes', () => {
    const payload = buildUpdateAgentPayload(
      { ...baseline, customProperties: [] },
      baseline,
      agent.config,
      true,
    );
    expect(payload.config).not.toHaveProperty('customProperties');
    expect(payload.systemPrompt).toBe('Summarise open PRs.');
  });

  it('renames the handle only for someone allowed to', () => {
    const renamed = { ...baseline, slug: 'pr-digest-2' };
    expect(buildUpdateAgentPayload(renamed, baseline, agent.config, true).slug).toBe('pr-digest-2');
    expect(buildUpdateAgentPayload(renamed, baseline, agent.config, false)).toEqual({});
  });

  it('sends no grants for a USER-scoped knowledge base', () => {
    const payload = buildUpdateAgentPayload(
      { ...baseline, selectedKbScope: 'USER' },
      baseline,
      agent.config,
      true,
    );
    expect(payload).toEqual({ kbScope: 'USER' });
  });
});

describe('validateHandle', () => {
  it('accepts a handle and rejects a bad one', () => {
    expect(validateHandle('pr-digest')).toBeNull();
    expect(validateHandle('-bad')).not.toBeNull();
  });
});
