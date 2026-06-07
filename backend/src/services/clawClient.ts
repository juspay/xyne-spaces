import { randomUUID } from 'crypto';
import { config } from '@/config/env';

export interface ClawAgent {
  id: string;
  slug: string;
  name: string;
  description: string;
  enabled: boolean;
  isDefault: boolean;
  color: string;
  spacesAppUserId?: string | null;
}

export interface RunAgentRequest {
  agentSlug: string;
  task: string;
  userId: string;
  userName: string;
  userEmail: string;
  callbackUrl: string;
  conversationId?: string;
  channelId?: string;
  ticketIds?: string[];
  webSearchEnabled?: boolean;
}

export interface RunAgentResponse {
  success: boolean;
  sessionId?: string;
  error?: string;
}

export interface ConversationInsight {
  reasoning: string | null;
  toolInvocations: unknown[];
}

class ClawClient {
  private get authUrl(): string {
    return config.xyneClaw.authUrl.replace(/\/$/, '');
  }

  private get s2sKey(): string {
    return config.xyneClaw.s2sKey;
  }

  private get s2sHeaders(): Record<string, string> {
    return this.s2sKey ? { 'x-s2s-key': this.s2sKey } : {};
  }

  /** List enabled Claw agents (used to populate the auto-draft agent picker). */
  async listAgents(): Promise<ClawAgent[]> {
    const url = `${this.authUrl}/claw/api/v1/agents`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json', ...this.s2sHeaders },
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      throw new Error(
        `[clawClient] listAgents: failed to reach claw-auth at ${url}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (!res.ok) {
      const body = await safeReadText(res);
      throw new Error(`[clawClient] listAgents: HTTP ${res.status} — ${body}`);
    }

    const json = (await res.json()) as { success: boolean; data?: ClawAgent[]; error?: string };
    if (!json.success || !Array.isArray(json.data)) {
      throw new Error(`[clawClient] listAgents: bad response shape — ${JSON.stringify(json)}`);
    }
    return json.data.filter(a => a.enabled);
  }

  async runAgent(req: RunAgentRequest): Promise<RunAgentResponse> {
    const url = config.xyneClaw.webhookUrl;
    const sessionId = randomUUID();
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...this.s2sHeaders },
        body: JSON.stringify({
          s2sKey: this.s2sKey,
          sessionId,
          agentSlug: req.agentSlug,
          task: req.task,
          userId: req.userId,
          callbackUrl: req.callbackUrl,
          ...(req.conversationId ? { conversationId: req.conversationId } : {}),
          ...(req.channelId ? { channelId: req.channelId } : {}),
        }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      throw new Error(
        `[clawClient] runAgent: failed to reach claw-auth webhook at ${url}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const json = (await res.json().catch(() => ({}))) as RunAgentResponse;
    if (!res.ok || !json.success) {
      throw new Error(
        `[clawClient] runAgent: webhook rejected the run (HTTP ${res.status}, error=${json.error ?? 'unknown'})`,
      );
    }
    return { success: true, sessionId: json.sessionId ?? sessionId };
  }

  async getConversationInsight(params: {
    agentSlug: string;
    conversationId: string;
    userId: string;
  }): Promise<ConversationInsight> {
    const { agentSlug, conversationId, userId } = params;
    const url = `${this.authUrl}/claw/api/v1/agent-chat/${encodeURIComponent(agentSlug)}/chat/${encodeURIComponent(conversationId)}/messages`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json', 'x-user-id': userId, ...this.s2sHeaders },
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      throw new Error(
        `[clawClient] getConversationInsight: failed to reach claw-auth at ${url}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (!res.ok) {
      const body = await safeReadText(res);
      throw new Error(`[clawClient] getConversationInsight: HTTP ${res.status} — ${body}`);
    }

    const json = (await res.json()) as {
      success?: boolean;
      data?: Array<{ id: string; role: string; reasoning?: string | null }>;
      invocationsByMsgId?: Record<string, unknown[]>;
    };
    const messages = Array.isArray(json.data) ? json.data : [];
    const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant');
    const reasoning =
      lastAssistant?.reasoning && lastAssistant.reasoning.trim() ? lastAssistant.reasoning : null;
    const toolInvocations =
      lastAssistant && Array.isArray(json.invocationsByMsgId?.[lastAssistant.id])
        ? (json.invocationsByMsgId![lastAssistant.id] as unknown[])
        : [];
    return { reasoning, toolInvocations };
  }
}

async function safeReadText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '<unreadable>';
  }
}

export const clawClient = new ClawClient();
