/**
 * Workspace-level provisioning for the org's default agents (`ask-ai`,
 * `xyne-spaces-architect`, `xyne`): ensures each agent has a Spaces app
 * registered in its org, and installs that app into a newly synced workspace.
 *
 * The org-level agent rows come from provision-org-agents.ts; this module adds
 * the Spaces-side lifecycle the user-driven register/install buttons in
 * routes/agents.ts normally perform — but through Spaces' internal S2S routes
 * (`/api/internal/apps`, guarded by Spaces' validateS2SKey), because
 * spaces-sync runs without any user session.
 *
 * Both helpers are idempotent and best-effort: failures are logged and skipped
 * so the next sync (workspace or user) self-heals the missing pieces.
 */
import { prisma } from "../db.js";
import { CONFIG } from "../config.js";
import { encrypt } from "../crypto.js";
import { createLogger } from "../logger.js";
import { errMsg } from "./errors.js";
import { DEFAULT_AGENT_SLUGS } from "./provision-org-agents.js";

const log = createLogger("provision-workspace-agents");

// Full app-permission set a Claw agent bot needs to operate against Spaces'
// /api/apps/* routes (mirrors the `requirePermission(...)` gates: chat:write
// for posting results/progress, channels/users/usergroups reads for resolving
// mentions, tickets + files + im + email for the spaces tools). Granted as ONE
// set so every spaces tool works; tighten per-agent later if needed.
export const CLAW_APP_PERMISSIONS = [
  "chat:write",
  "channels:read",
  "users:read",
  "usergroups:read",
  "tickets:read",
  "tickets:write",
  "files:read",
  "files:write",
  "im:write",
  "email:read",
];

function internalS2sHeaders(): Record<string, string> {
  return { "Content-Type": "application/json", "x-s2s-key": process.env["INTERNAL_S2S_KEY"] ?? "" };
}

/**
 * Ensure every default agent in `orgId` has a Spaces app bound to it. Agents
 * provisioned by provision-org-agents are copied WITHOUT spacesAppId — the app
 * is per-org (agents.spacesAppId is globally unique) so each new org needs its
 * own. Skips agents that already have one. Requires a workspace to create the
 * app under (creator snapshot + permission tenant scope) — call it from a
 * workspace sync, not from a bare org sync.
 */
export async function ensureDefaultAgentSpacesApps(input: {
  orgId: string;
  spacesOrgId: string;
  spacesWorkspaceId: string;
  createdBySpacesUserId?: string | undefined;
}): Promise<void> {
  const agents = await prisma.agent.findMany({
    where: { orgId: input.orgId, slug: { in: [...DEFAULT_AGENT_SLUGS] }, spacesAppId: null },
    select: { id: true, slug: true, name: true, description: true },
  });

  for (const agent of agents) {
    try {
      const res = await fetch(`${CONFIG.spacesInternalUrl}/api/internal/apps`, {
        method: "POST",
        headers: internalS2sHeaders(),
        body: JSON.stringify({
          orgId: input.spacesOrgId,
          name: agent.name,
          description: agent.description || undefined,
          webhookUrlTemplate: `${CONFIG.selfUrl}/claw/api/v1/webhook/app/:appId`,
          permissions: CLAW_APP_PERMISSIONS,
          workspaceId: input.spacesWorkspaceId,
          ...(input.createdBySpacesUserId ? { preferredCreatedByUserId: input.createdBySpacesUserId } : {}),
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        log.warn(`[provision-workspace-agents] app create failed slug=${agent.slug} status=${res.status}: ${text.slice(0, 200)}`);
        continue;
      }
      const body = (await res.json()) as { id?: string; signingSecret?: string };
      if (!body.id || !body.signingSecret) {
        log.warn(`[provision-workspace-agents] app create returned incomplete payload slug=${agent.slug}`);
        continue;
      }
      const enc = encrypt(body.signingSecret, CONFIG.encryptionKey);
      await prisma.agent.update({
        where: { id: agent.id },
        data: {
          spacesAppId: body.id,
          signingSecret: `${enc.ciphertext}:${enc.iv}:${enc.authTag}`,
        },
      });
      log.info(`[provision-workspace-agents] bound spaces app ${body.id} to slug=${agent.slug} orgId=${input.orgId}`);
    } catch (err) {
      log.warn(`[provision-workspace-agents] app create errored slug=${agent.slug}: ${errMsg(err)}`);
    }
  }
}

/**
 * Install the org's default-agent apps into a newly created workspace. Skips
 * agents with no app bound (ensureDefaultAgentSpacesApps runs first on the
 * creation path). Spaces' installApp is itself idempotent, but we only call it
 * for workspaces the sync actually created — see the spaces-sync callers.
 *
 * Note (current semantics, kept deliberately): `agents.spacesAppToken` holds a
 * single per-install JWT while installs are per-workspace — the newest
 * workspace's install overwrites the stored token. Inbound webhooks route by
 * appId + app-level signing secret and are unaffected.
 */
export async function installDefaultAgentsToWorkspace(input: {
  orgId: string;
  spacesWorkspaceId: string;
}): Promise<void> {
  const agents = await prisma.agent.findMany({
    where: { orgId: input.orgId, slug: { in: [...DEFAULT_AGENT_SLUGS] }, spacesAppId: { not: null } },
    select: { id: true, slug: true, spacesAppId: true },
  });

  for (const agent of agents) {
    try {
      const res = await fetch(`${CONFIG.spacesInternalUrl}/api/internal/apps/${agent.spacesAppId}/install`, {
        method: "POST",
        headers: internalS2sHeaders(),
        body: JSON.stringify({ workspaceId: input.spacesWorkspaceId, addToGeneralChannel: true }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        log.warn(`[provision-workspace-agents] install failed slug=${agent.slug} workspace=${input.spacesWorkspaceId} status=${res.status}: ${text.slice(0, 200)}`);
        continue;
      }
      const body = (await res.json()) as { jwtToken?: string };
      if (!body.jwtToken) {
        log.warn(`[provision-workspace-agents] install returned no jwtToken slug=${agent.slug} workspace=${input.spacesWorkspaceId}`);
        continue;
      }

      // Decode JWT to extract appUserId (same as routes/agents.ts install-app).
      let appUserId: string | null = null;
      const jwtParts = body.jwtToken.split(".");
      if (jwtParts[1]) {
        try {
          const decoded = JSON.parse(Buffer.from(jwtParts[1], "base64url").toString()) as { userId?: string };
          appUserId = decoded.userId ?? null;
        } catch { /* ignore */ }
      }

      const enc = encrypt(body.jwtToken, CONFIG.encryptionKey);
      await prisma.agent.update({
        where: { id: agent.id },
        data: {
          spacesAppUserId: appUserId,
          spacesAppToken: `${enc.ciphertext}:${enc.iv}:${enc.authTag}`,
        },
      });
      log.info(`[provision-workspace-agents] installed slug=${agent.slug} app=${agent.spacesAppId} into workspace=${input.spacesWorkspaceId} (botUser=${appUserId})`);
    } catch (err) {
      log.warn(`[provision-workspace-agents] install errored slug=${agent.slug} workspace=${input.spacesWorkspaceId}: ${errMsg(err)}`);
    }
  }
}
