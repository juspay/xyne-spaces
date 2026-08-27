/**
 * The one Slack run-dispatch path — mentions, DMs and slash commands all go
 * through here so provider resolution, session ctx and the result callback
 * can never drift apart per entry point (the phase-4 parity lesson).
 */
import { isAgentInvocableBy } from "xyne-claw-shared";
import { CONFIG } from "../../config.js";
import { resolveAgentProviderConfigs, resolveSubagentProviderMode } from "../../lib/agent-provider-config.js";
import { setSession } from "../../lib/session-context.js";
import { fetch as httpFetch } from "undici";

export interface BoundSlackSurfaceAgent {
  id: string;
  commandName: string | null;
  /** Connection whose bot token answers this agent's slash commands. */
  commandConnectedSurfaceId: string | null;
  config: unknown;
  agent: {
    id: string;
    slug: string;
    name: string;
    orgId: string;
    config: unknown;
  };
}

export function slackConversationId(teamId: string, channelId: string, threadRootTs: string): string {
  return `slack-${teamId}-${channelId}-${threadRootTs.replace(/\./g, "_")}`;
}

/**
 * Make the built-in Slack subagent available for runs originating on Slack.
 * This creates a per-run copy and never mutates the stored agent config.
 *
 * A missing tools object means the agent is unrestricted, so adding one here
 * would accidentally turn that agent into a Slack-only allowlist.
 */
function withSlackSubagentInjected(config: unknown): unknown {
  if (!config || typeof config !== "object") return config;
  const base = config as Record<string, unknown>;
  const tools = base["tools"];
  if (!tools || typeof tools !== "object") return config;

  const toolsObj = tools as Record<string, unknown>;
  const current = Array.isArray(toolsObj["subagents"])
    ? (toolsObj["subagents"] as unknown[]).filter((value): value is string => typeof value === "string")
    : [];
  if (current.includes("slack")) return config;

  return { ...base, tools: { ...toolsObj, subagents: [...current, "slack"] } };
}

/**
 * The one Slack run-dispatch path — mentions, DMs, and slash commands all go
 * through here so provider resolution, the session ctx, and the result
 * callback can never drift apart per entry point (the phase-4 parity lesson).
 */

export async function dispatchSlackRun(input: {
  agent: { id: string; slug: string; orgId: string; config: unknown };
  surfaceAgentId: string;
  /** Slash-command runs reply via the umbrella app's bot token. */
  connectedSurfaceId?: string;
  userId: string;
  task: string;
  conversationId: string;
  eventType: "APP_MENTIONED" | "DIRECT_MESSAGE";
  idempotencyKey: string;
  teamId: string;
  channelId: string;
  threadRootTs: string;
  slackUserId: string;
  sourceMessageId?: string;
}): Promise<string> {
  // Invocation whitelist — Slack surface. The /internal/run backstop also
  // enforces this, but gating here fails fast with a clear reason before the
  // dispatch round-trip. The linked Spaces userId is the caller identity.
  if (!isAgentInvocableBy(input.agent.config as Record<string, unknown> | null, input.userId)) {
    throw new Error(`agent "${input.agent.slug}" is restricted — you don't have access to it`);
  }

  const slackDelivery = {
    surfaceAgentId: input.surfaceAgentId,
    ...(input.connectedSurfaceId ? { connectedSurfaceId: input.connectedSurfaceId } : {}),
    teamId: input.teamId,
    channelId: input.channelId,
    threadTs: input.threadRootTs,
    slackUserId: input.slackUserId,
  };
  const providers = await resolveAgentProviderConfigs({
    id: input.agent.id,
    config: input.agent.config,
  });
  const effectiveAgentConfig = withSlackSubagentInjected(input.agent.config);
  const response = await httpFetch(`${CONFIG.internalUrl}/claw/api/v1/internal/run`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(CONFIG.xyneClawS2sKey ? { "x-s2s-key": CONFIG.xyneClawS2sKey } : {}),
    },
    // This mirrors the established mention dispatch contract. In particular,
    // provider resolution and the result callback must never be omitted.
    body: JSON.stringify({
      userId: input.userId,
      task: input.task,
      conversationId: input.conversationId,
      agentSlug: input.agent.slug,
      orgId: input.agent.orgId,
      eventType: input.eventType,
      triggerSource: "slack",
      idempotencyKey: input.idempotencyKey,
      progressUrl: `${CONFIG.internalUrl}/claw/api/v1/webhook/progress`,
      channelId: input.channelId,
      slackDelivery,
      ...(providers.parent ? { provider: providers.parent } : {}),
      ...(providers.providerOrder.length > 1 ? { providerOrder: providers.providerOrder } : {}),
      ...(Object.keys(providers.providerConfigs).length > 0
        ? { providerConfigs: providers.providerConfigs }
        : {}),
      subagentProviderMode: resolveSubagentProviderMode(input.agent.config),
      ...(effectiveAgentConfig ? { agentConfig: effectiveAgentConfig } : {}),
    }),
  });
  const body = (await response.json().catch(() => null)) as {
    success?: boolean;
    sessionId?: string;
    error?: string;
  } | null;
  if (!response.ok || !body?.success || !body.sessionId) {
    throw new Error(`Slack run dispatch failed: ${body?.error ?? `HTTP ${response.status}`}`);
  }

  await setSession(body.sessionId, {
    mentionedUserId: input.userId,
    targetUserId: input.userId,
    senderId: input.userId,
    senderName: input.slackUserId,
    channelId: input.channelId,
    channelName: input.channelId,
    conversationId: input.conversationId,
    ...(input.sourceMessageId ? { sourceMessageId: input.sourceMessageId } : {}),
    task: input.task,
    agentId: input.agent.id,
    agentOrgId: input.agent.orgId,
    agentSlug: input.agent.slug,
    responseMode: "conversation",
    appToken: "",
    spacesAppId: "",
    spacesAppUserId: "",
    rootAgentSlug: input.agent.slug,
    triggerSource: "slack",
    slackDelivery,
  });
  return body.sessionId;
}
