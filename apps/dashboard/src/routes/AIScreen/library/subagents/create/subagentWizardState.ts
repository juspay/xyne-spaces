import type { ToolboxSelection } from '@/services/claw/clawToolsTypes';

/** Kebab-case identifier, same rule the create screen and backend enforce. */
export const SUBAGENT_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const DEFAULT_PARAM_NAME = 'question';

export interface SubagentWizardState {
  name: string;
  description: string;
  paramName: string;
  paramDescription: string;
  systemPrompt: string;
  tools: Required<ToolboxSelection>;
  researchAgentProductId: string;
  researchAgentRepositoryId: string;
  progressLabels: string[];
  skillIds: string[];
}

export const INITIAL_SUBAGENT_STATE: SubagentWizardState = {
  name: '',
  description: '',
  paramName: DEFAULT_PARAM_NAME,
  paramDescription: '',
  systemPrompt: '',
  tools: { subagents: [], direct: [], custom: [], gateway: [] },
  researchAgentProductId: '',
  researchAgentRepositoryId: '',
  progressLabels: ['Working…'],
  skillIds: [],
};

/** The name is the permanent identifier, so it is normalized as you type. */
export function normalizeSubagentName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/--+/g, '-');
}

export function subagentNameError(name: string, taken: ReadonlySet<string>): string | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  if (!SUBAGENT_NAME_RE.test(trimmed)) return 'Use lowercase letters, numbers, and hyphens.';
  if (taken.has(trimmed)) return 'That name is already in use.';
  return null;
}
