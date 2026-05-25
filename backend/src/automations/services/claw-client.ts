import { config } from '@/config/env';
import { logger } from '@/utils/logger';


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
  sessionId: string;
  agentSlug: string;
  task: string;
  userId: string;
  callbackUrl: string;
  context?: string;
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

  async getAgentBySlug(slug: string): Promise<ClawAgent | null> {
    const url = `${this.authUrl}/claw/api/v1/agents/${encodeURIComponent(slug)}`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json', ...this.s2sHeaders },
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      throw new Error(
        `[claw-client] getAgentBySlug: failed to reach claw-auth at ${url}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (res.status === 404) return null;
    if (!res.ok) {
      const body = await safeReadText(res);
      throw new Error(`[claw-client] getAgentBySlug: HTTP ${res.status} — ${body}`);
    }
    const json = (await res.json()) as { success: boolean; data?: ClawAgent; error?: string };
    if (!json.success || !json.data) {
      throw new Error(`[claw-client] getAgentBySlug: bad response shape — ${JSON.stringify(json)}`);
    }
    return json.data;
  }

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
        `[claw-client] listAgents: failed to reach claw-auth at ${url}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (!res.ok) {
      const body = await safeReadText(res);
      throw new Error(`[claw-client] listAgents: HTTP ${res.status} — ${body}`);
    }

    const json = (await res.json()) as { success: boolean; data?: ClawAgent[]; error?: string };
    if (!json.success || !Array.isArray(json.data)) {
      throw new Error(`[claw-client] listAgents: bad response shape — ${JSON.stringify(json)}`);
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
          sessionId: req.sessionId,
          agentSlug: req.agentSlug,
          task: req.task,
          userId: req.userId,
          callbackUrl: req.callbackUrl,
          ...(req.context ? { context: req.context } : {}),
        }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      throw new Error(
        `[claw-client] runAgent: failed to reach claw-auth at ${url}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const json = (await res.json().catch(() => ({}))) as RunAgentResponse;
    if (!res.ok || !json.success) {
      logger.warn(
        `[claw-client] runAgent rejected — sessionId=${req.sessionId} agentSlug=${req.agentSlug} status=${res.status} error=${json.error ?? '∅'}`,
      );
      throw new Error(
        `[claw-client] runAgent: claw rejected the run (HTTP ${res.status}, error=${json.error ?? 'unknown'})`,
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
