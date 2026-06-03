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
    const url = `${this.authUrl}/claw/api/v1/run`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...this.s2sHeaders },
        body: JSON.stringify({
          userId: req.userId,
          userName: req.userName,
          userEmail: req.userEmail,
          task: req.task,
          agentSlug: req.agentSlug,
          provider: 'spaces',
          callbackUrl: req.callbackUrl,
          ...(req.conversationId ? { conversationId: req.conversationId } : {}),
          ...(req.channelId ? { channelId: req.channelId } : {}),
          ...(req.ticketIds?.length ? { ticketIds: req.ticketIds } : {}),
          ...(req.webSearchEnabled ? { webSearchEnabled: true } : {}),
          agentConfig: {
            ...(req.webSearchEnabled ? { webSearchEnabled: 'true' } : {}),
            ...(req.conversationId ? { SPACES_CONVERSATION_ID: req.conversationId } : {}),
          },
        }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      throw new Error(
        `[clawClient] runAgent: failed to reach claw-auth at ${url}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const json = (await res.json().catch(() => ({}))) as RunAgentResponse;
    if (!res.ok || !json.success || !json.sessionId) {
      throw new Error(
        `[clawClient] runAgent: claw rejected the run (HTTP ${res.status}, error=${json.error ?? 'unknown'})`,
      );
    }
    return json;
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
