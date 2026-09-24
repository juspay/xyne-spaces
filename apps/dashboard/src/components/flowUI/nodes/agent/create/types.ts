import type { KbSelection } from '@/services/claw/clawKnowledgeBaseTypes';
import type { AgentToolboxSelection } from '@/services/claw/clawToolsTypes';
import { COLORS, INITIAL_WIZARD_STATE } from '@/routes/ClawAgentsScreen/create/wizardState';

export type AgentCreateField =
  | 'name'
  | 'slug'
  | 'description'
  | 'systemPrompt'
  | 'tools'
  | 'skills'
  | 'knowledge'
  | 'permissionMode';

/** Hub capability row the write pointer should rest on during scripted fills. */
export type AgentCreateHubRow = 'mcp' | 'builtin' | 'subagent' | 'skills' | 'knowledge';

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
    JSON.stringify(form.selectedKbResources) !== JSON.stringify(baseline.selectedKbResources)
  );
}
