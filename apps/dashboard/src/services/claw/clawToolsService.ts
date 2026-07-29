import { clawRequest } from './clawRequest';
import type { AvailableTools, ToolSuggestion } from './clawToolsTypes';

/** The full tool catalog (subagents, MCP tools, write tools, custom groups). */
export async function getAvailableTools(): Promise<AvailableTools> {
  const data = await clawRequest<{ success: boolean; data: AvailableTools }>(
    '/api/v1/tools/available',
  );
  return data.data;
}

/** AI-suggested starter toolkit from the agent's persona / description. */
export async function suggestTools(payload: {
  systemPrompt?: string | undefined;
  description?: string | undefined;
}): Promise<ToolSuggestion> {
  const data = await clawRequest<{ success: boolean; data: ToolSuggestion }>(
    '/api/v1/agents/suggest-tools',
    { method: 'POST', body: JSON.stringify(payload) },
  );
  return data.data;
}
