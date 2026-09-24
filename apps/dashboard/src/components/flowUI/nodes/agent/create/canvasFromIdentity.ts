import type { AgentCapability, AgentIdentity } from '@xyne/shared';
import { slugify } from '@/routes/ClawAgentsScreen/create/wizardState';
import type { AgentToolboxSelection } from '@/services/claw/clawToolsTypes';
import type { AgentCreateChatPatch, AgentCreateFormState } from './types';
import { EMPTY_CREATE_FORM, EMPTY_TOOLS } from './types';

export function toolboxFromCapabilities(
  capabilities: readonly AgentCapability[] | undefined,
): AgentToolboxSelection {
  const tools: AgentToolboxSelection = {
    subagents: [],
    direct: [],
    custom: [],
    gateway: [],
    callableAgents: [],
  };
  for (const capability of capabilities ?? []) {
    const id = capability.id.trim();
    if (!id) continue;
    if (capability.kind === 'subagent') {
      tools.subagents.push(id);
    } else if (id.startsWith('gateway:')) {
      tools.gateway.push(id);
    } else if (id.includes('__')) {
      tools.direct.push(id);
    } else {
      tools.custom.push(id);
    }
  }
  return tools;
}

export function formFromIdentity(agent: AgentIdentity): AgentCreateFormState {
  const slug = agent.slug?.trim() || slugify(agent.name);
  const permissionRow = agent.details?.find(row => /permission/i.test(row.label));
  const permissionMode =
    permissionRow?.value === 'Read only'
      ? 'read-only'
      : permissionRow?.value === 'Can write'
        ? 'can-write'
        : 'ask-first';
  return {
    ...EMPTY_CREATE_FORM,
    name: agent.name ?? '',
    slug,
    slugManual: Boolean(agent.slug?.trim()),
    description: agent.description ?? '',
    systemPrompt: agent.systemPrompt ?? '',
    color: agent.color?.trim() || EMPTY_CREATE_FORM.color,
    permissionMode,
    tools: toolboxFromCapabilities(agent.capabilities),
  };
}

export function patchFromIdentity(agent: AgentIdentity): AgentCreateChatPatch {
  const form = formFromIdentity(agent);
  return {
    name: agent.name,
    slug: agent.slug,
    description: agent.description ?? '',
    systemPrompt: agent.systemPrompt ?? '',
    permissionMode: form.permissionMode,
    tools: toolboxFromCapabilities(agent.capabilities),
  };
}

export interface ParsedDraftIdentity {
  name: string;
  slug: string;
}

export interface ParsedModelDraft {
  name?: string;
  slug?: string;
  description?: string;
  systemPrompt?: string;
}

function cleanDraftLine(value: string, max = 500): string {
  return value
    .replace(/\*\*/g, '')
    .replace(/[,.]+$/g, '')
    .trim()
    .slice(0, max);
}

/** Strip list markers and "Name:" labels from canvas identity fields. */
export function sanitizeAgentCanvasName(raw: string): string {
  let value = raw.replace(/\*\*/g, '').replace(/\*/g, '').trim();
  value = value.replace(/^[-•]+\s*/, '').trim();
  while (/^\*?\s*name\s*:?\s*/i.test(value)) {
    value = value.replace(/^\*?\s*name\s*:?\s*/i, '').trim();
  }
  value = value.replace(/^handle\s*:?\s*/i, '').trim();
  return cleanDraftLine(value, 80);
}

/** Prefer explicit name / @handle from the model's chat draft over prompt heuristics. */
export function draftIdentityFromModelReply(visibleReply: string): ParsedDraftIdentity | null {
  const text = visibleReply.replace(/\r\n/g, '\n').trim();
  if (!text) return null;

  const patterns: RegExp[] = [
    /(?:^|\n)\s*[-*]?\s*(?:\*\*)?Name\s*\/\s*handle(?:\*\*)?\s*:\s*([^/\n@]+?)\s*\/\s*@([a-z0-9][a-z0-9-]{0,62})\b/i,
    /(?:^|\n)\s*[-*]?\s*(?:\*\*)?Name(?:\*\*)?\s*:\s*([^/\n(@]+?)\s*\(@([a-z0-9][a-z0-9-]{0,62})\)/i,
    /\*\*([^*]+)\*\*\s*\(@([a-z0-9][a-z0-9-]{0,62})\)/i,
    /(?:^|\n)\s*[-*]?\s*(?:\*\*Name\*\*|name)\s*[:\/]\s*([^/\n@]+?)\s*\/\s*@([a-z0-9][a-z0-9-]{0,62})/i,
    /(?:name\/handle|name\s*\/\s*handle)\s*:\s*([^/\n@]+?)\s*\/\s*@([a-z0-9][a-z0-9-]{0,62})/i,
    /(?:^|\n)\s*[-*]?\s*([^\n/@]{2,80}?)\s*\/\s*@([a-z0-9][a-z0-9-]{0,62})\b/i,
    /(?:^|\n)\s*[-*]?\s*([^\n(@]{2,80}?)\s+\(@([a-z0-9][a-z0-9-]{0,62})\)/i,
  ];

  for (const nameRe of patterns) {
    const match = text.match(nameRe);
    if (!match?.[1] || !match[2]) continue;
    const name = sanitizeAgentCanvasName(match[1]);
    const slug = match[2].trim().toLowerCase();
    if (name.length > 0 && slug.length > 0) {
      return { name, slug };
    }
  }

  const nameLine = text.match(
    /(?:^|\n)\s*[-*•]?\s*(?:\*\*)?Name(?:\*\*)?\s*:\s*([^\n@/]+)/i,
  );
  if (nameLine?.[1]) {
    const name = sanitizeAgentCanvasName(nameLine[1]);
    if (name.length > 0) {
      return { name, slug: slugify(name) };
    }
  }

  const titledDraft = text.match(/\byour\s+\*\*([^*]+)\*\*\s+draft\b/i);
  if (titledDraft?.[1]) {
    const name = sanitizeAgentCanvasName(titledDraft[1]);
    if (name.length > 0) {
      return { name, slug: slugify(name) };
    }
  }

  return null;
}

function descriptionFromModelReply(visibleReply: string): string {
  const text = visibleReply.replace(/\r\n/g, '\n');
  const patterns = [
    /(?:^|\n)\s*[-*]?\s*\*\*Description\*\*\s*:\s*([^\n]+)/i,
    /(?:^|\n)\s*[-*]?\s*description\s*:\s*([^\n]+)/i,
  ];
  for (const re of patterns) {
    const match = text.match(re);
    if (match?.[1]) {
      const line = cleanDraftLine(match[1], 300);
      if (line) return line;
    }
  }
  return '';
}

function sectionBody(text: string, label: string): string {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const block = text.match(
    new RegExp(
      `(?:^|\\n)\\s*[-*•]?\\s*\\*?\\*?${escaped}\\*?\\*?\\s*:\\s*\\n([\\s\\S]*?)(?=\\n\\s*[-*•]?\\s*\\*?\\*?(?:Name|Handle|Description|Instructions|Rules|MCP|Tools|Skills|Knowledge)\\*?\\*?\\s*:|$)`,
      'i',
    ),
  );
  if (block?.[1]?.trim()) {
    return block[1].trim().slice(0, 8000);
  }
  const sameLine = text.match(
    new RegExp(`(?:^|\\n)\\s*[-*•]?\\s*\\*?\\*?${escaped}\\*?\\*?\\s*:\\s*([^\\n]+)`, 'i'),
  );
  if (sameLine?.[1]) {
    return cleanDraftLine(sameLine[1], 8000);
  }
  return '';
}

function instructionsFromModelReply(visibleReply: string): string {
  const text = visibleReply.replace(/\r\n/g, '\n');
  const instructions = sectionBody(text, 'Instructions');
  const rules = sectionBody(text, 'Rules');
  if (instructions && rules) {
    return `${instructions}\n\nRules:\n${rules}`.slice(0, 8000);
  }
  return instructions || rules;
}

/** Last-resort system prompt when generate-prompt fails and the model did not state instructions. */
export function fallbackPromptFromIntent(intent: string): string {
  const name = nameFromIntent(intent) || 'this agent';
  const job = descriptionFromIntent(intent);
  const role = job
    ? `You are ${name}. ${job} Be clear, concise, and actionable.`
    : `You are ${name}. Help the user with their request. Be clear, concise, and actionable.`;
  return `${role}

## Operational Workflow
1. Clarify the request if it is ambiguous.
2. Do the work using granted tools.
3. Reply with the result in the expected format.

## Guardrails
Never invent facts. Do not take irreversible actions without asking first.
`;
}

/** Fields the model stated explicitly in the visible reply (not XYNE_CREATE_DRAFT intent). */
export function draftFromModelReply(visibleReply: string): ParsedModelDraft {
  const identity = draftIdentityFromModelReply(visibleReply);
  const description = descriptionFromModelReply(visibleReply);
  const systemPrompt = instructionsFromModelReply(visibleReply);
  return {
    ...(identity ? { name: identity.name, slug: identity.slug } : {}),
    ...(description ? { description } : {}),
    ...(systemPrompt ? { systemPrompt } : {}),
  };
}

export function buildDraftCanvasPatch(args: {
  visibleReply: string;
  intent: string;
  generatedPrompt: string;
  fillDescription: boolean;
  fillName: boolean;
  fillSlug: boolean;
  fillInstructions: boolean;
}): ParsedModelDraft {
  const explicit = draftFromModelReply(args.visibleReply);
  const patch: ParsedModelDraft = {};

  if (args.fillName) {
    if (explicit.name) {
      patch.name = sanitizeAgentCanvasName(explicit.name);
    } else {
      const fromPrompt = nameFromGeneratedPrompt(args.generatedPrompt);
      const raw = fromPrompt || nameFromIntent(args.intent) || '';
      patch.name = raw ? sanitizeAgentCanvasName(raw) : undefined;
    }
  }
  if (args.fillSlug) {
    if (explicit.slug) {
      patch.slug = explicit.slug;
    } else if (explicit.name) {
      patch.slug = slugify(explicit.name);
    } else if (patch.name) {
      patch.slug = slugify(patch.name);
    }
  }
  if (args.fillDescription) {
    patch.description = explicit.description || descriptionFromIntent(args.intent) || undefined;
  }
  if (args.fillInstructions) {
    // Prefer the dedicated generate-prompt result; fall back to anything the model
    // stated in chat (Instructions/Rules), then a minimal intent-derived prompt.
    patch.systemPrompt =
      args.generatedPrompt.trim() ||
      explicit.systemPrompt ||
      fallbackPromptFromIntent(args.intent) ||
      undefined;
  }

  return patch;
}

export function nameFromGeneratedPrompt(prompt: string): string {
  const quoted = prompt.match(/You are\s+['"]([^'"]+)['"]/i);
  if (quoted?.[1]) {
    return quoted[1]
      .replace(/[,.]+$/g, '')
      .trim()
      .slice(0, 80);
  }
  const bare = prompt.match(/You are\s+([A-Z][\w][\w\s-]{0,40}?)(?:,|\.| —| -|\s+an?\s)/);
  if (bare?.[1]) {
    return bare[1].trim().slice(0, 80);
  }
  return '';
}

export function nameFromIntent(intent: string): string {
  const words = intent
    .replace(/[^\p{L}\p{N}\s-]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4);
  if (words.length === 0) return '';
  return words
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
    .slice(0, 80);
}

export function descriptionFromIntent(intent: string): string {
  const compact = intent.replace(/\s+/g, ' ').trim();
  if (!compact) return '';
  const sentence = compact.split(/(?<=[.!?])\s+/)[0] ?? compact;
  return sentence.slice(0, 300);
}

export { EMPTY_TOOLS };
