import { config } from '@/config/env';
import { db } from '@/database/client';
import { decrypt } from '@/services/encryptionService';
import { logger } from '@/utils/logger';
import crypto from 'crypto';

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
  spacesAppId?: string | null;
  spacesAppUserId?: string | null;
}

export interface RunAgentRequest {
  sessionId: string;
  spacesAppId: string;
  agentSlug: string;
  task: string;
  userId: string;
  spacesWorkspaceId: string;
  spacesOrgId: string;
  spacesOrgMemberId: string;
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
    const signingSecret = await resolveAppSigningSecret(req.spacesAppId, req.agentSlug);

    const url = `${config.xyneClaw.clawAuthCallbackUrlAutomation.replace(/\/$/, '')}/app/${encodeURIComponent(req.spacesAppId)}`;
    const payload = {
      sessionId: req.sessionId,
      task: req.task,
      userId: req.userId,
      spacesWorkspaceId: req.spacesWorkspaceId,
      spacesOrgId: req.spacesOrgId,
      spacesOrgMemberId: req.spacesOrgMemberId,
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
        `[claw-client] runAgent rejected — sessionId=${req.sessionId} agentSlug=${req.agentSlug} spacesAppId=${req.spacesAppId} status=${res.status} error=${json.error ?? '∅'}`,
      );
      throw new Error(
        `[claw-client] runAgent: claw rejected the run (HTTP ${res.status}, error=${json.error ?? 'unknown'})`,
      );
    }
    return json;
  }
}

async function resolveAppSigningSecret(spacesAppId: string, agentSlug: string): Promise<string> {
  const app = await db.apps.findUnique({
    where: { id: spacesAppId },
    select: { signingSecret: true },
  });
  if (!app?.signingSecret) {
    throw new Error(
      `[claw-client] runAgent: no app signing secret for agent "${agentSlug}" (spacesAppId=${spacesAppId})`,
    );
  }
  return decrypt(app.signingSecret);
}

async function safeReadText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '<unreadable>';
  }
}

export const clawClient = new ClawClient();

const AGENT_LIST_CACHE_TTL_MS = 60_000;
let agentListCache: { agents: ClawAgent[]; fetchedAt: number } | null = null;

async function listAgentsCached(): Promise<ClawAgent[]> {
  if (agentListCache && Date.now() - agentListCache.fetchedAt < AGENT_LIST_CACHE_TTL_MS) {
    return agentListCache.agents;
  }
  const agents = await clawClient.listAgents();
  agentListCache = { agents, fetchedAt: Date.now() };
  return agents;
}

/**
 * The Spaces app id to dispatch `agentSlug` through for `workspaceId`: the
 * configured one when it belongs to the workspace, else the catalog agent whose
 * app is in the workspace (or its org) when the slug exists in several orgs.
 */
export async function resolveAgentSpacesAppId(
  agentSlug: string,
  workspaceId: string,
  configuredSpacesAppId?: string | null,
): Promise<string> {
  const configured = (configuredSpacesAppId ?? '').trim();
  if (configured) {
    if (await appBelongsToWorkspace(configured, workspaceId)) return configured;
    throw new Error(
      `[RUN_AGENT] configured spacesAppId ${configured} for agent "${agentSlug}" does not belong to workspace ${workspaceId} — re-select the agent in the automation builder`,
    );
  }

  const agents = await listAgentsCached();
  const candidates = agents.filter(a => a.slug === agentSlug && a.spacesAppId);
  if (candidates.length === 0) {
    throw new Error(
      `[RUN_AGENT] agent "${agentSlug}" not found in the claw catalog (disabled, deleted, or never published as a Spaces app)`,
    );
  }
  if (candidates.length === 1) return candidates[0].spacesAppId as string;

  const candidateIds = candidates.map(a => a.spacesAppId as string);
  const apps = await db.apps.findMany({
    where: { id: { in: candidateIds } },
    select: { id: true, workspaceId: true, orgId: true },
  });
  const inWorkspace = apps.filter(a => a.workspaceId === workspaceId);
  if (inWorkspace.length === 1) return inWorkspace[0].id;

  const wsOrgs = await db.workspaceOrganization.findMany({
    where: { workspaceId, leftAt: null },
    select: { orgId: true },
  });
  const orgIds = new Set(wsOrgs.map(w => w.orgId));
  const inOrg = apps.filter(a => orgIds.has(a.orgId));
  if (inOrg.length === 1) return inOrg[0].id;

  throw new Error(
    `[RUN_AGENT] agent slug "${agentSlug}" matches ${candidates.length} agents across orgs and workspace ${workspaceId} does not disambiguate — re-select the agent in the builder so the config pins its spacesAppId`,
  );
}

async function appBelongsToWorkspace(appId: string, workspaceId: string): Promise<boolean> {
  const app = await db.apps.findUnique({
    where: { id: appId },
    select: { workspaceId: true, orgId: true },
  });
  if (!app) return false;
  if (app.workspaceId === workspaceId) return true;
  const member = await db.workspaceOrganization.findFirst({
    where: { workspaceId, orgId: app.orgId, leftAt: null },
    select: { id: true },
  });
  return Boolean(member);
}

/**
 * Queue workers do not have a browser cookie. Resolve the workspace context
 * from Spaces itself and send it as optional metadata, preserving the legacy
 * raw userId field for older Claw deployments.
 */
export async function resolveHeadlessIdentityContext(
  userId: string,
  workspaceId: string,
): Promise<{ spacesWorkspaceId: string; spacesOrgId: string; spacesOrgMemberId: string }> {
  const [workspace, user] = await Promise.all([
    db.workspace.findUnique({ where: { id: workspaceId }, select: { orgId: true } }),
    db.user.findUnique({ where: { id: userId }, select: { orgMemberId: true } }),
  ]);
  if (!workspace?.orgId) {
    throw new Error(`[RUN_AGENT] workspace ${workspaceId} has no organization`);
  }
  if (!user?.orgMemberId) {
    throw new Error(`[RUN_AGENT] user ${userId} has no orgMemberId`);
  }
  return {
    spacesWorkspaceId: workspaceId,
    spacesOrgId: workspace.orgId,
    spacesOrgMemberId: user.orgMemberId,
  };
}
