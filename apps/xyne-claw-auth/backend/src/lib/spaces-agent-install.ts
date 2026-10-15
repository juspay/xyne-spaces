/**
 * Per-workspace Spaces app install credentials.
 *
 * A Claw agent mints ONE Spaces app (`Agent.spacesAppId`, globally unique) and
 * installs it into each workspace of its org. Every install yields a DISTINCT
 * bot JWT + bot user id. The legacy `Agent.spacesAppToken`/`spacesAppUserId`
 * columns hold only ONE such pair, so installing into a second workspace
 * overwrote the first and outbound Spaces calls only worked in the
 * most-recently-installed workspace.
 *
 * This module stores the per-workspace credential in the EXISTING
 * `SurfaceAgent` (surfaceId="spaces", org-level anchor) + `SurfaceAgentInstall`
 * (one row per workspace) tables — the same shape the Slack surface already
 * uses (surfaces/slack/store.ts) — so there is NO schema migration. It resolves
 * the right credential by `(spacesAppId, workspaceId)`.
 *
 * The inline `Agent` columns stay as a FALLBACK: callers with no workspace in
 * scope, agents not yet backfilled, or any DB hiccup degrade to today's
 * behaviour (fail-open, never a throw).
 */
import { prisma } from "../db.js";
import { createLogger } from "../logger.js";
import { errMsg } from "./errors.js";

const log = createLogger("spaces-agent-install");

/** The surface-catalog id for Spaces (seeded in routes/spaces-sync.ts). */
export const SPACES_SURFACE_ID = "spaces";
/** Sentinel surfaceTenantId for the org-level SurfaceAgent anchor row. */
const ORG_LEVEL_TENANT_ID = "";

/** Encrypted-token + bot-user pair, mirroring the `Agent` row columns so call
 *  sites keep their existing decrypt logic unchanged. */
export interface SpacesAppCreds {
  spacesAppToken: string | null;
  spacesAppUserId: string | null;
}

/**
 * Ensure the org-level `SurfaceAgent` row that anchors this agent's Spaces app,
 * so per-workspace installs can hang off it. Keyed by `(agentId, "spaces", "")`;
 * `externalAppId` carries the globally-unique app id. Best-effort — returns the
 * row id, or null on failure.
 */
export async function ensureSpacesSurfaceAgent(input: {
  agentId: string;
  spacesAppId: string;
  signingSecret?: string | null;
}): Promise<string | null> {
  try {
    const row = await prisma.surfaceAgent.upsert({
      where: {
        agentId_surfaceId_surfaceTenantId: {
          agentId: input.agentId,
          surfaceId: SPACES_SURFACE_ID,
          surfaceTenantId: ORG_LEVEL_TENANT_ID,
        },
      },
      create: {
        agentId: input.agentId,
        surfaceId: SPACES_SURFACE_ID,
        surfaceTenantId: ORG_LEVEL_TENANT_ID,
        externalAppId: input.spacesAppId,
        ...(input.signingSecret ? { signingSecret: input.signingSecret } : {}),
        status: "installed",
      },
      update: {
        externalAppId: input.spacesAppId,
        ...(input.signingSecret ? { signingSecret: input.signingSecret } : {}),
      },
      select: { id: true },
    });
    return row.id;
  } catch (err) {
    log.warn(
      `[spaces-agent-install] ensureSpacesSurfaceAgent failed agent=${input.agentId} app=${input.spacesAppId}: ${errMsg(err)}`,
    );
    return null;
  }
}

/**
 * Record (or refresh) the per-workspace install credential for an agent's
 * Spaces app. Idempotent on `(surfaceAgent, workspaceId)`. Best-effort: a
 * failure is logged and swallowed so the caller's inline write (the fallback)
 * still lands.
 */
export async function upsertSpacesInstall(input: {
  agentId: string;
  spacesAppId: string;
  workspaceId: string;
  botUserId?: string | null;
  encryptedBotToken: string;
  installedByUserId?: string | null;
  signingSecret?: string | null;
}): Promise<void> {
  if (!input.workspaceId) return;
  try {
    const surfaceAgentId = await ensureSpacesSurfaceAgent({
      agentId: input.agentId,
      spacesAppId: input.spacesAppId,
      signingSecret: input.signingSecret ?? null,
    });
    if (!surfaceAgentId) return;
    await prisma.surfaceAgentInstall.upsert({
      where: { surfaceAgentId_surfaceTenantId: { surfaceAgentId, surfaceTenantId: input.workspaceId } },
      create: {
        surfaceAgentId,
        surfaceTenantId: input.workspaceId,
        encryptedBotToken: input.encryptedBotToken,
        ...(input.botUserId ? { botUserId: input.botUserId } : {}),
        ...(input.installedByUserId ? { installedByUserId: input.installedByUserId } : {}),
      },
      update: {
        encryptedBotToken: input.encryptedBotToken,
        ...(input.botUserId ? { botUserId: input.botUserId } : {}),
        installedAt: new Date(),
      },
    });
  } catch (err) {
    log.warn(
      `[spaces-agent-install] upsertSpacesInstall failed agent=${input.agentId} app=${input.spacesAppId} ws=${input.workspaceId}: ${errMsg(err)}`,
    );
  }
}

/**
 * Resolve the Spaces app credential for a given workspace. Prefers the
 * per-workspace install row; falls back to the inline `Agent` columns when
 * there is no workspace in scope, no install row yet (pre-backfill), or any DB
 * hiccup (fail-open). Returns the row-shaped pair (ENCRYPTED token + bot user
 * id) so call sites keep their existing decrypt logic unchanged.
 */
export async function resolveSpacesAppCreds(
  agent: { spacesAppId?: string | null; spacesAppToken?: string | null; spacesAppUserId?: string | null },
  workspaceId?: string | null,
): Promise<SpacesAppCreds> {
  const fallback: SpacesAppCreds = {
    spacesAppToken: agent.spacesAppToken ?? null,
    spacesAppUserId: agent.spacesAppUserId ?? null,
  };
  if (!workspaceId || !agent.spacesAppId) return fallback;
  try {
    const install = await prisma.surfaceAgentInstall.findFirst({
      where: {
        surfaceTenantId: workspaceId,
        surfaceAgent: { surfaceId: SPACES_SURFACE_ID, externalAppId: agent.spacesAppId },
      },
      select: { encryptedBotToken: true, botUserId: true },
    });
    if (install?.encryptedBotToken) {
      return {
        spacesAppToken: install.encryptedBotToken,
        spacesAppUserId: install.botUserId ?? agent.spacesAppUserId ?? null,
      };
    }
  } catch (err) {
    log.warn(
      `[spaces-agent-install] resolveSpacesAppCreds fallback app=${agent.spacesAppId} ws=${workspaceId}: ${errMsg(err)}`,
    );
  }
  return fallback;
}

/**
 * Reverse lookup for paths that only know the bot's user id (the Spaces MCP
 * app-token resolver, inbound user-mention routing): find the install whose
 * `botUserId` matches, returning its ENCRYPTED token. Falls back to the inline
 * `Agent` column keyed by `spacesAppUserId`.
 */
export async function resolveSpacesAppTokenByBotUser(botUserId: string): Promise<string | null> {
  if (!botUserId) return null;
  try {
    const install = await prisma.surfaceAgentInstall.findFirst({
      where: { botUserId, surfaceAgent: { surfaceId: SPACES_SURFACE_ID } },
      select: { encryptedBotToken: true },
      orderBy: { installedAt: "desc" },
    });
    if (install?.encryptedBotToken) return install.encryptedBotToken;
  } catch (err) {
    log.warn(`[spaces-agent-install] resolveSpacesAppTokenByBotUser fallback botUser=${botUserId}: ${errMsg(err)}`);
  }
  const agent = await prisma.agent.findFirst({
    where: { spacesAppUserId: botUserId },
    select: { spacesAppToken: true },
  });
  return agent?.spacesAppToken ?? null;
}
