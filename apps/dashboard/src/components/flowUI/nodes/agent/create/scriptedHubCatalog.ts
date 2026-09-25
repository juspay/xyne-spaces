import type { QueryClient } from '@tanstack/react-query';
import type { KbCollectionNode } from '@/services/claw/clawKnowledgeBaseTypes';
import type { McpServer } from '@/services/claw/clawMcpTypes';
import type { Skill } from '@/services/claw/clawSkillsTypes';
import type { AvailableTools } from '@/services/claw/clawToolsTypes';
import type { ClawKnowledgeBaseTree } from '@/hooks/useClawKnowledgeBaseTree';
import type { ClawMcpData } from '@/hooks/useClawMcp';
import { SCRIPTED_HUB_IDS } from './scriptedCreateDemo';

const NOW = '2026-09-21T00:00:00.000Z';

export const SCRIPTED_SLACK_SERVER: McpServer = {
  id: 'scripted-slack-server',
  name: 'Slack',
  type: SCRIPTED_HUB_IDS.slackSource,
  url: 'https://scripted.local/slack',
  description: 'Post standup digests to Slack.',
  enabled: true,
  connectorMeta: { scope: 'global', publishStatus: 'published' },
  createdAt: NOW,
  updatedAt: NOW,
};

export const SCRIPTED_AVAILABLE_TOOLS: AvailableTools = {
  subagents: [],
  mcpServers: [{ id: 'slack', name: 'Slack', type: SCRIPTED_HUB_IDS.slackSource }],
  writeTools: [],
  customGroups: [
    {
      source: SCRIPTED_HUB_IDS.summarySource,
      tools: [{ slug: SCRIPTED_HUB_IDS.summarySlug, name: 'Summary' }],
    },
  ],
  serverTools: {
    [SCRIPTED_HUB_IDS.slackSource]: [
      { slug: SCRIPTED_HUB_IDS.slackToolSlug, name: 'chat_postMessage' },
    ],
  },
  integrations: [
    {
      slug: SCRIPTED_HUB_IDS.slackSource,
      label: 'Slack',
      kind: 'gateway',
      connected: true,
      backendIds: ['default'],
      readTools: [],
      writeTools: [
        {
          slug: SCRIPTED_HUB_IDS.slackToolSlug,
          name: 'chat_postMessage',
          description: 'Post a standup digest',
          riskLevel: 'write',
        },
      ],
      usageCount: 12,
    },
    {
      slug: SCRIPTED_HUB_IDS.summarySource,
      label: 'Summary',
      kind: 'custom',
      connected: true,
      readTools: [
        {
          slug: SCRIPTED_HUB_IDS.summarySlug,
          name: 'Summary',
          description: 'Summarize a standup thread',
          riskLevel: 'read',
        },
      ],
      writeTools: [],
      usageCount: 8,
    },
  ],
};

export const SCRIPTED_SKILL: Skill = {
  id: SCRIPTED_HUB_IDS.skillId,
  slug: SCRIPTED_HUB_IDS.skillSlug,
  name: 'Standup notes',
  label: 'Standup notes',
  description: 'Format a daily standup digest.',
  content: 'Capture shipped / blocked / next.',
  source: 'seeded',
  scope: 'global',
  ownerUserId: null,
  owner: null,
  enabled: true,
  createdAt: NOW,
  updatedAt: NOW,
};

export const SCRIPTED_KB_COLLECTION: KbCollectionNode = {
  id: SCRIPTED_HUB_IDS.collectionId,
  name: 'Eng team',
  description: 'Eng team notes for standup context.',
  isPrivate: false,
  ownerId: 'scripted',
  scopeType: 'WORKSPACE',
  scopeId: 'scripted',
  parentId: null,
  rootCollectionId: null,
  effectiveRole: 'OWNER',
  children: [],
  items: [],
};

const EMPTY_TOOLS: AvailableTools = {
  subagents: [],
  mcpServers: [],
  writeTools: [],
  customGroups: [],
  serverTools: {},
  integrations: [],
};

function mergeTools(current: AvailableTools | undefined): AvailableTools {
  const base = current ?? EMPTY_TOOLS;
  const hasSlack = base.integrations.some(
    integration => integration.slug === SCRIPTED_HUB_IDS.slackSource,
  );
  const hasSummary = base.customGroups.some(
    group => group.source === SCRIPTED_HUB_IDS.summarySource,
  );
  if (hasSlack && hasSummary) return base;
  const slackIntegration = SCRIPTED_AVAILABLE_TOOLS.integrations.filter(
    integration => integration.kind === 'gateway',
  );
  const summaryIntegration = SCRIPTED_AVAILABLE_TOOLS.integrations.filter(
    integration => integration.slug === SCRIPTED_HUB_IDS.summarySource,
  );
  return {
    ...base,
    integrations: [
      ...(hasSlack ? [] : slackIntegration),
      ...(hasSummary ? [] : summaryIntegration),
      ...base.integrations,
    ],
    customGroups: hasSummary
      ? base.customGroups
      : [...base.customGroups, ...SCRIPTED_AVAILABLE_TOOLS.customGroups],
    mcpServers: hasSlack
      ? base.mcpServers
      : [...base.mcpServers, ...SCRIPTED_AVAILABLE_TOOLS.mcpServers],
    serverTools: hasSlack
      ? base.serverTools
      : { ...base.serverTools, ...SCRIPTED_AVAILABLE_TOOLS.serverTools },
  };
}

function mergeSkills(current: Skill[] | undefined): Skill[] {
  const list = current ?? [];
  if (list.some(skill => skill.id === SCRIPTED_HUB_IDS.skillId)) {
    return list;
  }
  return [...list, SCRIPTED_SKILL];
}

function mergeKb(current: ClawKnowledgeBaseTree | undefined): ClawKnowledgeBaseTree {
  const collections = current?.collections ?? [];
  if (collections.some(node => node.id === SCRIPTED_HUB_IDS.collectionId)) {
    return current ?? { collections, noSpacesSession: false };
  }
  return {
    collections: [...collections, SCRIPTED_KB_COLLECTION],
    noSpacesSession: current?.noSpacesSession ?? false,
  };
}

function mergeMcp(current: ClawMcpData | undefined): ClawMcpData {
  const servers = current?.servers ?? [];
  const connections = current?.connections ?? [];
  const availability = current?.availability ?? [];
  if (servers.some(server => server.type === SCRIPTED_HUB_IDS.slackSource)) {
    return current ?? { servers, connections, availability };
  }
  return { servers: [...servers, SCRIPTED_SLACK_SERVER], connections, availability };
}

export function seedScriptedHubCatalog(queryClient: QueryClient, userId: string | undefined): void {
  const toolsKey = ['claw-available-tools'] as const;
  const skillsKey = ['claw-skills', userId] as const;
  const kbKey = ['claw-kb-tree'] as const;
  const mcpKey = ['claw-mcp', userId] as const;

  const tools = queryClient.getQueryData<AvailableTools>(toolsKey);
  const nextTools = mergeTools(tools);
  if (nextTools !== tools) queryClient.setQueryData(toolsKey, nextTools);

  const skills = queryClient.getQueryData<Skill[]>(skillsKey);
  const nextSkills = mergeSkills(skills);
  if (nextSkills !== skills) queryClient.setQueryData(skillsKey, nextSkills);

  const kb = queryClient.getQueryData<ClawKnowledgeBaseTree>(kbKey);
  const nextKb = mergeKb(kb);
  if (nextKb !== kb) queryClient.setQueryData(kbKey, nextKb);

  const mcp = queryClient.getQueryData<ClawMcpData>(mcpKey);
  const nextMcp = mergeMcp(mcp);
  if (nextMcp !== mcp) queryClient.setQueryData(mcpKey, nextMcp);
}

export function watchScriptedHubCatalog(
  queryClient: QueryClient,
  userId: string | undefined,
): () => void {
  seedScriptedHubCatalog(queryClient, userId);
  return queryClient.getQueryCache().subscribe(event => {
    const queryKey: readonly unknown[] = Array.isArray(event.query.queryKey)
      ? (event.query.queryKey as readonly unknown[])
      : [];
    const key0 = queryKey[0];
    if (typeof key0 !== 'string') return;
    if (
      key0 === 'claw-available-tools' ||
      key0 === 'claw-skills' ||
      key0 === 'claw-kb-tree' ||
      key0 === 'claw-mcp'
    ) {
      seedScriptedHubCatalog(queryClient, userId);
    }
  });
}
