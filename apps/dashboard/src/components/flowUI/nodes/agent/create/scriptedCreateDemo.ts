export type ScriptedCreateStep =
  | 'idle'
  | 'identity'
  | 'followup'
  | 'hub'
  | 'dual-control'
  | 'chin'
  | 'done';

export type ScriptedCreateTurn = 'thinA' | 'followup' | 'discover';

export type ScriptedCreateField =
  | 'name'
  | 'slug'
  | 'description'
  | 'systemPrompt'
  | 'tools'
  | 'skills'
  | 'knowledge';

export interface ScriptedChatPatch {
  name?: string;
  slug?: string;
  description?: string;
  systemPrompt?: string;
  tools?: {
    subagents: string[];
    direct: string[];
    custom: string[];
    gateway: string[];
    callableAgents: string[];
  };
  selectedSkillIds?: string[];
  selectedKbScope?: 'COLLECTIONS' | 'USER';
  selectedKbResources?: Array<{ collectionId: string; fileId: string | null }>;
}

export const SCRIPTED_TURNS: Record<ScriptedCreateTurn, string> = {
  thinA: 'I want a standup scribe for the eng team.',
  followup: 'Daily 10am IST',
  discover:
    'Add Slack MCP, the summary tool, the standup-notes skill, and the eng-team knowledge collection.',
};

export const SCRIPTED_REPLIES: Record<ScriptedCreateTurn, string> = {
  thinA:
    "I'll draft a standup scribe for eng — name, handle, description, and instructions. MCP, tools, skills, and knowledge stay empty until you add them.",
  followup: "Daily at 10am IST. I'll put that in the instructions.",
  discover: "I'll attach Slack, the summary tool, standup-notes, and the eng-team collection.",
};

export const SCRIPTED_ASK = 'Daily or weekly?';

export const SCRIPTED_DUAL_CONTROL_REPLY = "I'd call it Standup Clerk instead.";

export const SCRIPTED_IDENTITY = {
  name: 'Eng Standup Scribe',
  slug: 'eng-standup-scribe-demo',
  description: 'Captures daily standups for the eng team.',
  systemPrompt: `You are Eng Standup Scribe. Capture what the eng team shipped, is blocked on, and will do next. Write a short standup digest they can paste into Slack.`,
} as const;

export const SCRIPTED_INSTRUCTIONS_AFTER_FOLLOWUP = `You are Eng Standup Scribe. Capture what the eng team shipped, is blocked on, and will do next. Run daily at 10am IST. Write a short standup digest they can paste into Slack.`;

export const SCRIPTED_USER_NAME = 'Daily Standup Bot';
export const SCRIPTED_CHAT_NAME = 'Standup Clerk';

export const EMPTY_SCRIPTED_TOOLS = {
  subagents: [] as string[],
  direct: [] as string[],
  custom: [] as string[],
  gateway: [] as string[],
  callableAgents: [] as string[],
};

export const SCRIPTED_HUB_IDS = {
  slackService: 'slack',
  slackSource: 'gateway:slack:default',
  slackToolSlug: 'gateway:slack:default:chat_postMessage',
  summarySource: 'scripted-summary',
  summarySlug: 'summary',
  skillId: 'scripted-skill-standup-notes',
  skillSlug: 'standup-notes',
  collectionId: 'scripted-kb-eng-team',
} as const;

export function prefersReducedScriptedMotion(): boolean {
  return (
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export function identityPatch(): ScriptedChatPatch {
  return {
    name: SCRIPTED_IDENTITY.name,
    slug: SCRIPTED_IDENTITY.slug,
    description: SCRIPTED_IDENTITY.description,
    systemPrompt: SCRIPTED_IDENTITY.systemPrompt,
  };
}

export function followupInstructionsPatch(): ScriptedChatPatch {
  return { systemPrompt: SCRIPTED_INSTRUCTIONS_AFTER_FOLLOWUP };
}

export function hubMcpPatch(): ScriptedChatPatch {
  return {
    tools: {
      ...EMPTY_SCRIPTED_TOOLS,
      gateway: [SCRIPTED_HUB_IDS.slackService],
    },
  };
}

export function hubBuiltinPatch(): ScriptedChatPatch {
  return {
    tools: {
      ...EMPTY_SCRIPTED_TOOLS,
      gateway: [SCRIPTED_HUB_IDS.slackService],
      custom: [SCRIPTED_HUB_IDS.summarySlug],
    },
  };
}

export function hubSkillsPatch(): ScriptedChatPatch {
  return { selectedSkillIds: [SCRIPTED_HUB_IDS.skillId] };
}

export function hubKnowledgePatch(): ScriptedChatPatch {
  return {
    selectedKbScope: 'COLLECTIONS',
    selectedKbResources: [{ collectionId: SCRIPTED_HUB_IDS.collectionId, fileId: null }],
  };
}

export function hubRowPatches(): ScriptedChatPatch[] {
  return [hubMcpPatch(), hubBuiltinPatch(), hubSkillsPatch(), hubKnowledgePatch()];
}

export function fieldsForScriptedPatch(patch: ScriptedChatPatch): ScriptedCreateField[] {
  const fields: ScriptedCreateField[] = [];
  if (typeof patch.name === 'string') fields.push('name');
  if (typeof patch.slug === 'string') fields.push('slug');
  if (typeof patch.description === 'string') fields.push('description');
  if (typeof patch.systemPrompt === 'string') fields.push('systemPrompt');
  if (patch.tools) fields.push('tools');
  if (patch.selectedSkillIds) fields.push('skills');
  if (patch.selectedKbResources || patch.selectedKbScope) fields.push('knowledge');
  return fields;
}

export function sliceScriptedPatch(
  patch: ScriptedChatPatch,
  field: ScriptedCreateField,
): ScriptedChatPatch {
  switch (field) {
    case 'name':
      return patch.name !== undefined ? { name: patch.name } : {};
    case 'slug':
      return patch.slug !== undefined ? { slug: patch.slug } : {};
    case 'description':
      return patch.description !== undefined ? { description: patch.description } : {};
    case 'systemPrompt':
      return patch.systemPrompt !== undefined ? { systemPrompt: patch.systemPrompt } : {};
    case 'tools':
      return patch.tools !== undefined ? { tools: patch.tools } : {};
    case 'skills':
      return patch.selectedSkillIds !== undefined
        ? { selectedSkillIds: patch.selectedSkillIds }
        : {};
    case 'knowledge': {
      const next: ScriptedChatPatch = {};
      if (patch.selectedKbScope !== undefined) next.selectedKbScope = patch.selectedKbScope;
      if (patch.selectedKbResources !== undefined) {
        next.selectedKbResources = patch.selectedKbResources;
      }
      return next;
    }
    default:
      return {};
  }
}
