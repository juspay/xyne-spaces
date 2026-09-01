import type { KbSelection } from '@/services/claw/clawKnowledgeBaseTypes';
import type { AgentToolboxSelection } from '@/services/claw/clawToolsTypes';

// Wizard step order + copy. Names track the agent detail screen's tabs
// (Persona / Toolbox / Knowledge) so the two surfaces read consistently.
export const STEPS = ['Identity', 'Persona', 'Toolbox', 'Knowledge', 'Review'] as const;

/** One-line description under the step indicator. */
export const STEP_SUBTITLES: Record<number, string> = {
  0: 'Name your agent, give it a permanent handle, and pick a color.',
  1: 'Define who this agent is — its voice, role, and constraints.',
  2: 'Pick what this agent can do — delegate, act directly, or call out to integrations.',
  3: 'Attach reference material this agent can consult during a task.',
  4: 'Take a last look before creating.',
};

/** Identity color swatches (matches the reference palette). */
export const COLORS = [
  '#6366f1',
  '#8b5cf6',
  '#a855f7',
  '#ec4899',
  '#f43f5e',
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#10b981',
  '#14b8a6',
  '#06b6d4',
  '#3b82f6',
] as const;

/** name → url-safe handle: lowercase, non-alphanumerics to dashes, capped at 40. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

export interface WizardState {
  step: number;

  // Identity
  name: string;
  description: string;
  color: string;
  slug: string;
  slugManual: boolean;

  // Persona
  systemPrompt: string;
  aiIntent: string;

  // Toolbox
  tools: AgentToolboxSelection;
  researchAgentProductId: string;
  researchAgentRepositoryId: string;

  // Knowledge
  selectedSkillIds: string[];
  selectedKbScope: 'COLLECTIONS' | 'USER';
  selectedKbResources: KbSelection[];
}

export const INITIAL_WIZARD_STATE: WizardState = {
  step: 0,
  name: '',
  description: '',
  color: COLORS[0],
  slug: '',
  slugManual: false,
  systemPrompt: '',
  aiIntent: '',
  tools: { subagents: [], direct: [], custom: [], gateway: [], callableAgents: [] },
  researchAgentProductId: '',
  researchAgentRepositoryId: '',
  selectedSkillIds: [],
  selectedKbScope: 'COLLECTIONS',
  selectedKbResources: [],
};

/** Computed slug: the manual override when editing, else derived from the name. */
export function effectiveSlug(state: Pick<WizardState, 'slug' | 'slugManual' | 'name'>): string {
  return state.slugManual ? state.slug : slugify(state.name);
}
