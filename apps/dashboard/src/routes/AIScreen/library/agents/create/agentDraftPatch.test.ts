import { describe, expect, it } from 'vitest';
import type { AvailableTools } from '@/services/claw/clawToolsTypes';
import type { Skill } from '@/services/claw/clawSkillsTypes';
import type { KbCollectionNode } from '@/services/claw/clawKnowledgeBaseTypes';
import {
  INITIAL_WIZARD_STATE,
  type WizardState,
} from '../../../../ClawAgentsScreen/create/wizardState';
import { paramsToDraftPatch, wantsCommit } from './agentDraftPatch';

const tool = (
  slug: string,
  name: string,
): { slug: string; name: string; description: string; riskLevel: 'read' } => ({
  slug,
  name,
  description: '',
  riskLevel: 'read',
});

// Bitbucket before GitHub, and both exposing an unprefixed `merge_pull_request`:
// the real catalogue shape that made selecting one light up the other.
const catalog = {
  subagents: [{ name: 'spaces', serverType: 'xyne-spaces' }],
  integrations: [
    {
      slug: 'bitbucket',
      label: 'Bitbucket',
      kind: 'mcp',
      usageCount: 0,
      readTools: [],
      writeTools: [tool('merge_pull_request', 'Merge pull request')],
    },
    {
      slug: 'github',
      label: 'GitHub',
      kind: 'mcp',
      usageCount: 0,
      readTools: [tool('github__get_issue', 'get_issue')],
      writeTools: [tool('merge_pull_request', 'Merge pull request')],
    },
    {
      slug: 'xyne-spaces',
      label: 'Xyne Spaces',
      kind: 'mcp',
      usageCount: 0,
      readTools: [tool('xyne-spaces__search', 'search')],
      writeTools: [],
    },
    {
      slug: 'xyne-spaces-app-tools',
      label: 'Xyne Spaces App Tools',
      kind: 'mcp',
      usageCount: 0,
      readTools: [tool('xyne-spaces-app-tools__run', 'run')],
      writeTools: [],
    },
  ],
  customGroups: [],
} as unknown as AvailableTools;

const skills = [
  { id: 'sk1', slug: 'charts', name: 'Charts', label: 'Charts' },
  { id: 'sk2', slug: 'code-reviewer', name: 'Code Reviewer', label: 'Code Reviewer' },
] as unknown as Skill[];

const collections = [
  { id: 'kb1', name: 'Handbook' },
  { id: 'kb2', name: 'Runbooks' },
] as unknown as KbCollectionNode[];

const draft: WizardState = {
  ...INITIAL_WIZARD_STATE,
  selectedSkillIds: ['sk1', 'sk2'],
};

const patch = (params: Record<string, unknown>, context = {}) =>
  paramsToDraftPatch(params, draft, catalog, {
    skillCatalog: skills,
    kbCollections: collections,
    ...context,
  });

describe('wantsCommit', () => {
  it('treats only an explicit true as approval', () => {
    expect(wantsCommit(true)).toBe(true);
    expect(wantsCommit('true')).toBe(true);
  });

  it('does not commit when the flag is absent, false or ambiguous', () => {
    expect(wantsCommit(undefined)).toBe(false);
    expect(wantsCommit(false)).toBe(false);
    expect(wantsCommit('yes')).toBe(false);
    expect(wantsCommit(1)).toBe(false);
  });
});

describe('paramsToDraftPatch — MCP resolution', () => {
  it('attaches only the integration asked for when two share a tool slug', () => {
    const { patch: result } = patch({ mcps: ['GitHub'] });
    expect(result.tools?.direct).toContain('github__get_issue');
    // merge_pull_request is Bitbucket's by first-wins ownership, so granting
    // GitHub must not write a key that would light Bitbucket up.
    expect(result.tools?.direct).not.toContain('merge_pull_request');
  });

  it('resolves an integration named without its vendor prefix', () => {
    const { patch: result } = patch({ mcps: ['spaces'] });
    expect(result.tools?.direct).toContain('xyne-spaces__search');
  });

  it('does not let a generic trailing word resolve an integration', () => {
    const { problems } = patch({ mcps: ['tools'] });
    expect(problems.join(' ')).toMatch(/no such capability/i);
  });

  it('accepts a stringified array, which the model sends when the field is undeclared', () => {
    const { patch: result } = patch({ mcps: '["GitHub"]' });
    expect(result.tools?.direct).toContain('github__get_issue');
  });

  it('reports an unknown integration instead of dropping it silently', () => {
    const { problems } = patch({ mcps: ['nope'] });
    expect(problems.join(' ')).toMatch(/nope/);
  });
});

describe('paramsToDraftPatch — skills', () => {
  it('replaces the list so a removal takes effect', () => {
    const { patch: result } = patch({ skills: ['Charts'] });
    expect(result.selectedSkillIds).toEqual(['sk1']);
  });

  it('resolves a stringified list', () => {
    const { patch: result } = patch({ skills: '["Charts", "Code Reviewer"]' });
    expect(result.selectedSkillIds).toEqual(['sk1', 'sk2']);
  });

  it('leaves the list untouched while the catalogue is still loading', () => {
    const { patch: result, problems } = paramsToDraftPatch(
      { skills: ['Charts'] },
      draft,
      catalog,
      {},
    );
    expect(result.selectedSkillIds).toBeUndefined();
    expect(problems.join(' ')).toMatch(/still loading/i);
  });

  it('reports a skill this workspace does not have', () => {
    const { problems } = patch({ skills: ['Nonexistent'] });
    expect(problems.join(' ')).toMatch(/Nonexistent/);
  });
});

describe('paramsToDraftPatch — knowledge', () => {
  it('resolves collection names and switches scope', () => {
    const { patch: result } = patch({ knowledge: { collections: ['Handbook'] } });
    expect(result.selectedKbResources).toEqual([{ collectionId: 'kb1', fileId: null }]);
    expect(result.selectedKbScope).toBe('COLLECTIONS');
  });

  it('leaves collections untouched while the catalogue is still loading', () => {
    const { patch: result, problems } = paramsToDraftPatch(
      { knowledge: { collections: ['Handbook'] } },
      draft,
      catalog,
      {},
    );
    expect(result.selectedKbResources).toBeUndefined();
    expect(problems.join(' ')).toMatch(/still loading/i);
  });
});

describe('paramsToDraftPatch — committing is independent of the patch', () => {
  it('applies an ordinary change without any commit signal', () => {
    const params = { mcps: ['GitHub'] };
    const { patch: result } = patch(params);
    expect(result.tools?.direct).toContain('github__get_issue');
    expect(wantsCommit(params['commit' as keyof typeof params])).toBe(false);
  });

  it('carries an explicit approval alongside the same change', () => {
    const params = { mcps: ['GitHub'], commit: true };
    const { patch: result } = patch(params);
    expect(result.tools?.direct).toContain('github__get_issue');
    expect(wantsCommit(params.commit)).toBe(true);
  });
});
