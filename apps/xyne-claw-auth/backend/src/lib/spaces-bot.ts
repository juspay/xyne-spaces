/**
 * Posting in Spaces as a Claw agent's bot (messages, cards, DMs, files).
 *
 * Calls go to Spaces' bot API, /api/claw-agents/bot/*, with a 10-minute agent
 * token for the agent acting as itself (lib/spaces-agent-client.ts). This
 * replaces the never-expiring app token stored on the agent row.
 *
 * An agent is added to each Spaces workspace separately (a principal per
 * workspace). Pass the workspace when the caller knows it; otherwise the
 * agent's only workspace is used, and an agent in several workspaces is refused.
 */

import { CONFIG } from "../config.js";
import { createLogger } from "../logger.js";
import { findActivePrincipalsForAgent, findPrincipalForAgent, getAgentAuth } from "./spaces-agent-client.js";

const log = createLogger("spaces-bot");

/** Spaces' bot API for agents, relative to the Spaces base URL. */
export const SPACES_BOT_API_PATH = "/api/claw-agents/bot";

/** Full URL of a bot API endpoint, e.g. spacesBotUrl("/chat/postMessage"). */
export function spacesBotUrl(path: string, base: string = CONFIG.spacesInternalUrl): string {
  return `${base.replace(/\/+$/, "")}${SPACES_BOT_API_PATH}${path}`;
}

export interface AgentBotAuth {
  /** Bearer token for the bot API (10 minutes). */
  token: string;
  /** The agent's bot user in this workspace: the sender of its messages. */
  botUserId: string;
  principalId: string;
  workspaceId: string;
}

/**
 * A bot token for a Claw agent, or null when the agent is not active in the
 * workspace (or the workspace is ambiguous). Never falls back to a stored token.
 */
export async function getAgentBotAuth(clawAgentId: string | undefined | null, workspaceId?: string | null): Promise<AgentBotAuth | null> {
  if (!clawAgentId) return null;
  try {
    let principal;
    if (workspaceId) {
      principal = await findPrincipalForAgent(clawAgentId, workspaceId);
    } else {
      const all = await findActivePrincipalsForAgent(clawAgentId);
      if (all.length > 1) {
        log.warn(`[spaces-bot] agent=${clawAgentId} is in ${all.length} workspaces and no workspace was given; not posting`);
        return null;
      }
      principal = all[0] ?? null;
    }
    if (!principal || principal.status !== "ACTIVE") {
      log.warn(`[spaces-bot] agent=${clawAgentId} is not added to ${workspaceId ? `workspace ${workspaceId}` : "any workspace"}; not posting`);
      return null;
    }
    const auth = await getAgentAuth({ principalId: principal.id });
    return { token: auth.agentToken, botUserId: principal.botUserId, principalId: principal.id, workspaceId: principal.workspaceId };
  } catch (err) {
    log.warn(`[spaces-bot] bot token failed agent=${clawAgentId}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

/** Which agent is posting, and where. Callers hold this, not a token: tokens are fetched per call. */
export interface BotRef {
  clawAgentId: string;
  workspaceId?: string | null | undefined;
}

export class AgentNotInWorkspaceError extends Error {
  constructor(readonly ref: BotRef) {
    super(`Claw agent ${ref.clawAgentId} is not added to ${ref.workspaceId ? `Spaces workspace ${ref.workspaceId}` : "a single Spaces workspace"}`);
    this.name = "AgentNotInWorkspaceError";
  }
}

/** A current bot token for `ref` (cached until shortly before it expires). Throws when the agent can't post there. */
export async function botBearer(ref: BotRef): Promise<string> {
  const auth = await getAgentBotAuth(ref.clawAgentId, ref.workspaceId);
  if (!auth) throw new AgentNotInWorkspaceError(ref);
  return auth.token;
}

/** The agent's bot user id for `ref`, or "" when the agent can't post there. */
export async function botUserIdFor(ref: BotRef): Promise<string> {
  return (await getAgentBotAuth(ref.clawAgentId, ref.workspaceId))?.botUserId ?? "";
}
