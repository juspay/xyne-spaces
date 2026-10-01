/**
 * Workspace-level provisioning for the org's default agents (`ask-ai`,
 * `xyne-spaces-architect`, `xyne`): ensures each agent has a Spaces app
 * registered in its org and installed into the given workspace, in one shot.
 *
 * The org-level agent rows come from provision-org-agents.ts; this module adds
 * the Spaces-side lifecycle the user-driven register/install buttons in
 * routes/agents.ts normally perform — but through Spaces' internal S2S route
 * (`/api/internal/apps/ensure-installed`, guarded by Spaces' validateS2SKey),
 * because spaces-sync runs without any user session.
 *
 * Fully idempotent and best-effort: failures are logged and skipped so the
 * next sync (workspace or user) self-heals the missing pieces.
 */
import { prisma } from "../db.js";
import { CONFIG } from "../config.js";
import { encrypt } from "../crypto.js";
import { createLogger } from "../logger.js";
import { errMsg } from "./errors.js";
import { DEFAULT_AGENT_SLUGS } from "./provision-org-agents.js";
import { ensureSpacesSurfaceAgent, upsertSpacesInstall } from "./spaces-agent-install.js";

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
 * Ensure every default agent in `orgId` has a Spaces app and is installed in
 * `spacesWorkspaceId`. A single `/api/internal/apps/ensure-installed` call per
 * agent replaces the old create → presence-check → install three-step sequence.
 * Spaces handles idempotency: same-named apps are adopted, existing installs
 * are updated rather than duplicated.
 */
export async function ensureAgentsInstalledInWorkspace(input: {
  orgId: string;
  spacesOrgId: string;
  spacesWorkspaceId: string;
  createdBySpacesUserId?: string | undefined;
}): Promise<void> {
  const agents = await prisma.agent.findMany({
    where: { orgId: input.orgId, slug: { in: [...DEFAULT_AGENT_SLUGS] } },
    select: { id: true, slug: true, name: true, description: true },
  });

  for (const agent of agents) {
    try {
      const res = await fetch(`${CONFIG.spacesInternalUrl}/api/internal/apps/ensure-installed`, {
        method: "POST",
        headers: internalS2sHeaders(),
        body: JSON.stringify({
          orgId: input.spacesOrgId,
          name: agent.name,
          description: agent.description || undefined,
          webhookUrlTemplate: `${CONFIG.selfUrl}/claw/api/v1/webhook/app/:appId`,
          permissions: CLAW_APP_PERMISSIONS,
          workspaceId: input.spacesWorkspaceId,
          addToGeneralChannel: true,
          ...(input.createdBySpacesUserId ? { preferredCreatedByUserId: input.createdBySpacesUserId } : {}),
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        log.warn(`[provision-workspace-agents] ensure-installed failed slug=${agent.slug} status=${res.status}: ${text.slice(0, 200)}`);
        continue;
      }
      const body = (await res.json()) as { appId?: string; signingSecret?: string; jwtToken?: string; appCreated?: boolean };
      if (!body.appId || !body.signingSecret || !body.jwtToken) {
        log.warn(`[provision-workspace-agents] ensure-installed returned incomplete payload slug=${agent.slug}`);
        continue;
      }

      // Encrypt credentials for at-rest storage.
      const encSigning = encrypt(body.signingSecret, CONFIG.encryptionKey);
      const encSigningSecret = `${encSigning.ciphertext}:${encSigning.iv}:${encSigning.authTag}`;
      const encToken = encrypt(body.jwtToken, CONFIG.encryptionKey);
      const encBotToken = `${encToken.ciphertext}:${encToken.iv}:${encToken.authTag}`;

      // Decode the JWT to extract the bot user ID.
      let botUserId: string | null = null;
      const jwtParts = body.jwtToken.split(".");
      if (jwtParts[1]) {
        try {
          const decoded = JSON.parse(Buffer.from(jwtParts[1], "base64url").toString()) as { userId?: string };
          botUserId = decoded.userId ?? null;
        } catch { /* ignore malformed JWT */ }
      }

      // Bind the Spaces app to the agent row (converges on re-runs).
      await prisma.agent.update({
        where: { id: agent.id },
        data: {
          spacesAppId: body.appId,
          signingSecret: encSigningSecret,
          // Inline fallback columns for callers without a workspace in scope
          // and for pre-backfill rows; per-workspace truth is in SurfaceAgentInstall.
          spacesAppUserId: botUserId,
          spacesAppToken: encBotToken,
        },
      });
      // Anchor the org-level SurfaceAgent row so per-workspace installs hang off it.
      await ensureSpacesSurfaceAgent({ agentId: agent.id, spacesAppId: body.appId, signingSecret: encSigningSecret });
      // Per-workspace credential: one row per (app, workspace), read back by
      // resolveSpacesAppCreds(agent, workspaceId).
      await upsertSpacesInstall({
        agentId: agent.id,
        spacesAppId: body.appId,
        workspaceId: input.spacesWorkspaceId,
        botUserId,
        encryptedBotToken: encBotToken,
      });

      log.info(`[provision-workspace-agents] slug=${agent.slug} app=${body.appId} installed in workspace=${input.spacesWorkspaceId} botUser=${botUserId} appCreated=${body.appCreated}`);
    } catch (err) {
      log.warn(`[provision-workspace-agents] ensure-installed errored slug=${agent.slug}: ${errMsg(err)}`);
    }
  }
}
