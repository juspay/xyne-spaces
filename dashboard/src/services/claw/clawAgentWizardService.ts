import { clawRequest } from './clawRequest';
import type { Agent } from './clawAuthAgentTypes';
import type { KbSelection } from './clawKnowledgeBaseTypes';

// Agent mutations used by the create wizard. The read-only list lives in
// clawAuthAgentsService; these are the write paths (create / configure) plus
// the name-availability check and the AI prompt generator.

/** Debounced availability check for a proposed name + slug. */
export async function checkAgentName(
  name: string,
  slug: string,
): Promise<{ slugAvailable: boolean; nameAvailable: boolean }> {
  const data = await clawRequest<{
    success: boolean;
    data: { slugAvailable: boolean; nameAvailable: boolean };
  }>(`/api/v1/agents/check-name?name=${encodeURIComponent(name)}&slug=${encodeURIComponent(slug)}`);
  return data.data;
}

export interface CreateAgentPayload {
  slug: string;
  name: string;
  description?: string;
  systemPrompt: string;
  color?: string;
  ownerUserId?: string;
  kbScope?: 'COLLECTIONS' | 'USER';
  knowledgeBase?: KbSelection[];
}

/** Create the agent (identity + persona + KB scope/grants). */
export async function createAgent(payload: CreateAgentPayload): Promise<Agent> {
  const data = await clawRequest<{ success: boolean; data: Agent }>('/api/v1/agents', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return data.data;
}

export interface UpdateAgentPayload {
  config?: Record<string, unknown>;
  skills?: string[];
}

/** Attach tools/skills/research config to an existing agent (second create phase). */
export async function updateAgent(slug: string, payload: UpdateAgentPayload): Promise<Agent> {
  const data = await clawRequest<{ success: boolean; data: Agent }>(
    `/api/v1/agents/${encodeURIComponent(slug)}`,
    { method: 'PUT', body: JSON.stringify(payload) },
  );
  return data.data;
}

/**
 * Generate a system prompt from a plain-text intent. The reference frontend
 * calls this with a raw fetch and swallows errors; we route it through
 * `clawRequest` so failures surface (the caller toasts them).
 */
export async function generateAgentPrompt(payload: {
  intent: string;
  agentName?: string;
}): Promise<string> {
  const data = await clawRequest<{ success: boolean; data?: { prompt?: string } }>(
    '/api/v1/agents/generate-prompt',
    { method: 'POST', body: JSON.stringify(payload) },
  );
  return data.data?.prompt ?? '';
}
