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

export function nameFromGeneratedPrompt(prompt: string): string {
  const quoted = prompt.match(/You are\s+['"]([^'"]+)['"]/i);
  if (quoted?.[1]) {
    return quoted[1].replace(/[,.]+$/g, '').trim().slice(0, 80);
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
