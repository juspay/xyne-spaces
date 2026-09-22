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
  return {
    ...EMPTY_CREATE_FORM,
    name: agent.name ?? '',
    slug,
    slugManual: Boolean(agent.slug?.trim()),
    description: agent.description ?? '',
    systemPrompt: agent.systemPrompt ?? '',
    color: agent.color?.trim() || EMPTY_CREATE_FORM.color,
    tools: toolboxFromCapabilities(agent.capabilities),
  };
}

export function patchFromIdentity(agent: AgentIdentity): AgentCreateChatPatch {
  return {
    name: agent.name,
    slug: agent.slug,
    description: agent.description ?? '',
    systemPrompt: agent.systemPrompt ?? '',
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

/** Prefer explicit name / @handle from the model's chat draft over prompt heuristics. */
export function draftIdentityFromModelReply(visibleReply: string): ParsedDraftIdentity | null {
  const text = visibleReply.replace(/\r\n/g, '\n').trim();
  if (!text) return null;

  const patterns: RegExp[] = [
    /\*\*([^*]+)\*\*\s*\(@([a-z0-9][a-z0-9-]{0,62})\)/i,
    /(?:^|\n)\s*[-*]?\s*(?:\*\*Name\*\*|name)\s*[:\/]\s*([^/\n@]+?)\s*\/\s*@([a-z0-9][a-z0-9-]{0,62})/i,
    /(?:name\/handle|name\s*\/\s*handle)\s*:\s*([^/\n@]+?)\s*\/\s*@([a-z0-9][a-z0-9-]{0,62})/i,
    /(?:^|\n)\s*[-*]?\s*([^\n/@]{2,80}?)\s*\/\s*@([a-z0-9][a-z0-9-]{0,62})\b/i,
    /(?:^|\n)\s*[-*]?\s*([^\n(@]{2,80}?)\s+\(@([a-z0-9][a-z0-9-]{0,62})\)/i,
  ];

  for (const nameRe of patterns) {
    const match = text.match(nameRe);
    if (!match?.[1] || !match[2]) continue;
    const name = cleanDraftLine(match[1], 80);
    const slug = match[2].trim().toLowerCase();
    if (name.length > 0 && slug.length > 0) {
      return { name, slug };
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

function instructionsFromModelReply(visibleReply: string): string {
  const text = visibleReply.replace(/\r\n/g, '\n');
  const block = text.match(
    /(?:^|\n)\s*[-*]?\s*\*\*Instructions\*\*\s*:\s*\n([\s\S]*?)(?:\n\s*\*\*|\n\s*[-*]\s*\*\*|$)/i,
  );
  if (block?.[1]) {
    const body = block[1].trim();
    if (body.length > 0) return body.slice(0, 8000);
  }
  const line = text.match(/(?:^|\n)\s*[-*]?\s*instructions\s*:\s*([^\n]+)/i);
  if (line?.[1]) {
    const compact = cleanDraftLine(line[1], 8000);
    if (compact) return compact;
  }
  return '';
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
      patch.name = explicit.name;
    } else {
      const fromPrompt = nameFromGeneratedPrompt(args.generatedPrompt);
      patch.name = fromPrompt || nameFromIntent(args.intent) || undefined;
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
    patch.systemPrompt = explicit.systemPrompt || args.generatedPrompt || undefined;
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
