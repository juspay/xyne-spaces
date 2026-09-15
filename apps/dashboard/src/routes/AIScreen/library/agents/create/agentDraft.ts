import type { Agent } from '@/services/claw/clawAuthAgentTypes';
import type { KbSelection } from '@/services/claw/clawKnowledgeBaseTypes';
import type { AgentToolboxSelection } from '@/services/claw/clawToolsTypes';
import {
  INITIAL_WIZARD_STATE,
  type WizardState,
} from '../../../../ClawAgentsScreen/create/wizardState';

interface ConfigShape {
  tools?: {
    subagents?: unknown;
    direct?: unknown;
    custom?: unknown;
    gateway?: unknown;
    callableAgents?: unknown;
  };
  product_id?: unknown;
  repository_id?: unknown;
}

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];

export function readToolSelection(config: Record<string, unknown>): AgentToolboxSelection {
  const tools = (config as ConfigShape).tools ?? {};
  return {
    subagents: strings(tools.subagents),
    direct: strings(tools.direct),
    custom: strings(tools.custom),
    gateway: strings(tools.gateway),
    callableAgents: strings(tools.callableAgents),
  };
}

export function wizardStateFromAgent(agent: Agent): WizardState {
  const config = agent.config ?? {};
  const shape = config as ConfigShape;

  const knowledge: KbSelection[] = (agent.collections ?? []).map(entry => ({
    collectionId: entry.collectionId,
    ...(entry.fileId ? { fileId: entry.fileId } : {}),
  })) as KbSelection[];

  return {
    ...INITIAL_WIZARD_STATE,
    name: agent.name,
    description: agent.description,
    color: agent.color || INITIAL_WIZARD_STATE.color,
    slug: agent.slug,
    slugManual: true,
    systemPrompt: agent.systemPrompt ?? '',
    tools: readToolSelection(config),
    researchAgentProductId: typeof shape.product_id === 'string' ? shape.product_id : '',
    researchAgentRepositoryId: typeof shape.repository_id === 'string' ? shape.repository_id : '',
    selectedSkillIds: (agent.skills ?? []).map(entry => entry.skillId),
    selectedKbScope: agent.kbScope === 'USER' ? 'USER' : 'COLLECTIONS',
    selectedKbResources: knowledge,
  };
}
