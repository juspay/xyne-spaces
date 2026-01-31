import axios from 'axios';
import { apiInstance } from '../clients/apiClient';
import { type ToolOutput } from 'cosmic-ai-genius';

// Re-export ToolOutput type from cosmic-ai-genius for consumers
export type { ToolOutput };

// ============================================================================
// UNIFIED BOT TYPES (for /bots endpoint)
// ============================================================================

export interface UnifiedBotInfo {
  id: string;
  name: string;
  email: string;
  picture?: string | null;
  description?: string;
  scope?: 'conversation' | 'thread' | 'dm' | 'all';
  runtimeType: 'internal' | 'external';
  dbUserId?: string;
  /** Interaction mode - 'dm' for chat-capable bots, 'execute' for background-only bots */
  interactionMode?: 'dm' | 'execute';
}

export interface ListBotsResponse {
  bots: UnifiedBotInfo[];
  totalCount: number;
}

// ============================================================================
// BOT CHAT TYPES (for command palette integration)
// ============================================================================

export interface ChatStreamChunk {
  type: 'content' | 'tool_input' | 'tool_output' | 'message_created' | 'done' | 'error';
  content?: string;
  messageId?: string;
  channelId?: string;
  conversationId?: string;
  toolOutputs?: ToolOutput[];
  // Fields for streaming tool events
  toolName?: string;
  toolInput?: string;
  toolOutput?: ToolOutput; // Single tool output for real-time streaming
  error?: string;
}

// ============================================================================
// SERVICE CLASS
// ============================================================================

export class BotService {
  /**
   * List all available bots from the unified catalog
   */
  async listAllBots(options?: {
    scope?: 'conversation' | 'thread' | 'dm' | 'all';
    q?: string;
  }): Promise<UnifiedBotInfo[]> {
    const params = new URLSearchParams();
    if (options?.scope) params.append('scope', options.scope);
    if (options?.q) params.append('q', options.q);

    const endpoint = params.toString() ? `/bots?${params}` : '/bots';
    const response = await apiInstance.get<{ success: boolean; data: ListBotsResponse }>(endpoint);
    return response.data.data?.bots ?? [];
  }

  /**
   * Get bot info by bot ID
   */
  async getBotInfo(botId: string): Promise<UnifiedBotInfo | null> {
    try {
      const response = await apiInstance.get<{ success: boolean; data: UnifiedBotInfo }>(
        `/bots/${botId}`,
      );
      return response.data.data ?? null;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Consume an SSE stream and collect the full response
   */
  private async _consumeSSEStream(
    url: string,
    body: Record<string, unknown>,
  ): Promise<{
    content: string;
    channelId?: string;
    conversationId?: string;
    toolOutputs?: ToolOutput[];
  }> {
    const contentTypeHeader = 'Content-Type';
    // eslint-disable-next-line local-rules/no-fetch-use-axios
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        [contentTypeHeader]: 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }

    const decoder = new TextDecoder();
    let content = '';
    let channelId: string | undefined;
    let conversationId: string | undefined;
    const toolOutputs: ToolOutput[] = [];
    let buffer = '';
    let done = false;

    while (!done) {
      const result = await reader.read();
      done = result.done;
      if (done) break;

      buffer += decoder.decode(result.value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const chunk = JSON.parse(line.slice(6)) as ChatStreamChunk;

            if (chunk.type === 'message_created') {
              channelId = chunk.channelId;
              conversationId = chunk.conversationId;
            } else if (chunk.type === 'content' && chunk.content) {
              content += chunk.content;
            } else if (chunk.type === 'tool_output' && chunk.toolOutput) {
              toolOutputs.push(chunk.toolOutput);
            } else if (chunk.type === 'error') {
              throw new Error(chunk.error || 'Bot error');
            }
          } catch {
            // Skip malformed JSON lines
          }
        }
      }
    }

    return {
      content,
      ...(channelId !== undefined && { channelId }),
      ...(conversationId !== undefined && { conversationId }),
      toolOutputs,
    };
  }

  /**
   * Chat with a bot and get the full response
   */
  async chatWithBot(
    botId: string,
    message: string,
  ): Promise<{
    content: string;
    channelId?: string;
    conversationId?: string;
    toolOutputs?: ToolOutput[];
  }> {
    const baseUrl = apiInstance.defaults.baseURL || '';
    return this._consumeSSEStream(`${baseUrl}/bots/${botId}/chat`, { message });
  }
}

export const botService = new BotService();
