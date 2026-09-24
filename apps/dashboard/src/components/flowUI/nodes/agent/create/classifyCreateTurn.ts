import {
  inferNeededCapabilities,
  inferredCapabilityFields,
  intentImpliesBuiltin,
  intentImpliesMcp,
  intentImpliesSubagent,
} from './capabilityInference.ts';

export type CreateTurnKind = 'reply' | 'edit' | 'clarify' | 'intake';

export type CreateTurnField =
  | 'name'
  | 'slug'
  | 'description'
  | 'systemPrompt'
  | 'tools'
  | 'skills'
  | 'knowledge';

export type IntakeGap = 'audience' | 'io' | 'format' | 'tools' | 'constraints';

export type DescribePlan = 'ask' | 'draft-then-ask' | 'draft' | 'none';

export interface CreateTurnClassification {
  kind: CreateTurnKind;
  fields: CreateTurnField[];
  askAfter?: boolean;
}

export const IDENTITY_FIELDS: CreateTurnField[] = ['name', 'slug', 'description', 'systemPrompt'];

/** First-draft identity fields. Hub rows append when the request implies them. */
export const FIRST_DESCRIBE_FIELDS: CreateTurnField[] = IDENTITY_FIELDS;

/**
 * Hub capabilities implied by the user request / job semantics.
 * Named product nouns OR soft job cues (standup→Slack, research→builtin).
 * Order: tools (MCP / builtin / subagent) → skills → knowledge.
 */
export function namedCapabilityFields(text: string): CreateTurnField[] {
  return inferredCapabilityFields(text);
}

/** Preferred Hub row when tools are implied (MCP vs builtin vs subagent). */
export function preferredToolsHubRow(text: string): 'mcp' | 'builtin' | 'subagent' {
  if (intentImpliesSubagent(text)) return 'subagent';
  const mcpCue = intentImpliesMcp(text);
  const builtinCue = intentImpliesBuiltin(text);
  if (builtinCue && !mcpCue) return 'builtin';
  return 'mcp';
}

export { inferNeededCapabilities, inferredCapabilityFields };

export function firstDraftFields(text: string): CreateTurnField[] {
  return [...IDENTITY_FIELDS, ...namedCapabilityFields(text)];
}

const GREETING =
  /^(hi|hello|hey|yo|sup|howdy|thanks|thank you|thx|ok|okay|cool|great|nice|cheers)[\s!.]*$/i;

const HELP_PREFIX =
  /^(why|what|whats|what's|who|when|where|which|how|explain|can you explain|could you explain|can you tell|could you tell|do you|does this|is this)\b/i;

const FIRST_DESCRIBE =
  /\b(build|create|make)\b.{0,24}\b(agent|bot|scribe|assistant)\b|\bagent that\b|\bshould (post|summarize|draft|fetch|monitor|track|remind|scribe)\b/i;

const JOB_VERB =
  /\b(post|posts|summarize|summarizes|fetch|fetches|monitor|track|remind|draft|scribe|triage|review|translate|schedule|notify|digest|watch|parse|extract|compile)\b/i;

const SKIP_INTAKE =
  /^(skip(\s+(that|this|those|the questions)?)?|just draft|go ahead|you pick|fill (it|the canvas)|draft it|n\/?a|nah|never mind|i'?ll (do|fill) it( myself)?|edit (it )?myself|no thanks)[\s!.]*$/i;

export function parseLocalRename(text: string): string | null {
  const match = text
    .trim()
    .match(
      /^(?:please\s+)?(?:can you\s+|could you\s+)?(?:rename(?:\s+it)?|call it|name it|change (?:the )?(?:name|handle) to)\s+["']?(.+?)["']?\s*\??$/i,
    );
  const name = match?.[1]?.trim();
  if (!name) return null;
  if (/^(it|this|that|the agent)$/i.test(name)) return null;
  return name.slice(0, 80);
}

export function isSkipIntake(text: string): boolean {
  return SKIP_INTAKE.test(text.trim());
}

export function isIntakeProceed(text: string): boolean {
  return isSkipIntake(text) || /^(ok|okay|sure|yep|yes)[\s!.]*$/i.test(text.trim());
}

function isQuestion(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.endsWith('?')) return true;
  return HELP_PREFIX.test(trimmed);
}

function isHelpQuestion(text: string): boolean {
  if (!isQuestion(text)) return false;
  if (parseLocalRename(text)) return false;
  const lower = text.trim().toLowerCase();
  if (
    /^(can you|could you|please)\s+(rename|rewrite|shorten|make|add|drop|remove|attach)\b/.test(
      lower,
    )
  ) {
    return false;
  }
  if (HELP_PREFIX.test(text.trim()) && !isCanvasEditImperative(lower)) {
    return true;
  }
  return !isCanvasEditImperative(lower);
}

/** Imperative capability edits: add/use/pick/choose MCP, skill, knowledge, etc. */
function isCapabilityEditImperative(lower: string): boolean {
  // "how do I add MCP?" stays help, not a canvas patch.
  if (/^(how|what|where|which|why)\b/.test(lower)) return false;
  return /\b(add|drop|remove|attach|enable|disable|choose|use|pick|select|grant)\b.{0,48}\b(skills?|mcps?|tools?|integrations?|servers?|sub-?agents?|knowledge(?:\s+base)?|\bkb\b|slack|github|jira|notion|linear|gmail)\b/.test(
    lower,
  );
}

function isCanvasEditImperative(lower: string): boolean {
  if (/\b(rename|call it|name it)\b/.test(lower)) return true;
  if (
    /\b(make|rewrite|shorten|tighten|expand|lengthen)\b.{0,40}\b(instruction|prompt|description)\b/.test(
      lower,
    )
  ) {
    return true;
  }
  if (/\b(instruction|prompt).{0,24}\b(shorter|longer|tighter)\b/.test(lower)) return true;
  if (isCapabilityEditImperative(lower)) return true;
  return false;
}

function isFirstDescribe(text: string): boolean {
  const trimmed = text.trim();
  if (isHelpQuestion(trimmed)) return false;
  if (FIRST_DESCRIBE.test(trimmed)) return true;
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (!isQuestion(trimmed) && (words.length >= 8 || trimmed.length >= 40)) return true;
  return false;
}

function fieldsForExplicitEdit(text: string): CreateTurnField[] {
  const lower = text.toLowerCase();
  if (parseLocalRename(text)) return ['name', 'slug'];
  const touchesName = /\b(name|handle|rename|call it)\b/.test(lower);
  const touchesPrompt =
    /\b(instruction|prompt)\b/.test(lower) || /\b(shorter|longer|tighten|rewrit)/.test(lower);
  if (touchesName && touchesPrompt) return ['name', 'slug', 'systemPrompt'];
  if (touchesName) return ['name', 'slug'];
  const caps = namedCapabilityFields(text);
  if (caps.length > 0 && !touchesPrompt) return caps;
  if (/\bskill/.test(lower) && !touchesPrompt) return ['skills'];
  if (
    /\b(mcp|tool|integration|server|slack|github|jira|notion|linear|gmail)\b/.test(lower) &&
    !touchesPrompt
  ) {
    return ['tools'];
  }
  if (
    /\bknowledge(?:\s+base)?\b|\bkb\b/.test(lower) &&
    !touchesPrompt
  ) {
    return ['knowledge'];
  }
  if (/\bdescription\b/.test(lower) && !touchesPrompt) return ['description'];
  if (touchesPrompt) return ['systemPrompt'];
  return ['systemPrompt'];
}

export function detectIntakeGaps(text: string): IntakeGap[] {
  const lower = text.toLowerCase();
  const gaps: IntakeGap[] = [];
  if (
    !/\b(for|team|users?|engineers?|designers?|managers?|audience|customers?|who|sales|support)\b/.test(
      lower,
    )
  ) {
    gaps.push('audience');
  }
  const reads =
    /\b(read|reads|from|fetch|watch|listen|input|inbox|calendar|github|jira|docs?|notion|email|transcript)\b/.test(
      lower,
    );
  const writes = /\b(write|post|send|draft|create|update|output|reply|notify)\b/.test(lower);
  if (!reads && !writes) {
    gaps.push('io');
  }
  if (
    !/\b(format|summary|summaries|bullet|json|table|digest|report|message|thread|email|slack)\b/.test(
      lower,
    )
  ) {
    gaps.push('format');
  }
  if (!/\b(mcp|tool|skill|slack|github|jira|notion|calendar|linear|gmail)\b/.test(lower)) {
    gaps.push('tools');
  }
  if (
    !/\b(never|must not|don't|do not|only|constraint|unless|approve|ask first|without)\b/.test(
      lower,
    )
  ) {
    gaps.push('constraints');
  }
  return gaps;
}

/** Bare create asks with no job — ask first, do not draft. */
export function isVagueAgentCreate(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  // "make an agent", "create a bot", "I want an assistant" — no job noun.
  if (
    !/^(please\s+)?(can you\s+|could you\s+)?(make|create|build|i want|i need)\b.{0,48}\b(an?\s+)?(agent|bot|assistant)\b\.?$/i.test(
      trimmed,
    )
  ) {
    return false;
  }
  // A concrete role/job word means it is specific enough to draft.
  if (JOB_VERB.test(trimmed)) return false;
  if (
    /\b(standup|stand-up|scribe|triage|reviewer|digest|monitor|onboarding|support|sales|billing|hr|legal|security|pr|pull.?request|release|notes?|calendar|inbox|email|slack|jira|github)\b/i.test(
      trimmed,
    )
  ) {
    return false;
  }
  return true;
}

export function planDescribe(text: string): DescribePlan {
  const trimmed = text.trim();
  if (!trimmed) return 'none';
  const words = trimmed.split(/\s+/).filter(Boolean);
  const gaps = detectIntakeGaps(trimmed);
  const specified = 5 - gaps.length;
  const hasJob = JOB_VERB.test(trimmed) || /\bagent that\b/i.test(trimmed);
  const agentRequest = FIRST_DESCRIBE.test(trimmed) || hasJob;
  if (!agentRequest && words.length < 8) {
    return 'none';
  }
  if (isVagueAgentCreate(trimmed)) return 'ask';
  if (words.length <= 6 && !hasJob && !/\b(standup|scribe|triage|digest|monitor)\b/i.test(trimmed)) {
    return 'ask';
  }
  if (/^(make|create|build|i want)\b.{0,48}\b(an?\s+)?(agent|bot|assistant)\b\.?$/i.test(trimmed)) {
    if (isVagueAgentCreate(trimmed)) return 'ask';
  }
  if (hasJob && specified >= 2) return 'draft-then-ask';
  if (hasJob && words.length >= 12 && specified >= 1) return 'draft-then-ask';
  if (words.length >= 24 && specified >= 3) {
    return gaps.length === 0 ? 'draft' : 'draft-then-ask';
  }
  if (words.length >= 20) return 'draft-then-ask';
  // Named short job ("build a standup agent") → draft.
  if (FIRST_DESCRIBE.test(trimmed) && !isVagueAgentCreate(trimmed)) return 'draft';
  return 'ask';
}

export const INTAKE_GAP_ORDER: IntakeGap[] = ['audience', 'io', 'format', 'tools', 'constraints'];

export const INTAKE_QUESTION: Record<IntakeGap, string> = {
  audience: 'Who is this for?',
  io: 'What should it read, and what should it write?',
  format: 'What should the output look like?',
  tools: 'Any tools or MCP servers it should use?',
  constraints: 'Anything it must never do?',
};

export function questionsForGaps(gaps: IntakeGap[], max = 3): string[] {
  return INTAKE_GAP_ORDER.filter(gap => gaps.includes(gap))
    .slice(0, max)
    .map(gap => INTAKE_QUESTION[gap]);
}

export function classifyCreateTurn(
  text: string,
  canvasEmpty: boolean,
  options?: { intakePending?: boolean },
): CreateTurnClassification {
  const trimmed = text.trim();
  if (!trimmed) {
    return { kind: 'clarify', fields: [] };
  }
  if (options?.intakePending && canvasEmpty) {
    if (isSkipIntake(trimmed) || /^(ok|okay|sure|yep|yes)[\s!.]*$/i.test(trimmed)) {
      return { kind: 'edit', fields: firstDraftFields(trimmed) };
    }
    if (GREETING.test(trimmed) || isHelpQuestion(trimmed)) {
      return { kind: 'reply', fields: [] };
    }
    if (parseLocalRename(trimmed)) {
      return { kind: 'edit', fields: ['name', 'slug'] };
    }
    if (isCanvasEditImperative(trimmed.toLowerCase())) {
      return { kind: 'edit', fields: fieldsForExplicitEdit(trimmed) };
    }
    return { kind: 'edit', fields: firstDraftFields(trimmed) };
  }
  if (GREETING.test(trimmed)) {
    return { kind: 'reply', fields: [] };
  }
  if (parseLocalRename(trimmed)) {
    return { kind: 'edit', fields: ['name', 'slug'] };
  }
  if (isHelpQuestion(trimmed)) {
    return { kind: 'reply', fields: [] };
  }
  if (isCanvasEditImperative(trimmed.toLowerCase())) {
    return { kind: 'edit', fields: fieldsForExplicitEdit(trimmed) };
  }
  if (isFirstDescribe(trimmed) || (canvasEmpty && planDescribe(trimmed) !== 'none')) {
    if (canvasEmpty && (isVagueAgentCreate(trimmed) || planDescribe(trimmed) === 'ask')) {
      return { kind: 'clarify', fields: [] };
    }
    return { kind: 'edit', fields: firstDraftFields(trimmed) };
  }
  // Filled-canvas capability follow-ups ("use Slack MCP") even without verbs.
  if (!canvasEmpty) {
    const caps = namedCapabilityFields(trimmed);
    if (caps.length > 0 && !isHelpQuestion(trimmed)) {
      return { kind: 'edit', fields: caps };
    }
  }
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length <= 6) {
    return { kind: 'clarify', fields: [] };
  }
  if (canvasEmpty) {
    return { kind: 'edit', fields: firstDraftFields(trimmed) };
  }
  return { kind: 'clarify', fields: [] };
}

export function shouldGeneratePrompt(
  classification: CreateTurnClassification,
  canvasEmpty: boolean,
  text: string,
): boolean {
  if (classification.kind !== 'edit') return false;
  if (parseLocalRename(text)) return false;
  if (
    (classification.fields.includes('tools') || classification.fields.includes('knowledge')) &&
    !classification.fields.includes('systemPrompt')
  ) {
    return true;
  }
  if (classification.fields.every(field => field === 'skills')) return false;
  if (classification.fields.includes('systemPrompt')) return true;
  return canvasEmpty;
}
