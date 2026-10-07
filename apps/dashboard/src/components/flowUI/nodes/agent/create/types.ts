import type { KbSelection } from '@/services/claw/clawKnowledgeBaseTypes';
import type {
  AgentToolboxSelection,
  SuggestedIntegration,
  SuggestHub,
} from '@/services/claw/clawToolsTypes';
import { COLORS, INITIAL_WIZARD_STATE } from '@/routes/ClawAgentsScreen/create/wizardState';
import type { CreateSchedule } from './agentSchedule';
import type { CustomProperty } from './customProperty';

export type AgentCreateField =
  | 'name'
  | 'slug'
  | 'description'
  | 'systemPrompt'
  | 'tools'
  | 'skills'
  | 'knowledge'
  | 'permissionMode'
  | 'schedule'
  /** The custom property rows, as one field (chat edits them as a set). */
  | 'properties';

/** Hub capability row the write pointer should rest on while a fill writes it. */
export type AgentCreateHubRow = 'mcp' | 'builtin' | 'subagent' | 'skills' | 'knowledge';

/** Which hub a suggested / dismissed pick belongs to (the suggest-tools hub names). */
export type HubPickKind = SuggestHub;

/**
 * Mid-confidence picks shown as dashed one-click chips. Lives in split-page
 * state, not the form, so it never feeds dirty checks or conflicts.
 */
export interface CreateHubSuggestions {
  /** MCP / gateway integrations, resolved to catalog slugs with tool names. */
  mcp: SuggestedIntegration[];
  /** Built-in tool groups (custom:* sources). */
  builtin: SuggestedIntegration[];
  subagents: Array<{ name: string; confidence: number }>;
  /** Resolved to skill ids. */
  skills: Array<{ id: string; label: string; confidence: number }>;
  /** Resolved to KB collection ids. */
  knowledge: Array<{ id: string; name: string; confidence: number }>;
}

export type AgentCreatePhase = 'empty' | 'loading' | 'draft' | 'created' | 'rejected';

export type AgentPermissionMode = 'ask-first' | 'read-only' | 'can-write';

export interface AgentCreateFormState {
  name: string;
  slug: string;
  slugManual: boolean;
  description: string;
  systemPrompt: string;
  color: string;
  permissionMode: AgentPermissionMode;
  tools: AgentToolboxSelection;
  selectedSkillIds: string[];
  selectedKbScope: 'COLLECTIONS' | 'USER';
  selectedKbResources: KbSelection[];
  /** When the agent runs on its own. Armed as a ScheduledJob after Save. */
  schedule: CreateSchedule | null;
  /** User- or chat-added typed properties, saved on the agent config. */
  customProperties: CustomProperty[];
  /** Model and behaviour set in Settings before the agent exists; merged into its config on Save. */
  settings: Record<string, unknown>;
}

export type AgentCreateChatPatch = Partial<
  Pick<
    AgentCreateFormState,
    | 'name'
    | 'slug'
    | 'description'
    | 'systemPrompt'
    | 'permissionMode'
    | 'tools'
    | 'selectedSkillIds'
    | 'selectedKbScope'
    | 'selectedKbResources'
    | 'schedule'
    | 'customProperties'
  >
>;

export interface AgentCreateConflict {
  field: AgentCreateField;
  chat: AgentCreateChatPatch;
}

export interface AgentCreateCanvasValue {
  name: string;
  slug: string;
  description: string;
  systemPrompt: string;
  permissionMode: AgentPermissionMode;
  selected: string[];
  toolIds: string[];
  skillIds: string[];
  kbScope: 'COLLECTIONS' | 'USER';
  knowledgeBase: KbSelection[];
}

export const EMPTY_TOOLS: AgentToolboxSelection = {
  subagents: [],
  direct: [],
  custom: [],
  gateway: [],
  callableAgents: [],
};

export const EMPTY_CREATE_FORM: AgentCreateFormState = {
  name: '',
  slug: '',
  slugManual: false,
  description: '',
  systemPrompt: '',
  color: COLORS[0],
  permissionMode: 'ask-first',
  tools: EMPTY_TOOLS,
  selectedSkillIds: [],
  selectedKbScope: 'COLLECTIONS',
  selectedKbResources: [],
  schedule: null,
  customProperties: [],
  settings: {},
};

export function formFromWizardDefaults(): AgentCreateFormState {
  return {
    name: INITIAL_WIZARD_STATE.name,
    slug: INITIAL_WIZARD_STATE.slug,
    slugManual: INITIAL_WIZARD_STATE.slugManual,
    description: INITIAL_WIZARD_STATE.description,
    systemPrompt: INITIAL_WIZARD_STATE.systemPrompt,
    color: INITIAL_WIZARD_STATE.color,
    permissionMode: 'ask-first',
    tools: { ...INITIAL_WIZARD_STATE.tools },
    selectedSkillIds: [...INITIAL_WIZARD_STATE.selectedSkillIds],
    selectedKbScope: INITIAL_WIZARD_STATE.selectedKbScope,
    selectedKbResources: [...INITIAL_WIZARD_STATE.selectedKbResources],
    schedule: null,
    customProperties: [],
    settings: {},
  };
}

export function toolIdsFromForm(form: Pick<AgentCreateFormState, 'tools'>): string[] {
  const { tools } = form;
  return [...tools.subagents, ...tools.direct, ...tools.custom, ...tools.gateway];
}

export function toCanvasValue(form: AgentCreateFormState): AgentCreateCanvasValue {
  const toolIds = toolIdsFromForm(form);
  return {
    name: form.name,
    slug: form.slug,
    description: form.description,
    systemPrompt: form.systemPrompt,
    permissionMode: form.permissionMode,
    selected: toolIds,
    toolIds,
    skillIds: form.selectedSkillIds,
    kbScope: form.selectedKbScope,
    knowledgeBase: form.selectedKbResources,
  };
}

export function isFormDirty(form: AgentCreateFormState, baseline: AgentCreateFormState): boolean {
  return (
    form.name !== baseline.name ||
    form.slug !== baseline.slug ||
    form.description !== baseline.description ||
    form.systemPrompt !== baseline.systemPrompt ||
    form.permissionMode !== baseline.permissionMode ||
    JSON.stringify(toolIdsFromForm(form)) !== JSON.stringify(toolIdsFromForm(baseline)) ||
    JSON.stringify(form.selectedSkillIds) !== JSON.stringify(baseline.selectedSkillIds) ||
    form.selectedKbScope !== baseline.selectedKbScope ||
    JSON.stringify(form.selectedKbResources) !== JSON.stringify(baseline.selectedKbResources) ||
    JSON.stringify(form.schedule) !== JSON.stringify(baseline.schedule) ||
    JSON.stringify(form.customProperties) !== JSON.stringify(baseline.customProperties) ||
    JSON.stringify(form.settings) !== JSON.stringify(baseline.settings)
  );
}
