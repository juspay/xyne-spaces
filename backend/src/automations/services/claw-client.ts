import { config } from '@/config/env';
import { InstalledAppsRepository } from '@/database/repositories/installedAppsRepository';
import { decrypt } from '@/services/encryptionService';
import { logger } from '@/utils/logger';
import crypto from 'crypto';

const installedAppsRepository = new InstalledAppsRepository();

function signWebhookPayload(payload: string, signingSecret: string): string {
  return crypto.createHmac('sha256', signingSecret).update(payload).digest('hex');
}

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
  conversationId?: string;
  channelId?: string;
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
    const agent = await this.getAgentBySlug(req.agentSlug);
    if (!agent) {
      throw new Error(`[claw-client] runAgent: agent "${req.agentSlug}" not found`);
    }
    if (!agent.enabled) {
      throw new Error(`[claw-client] runAgent: agent "${req.agentSlug}" is disabled`);
    }
    const signingSecret = await resolveAgentSigningSecret(agent);

    const url = `${config.xyneClaw.clawAuthCallbackUrlAutomation.replace(/\/$/, '')}/${encodeURIComponent(req.agentSlug)}`;
    const payload = {
      sessionId: req.sessionId,
      task: req.task,
      userId: req.userId,
      callbackUrl: req.callbackUrl,
      ...(req.context ? { context: req.context } : {}),
      ...(req.conversationId ? { conversationId: req.conversationId } : {}),
      ...(req.channelId ? { channelId: req.channelId } : {}),
    };
    const body = JSON.stringify(payload);
    const signature = signWebhookPayload(body, signingSecret);
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Xyne-Signature': signature,
          'X-Source': 'XyneSpaces',
          ...this.s2sHeaders,
        },
        body,
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

async function resolveAgentSigningSecret(agent: ClawAgent): Promise<string> {
  if (!agent.spacesAppUserId) {
    throw new Error(
      `[claw-client] runAgent: agent "${agent.slug}" has no spacesAppUserId; cannot sign webhook`,
    );
  }

  const installedApp = await installedAppsRepository.findFirst({
    where: { userId: agent.spacesAppUserId },
  });
  if (!installedApp?.signingSecret) {
    throw new Error(
      `[claw-client] runAgent: no installed app signing secret for agent "${agent.slug}" app user ${agent.spacesAppUserId}`,
    );
  }

  return decrypt(installedApp.signingSecret);
}

async function safeReadText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '<unreadable>';
  }
}

export const clawClient = new ClawClient();
