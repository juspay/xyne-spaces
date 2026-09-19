export type CreateTurnKind = 'reply' | 'edit' | 'clarify';

export type CreateTurnField =
  | 'name'
  | 'slug'
  | 'description'
  | 'systemPrompt'
  | 'tools'
  | 'skills'
  | 'knowledge';

export interface CreateTurnClassification {
  kind: CreateTurnKind;
  fields: CreateTurnField[];
}

const GREETING =
  /^(hi|hello|hey|yo|sup|howdy|thanks|thank you|thx|ok|okay|cool|great|nice|cheers)[\s!.]*$/i;

const HELP_PREFIX =
  /^(why|what|whats|what's|who|when|where|which|how|explain|can you explain|could you explain|can you tell|could you tell|do you|does this|is this)\b/i;

const FIRST_DESCRIBE =
  /\b(build|create|make)\b.{0,24}\b(agent|bot|scribe|assistant)\b|\bagent that\b|\bshould (post|summarize|draft|fetch|monitor|track|remind|scribe)\b/i;

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
  if (
    /^(please\s+)?(add|drop|remove|attach|enable|disable)\b.{0,40}\b(skill|mcp|tool|integration|server|slack)\b/.test(
      lower,
    )
  ) {
    return true;
  }
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
  if (/\bskill/.test(lower) && !touchesPrompt) return ['skills'];
  if (/\b(mcp|tool|integration|server|slack)\b/.test(lower) && !touchesPrompt) return ['tools'];
  if (/\bdescription\b/.test(lower) && !touchesPrompt) return ['description'];
  if (touchesPrompt) return ['systemPrompt'];
  return ['systemPrompt'];
}

export function classifyCreateTurn(text: string, canvasEmpty: boolean): CreateTurnClassification {
  const trimmed = text.trim();
  if (!trimmed) {
    return { kind: 'clarify', fields: [] };
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
  if (isFirstDescribe(trimmed)) {
    return {
      kind: 'edit',
      fields: ['name', 'slug', 'description', 'systemPrompt', 'tools'],
    };
  }
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length <= 6) {
    return { kind: 'clarify', fields: [] };
  }
  if (canvasEmpty) {
    return {
      kind: 'edit',
      fields: ['name', 'slug', 'description', 'systemPrompt', 'tools'],
    };
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
  if (classification.fields.every(field => field === 'skills')) return false;
  if (classification.fields.includes('systemPrompt')) return true;
  return canvasEmpty;
}

export const FIRST_DESCRIBE_FIELDS: CreateTurnField[] = [
  'name',
  'slug',
  'description',
  'systemPrompt',
  'tools',
];
