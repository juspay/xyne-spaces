/**
 * App management for the Slack surface: org config-token storage, per-agent
 * app minting (idempotent, liveness-probed), manifest sync, status readback,
 * command registration, and registration removal.
 */
import { Router, type Request, type Response } from "express";
import { errMsg } from "../../../lib/errors.js";
import { prisma } from "../../../db.js";
import { createLogger } from "../../../logger.js";
import { getOrgId, getRequesterId, isClawAdmin, isOrgAdmin } from "../../../middleware/agent-acl.js";
import { requireUserAuth } from "../../../middleware/require-auth.js";
import { encryptSurfaceSecret } from "../../../lib/surface-resolver.js";
import { slackClient, slackErrorCode, type SlackManifest } from "../api.js";
import {
  configWithRotatedTokens,
  hasUsableSlackConfigToken,
  rotateSlackRefreshToken,
  rotateStoredSlackConfigToken,
  SlackConfigTokenError,
} from "../config-tokens.js";
import { serializedSlackManifest, slackCommandsUri } from "../manifest.js";
import { SLACK_COMMAND_RE, TERMINAL_APP_ACCESS_CODES } from "../const.js";
import { createAgentInstallUrl } from "../oauth-state.js";
import { objectPayload } from "./shared.js";
import { resolveSlackAgentRequest } from "./context.js";
import type { SlackAgentStatusEntry } from "./types.js";
import {
  agentRegistrationWhere,
  bindAgentCommand,
  findCommandConflict,
  getOrgSlackConnection,
  getSlackSurface,
  listOrgAgentRegistrations,
  listOrgTeamConnections,
  orgConnectionWhere,
  ORG_LEVEL_TENANT_ID,
  saveAppRegistration,
} from "../store.js";

const log = createLogger("slack-apps");
export const appsRouter = Router();
const router = appsRouter;

interface SlackManifestResponse {
  ok?: boolean;
  error?: string;
  app_id?: string;
  credentials?: {
    client_id?: string;
    client_secret?: string;
    signing_secret?: string;
    verification_token?: string;
  };
}

async function findUmbrellaApp(
  orgId: string,
  surfaceId: string,
): Promise<{
  connectionId: string;
  appId: string;
  teamId: string;
} | null> {
  const rows = await listOrgTeamConnections(orgId, surfaceId);
  for (const row of rows) {
    const config = objectPayload(row.config);
    const appId = typeof config?.["appId"] === "string" ? config["appId"].trim() : "";
    if (appId) return { connectionId: row.id, appId, teamId: row.surfaceTenantId };
  }
  return null;
}

/**
 * Deleting a Slack app in the console emits no webhook, so stored per-agent
 * apps can silently die. Probe via apps.manifest.export with the org's config
 * token. Fail-open: without a usable token, or on transient errors, assume the
 * app exists (never mint duplicates because of a network blip).
 */

async function slackAppStillExists(orgId: string, surfaceId: string, appId: string): Promise<boolean> {
  try {
    const tokenRow = await getOrgSlackConnection(orgId, surfaceId);
    if (!tokenRow || !hasUsableSlackConfigToken(tokenRow)) return true;
    const accessToken = await rotateStoredSlackConfigToken(tokenRow.id);
    await slackClient(accessToken).apps.manifest.export({ app_id: appId });
    return true;
  } catch (error) {
    const code = slackErrorCode(error);
    if (code !== undefined && TERMINAL_APP_ACCESS_CODES.has(code)) return false;
    return true;
  }
}

/** Append (or replace) a slash command on the umbrella app's manifest via
 *  apps.manifest.export -> update, using the org's rotated config token. */

async function registerUmbrellaCommand(input: {
  configAccessToken: string;
  umbrellaAppId: string;
  commandName: string;
  description: string;
}): Promise<void> {
  const exported = await slackClient(input.configAccessToken).apps.manifest.export({
    app_id: input.umbrellaAppId,
  });
  const manifest = exported.manifest as Record<string, unknown> | undefined;
  if (!manifest) throw new Error("Slack apps.manifest.export returned no manifest");
  const features = objectPayload(manifest["features"]) ?? {};
  const existing = Array.isArray(features["slash_commands"]) ? features["slash_commands"] : [];
  const kept = existing.filter((entry) => objectPayload(entry)?.["command"] !== input.commandName);
  features["slash_commands"] = [
    ...kept,
    {
      command: input.commandName,
      url: slackCommandsUri(),
      description: input.description.slice(0, 2000),
      usage_hint: "<task for the agent>",
      should_escape: false,
    },
  ];
  manifest["features"] = features;
  await slackClient(input.configAccessToken).apps.manifest.update({
    app_id: input.umbrellaAppId,
    // Round-tripped straight from apps.manifest.export, so it is already a
    // Slack manifest; the export response is typed only as a plain object.
    manifest: manifest as unknown as SlackManifest,
  });
}

router.post("/config-token", requireUserAuth, async (req: Request, res: Response) => {
  try {
    const userId = getRequesterId(req);
    const sessionOrgId = getOrgId(req);
    const body = objectPayload(req.body);
    const orgId = typeof body?.["orgId"] === "string" ? body["orgId"].trim() : sessionOrgId;
    const accessToken = typeof body?.["accessToken"] === "string" ? body["accessToken"].trim() : "";
    const refreshToken = typeof body?.["refreshToken"] === "string" ? body["refreshToken"].trim() : "";
    if (!userId || !sessionOrgId || !orgId) {
      res.status(401).json({ success: false, error: "Authenticated organization session required" });
      return;
    }
    if (sessionOrgId !== orgId || !(await isOrgAdmin(userId, orgId))) {
      res.status(403).json({ success: false, error: "Requires OWNER or ADMIN" });
      return;
    }
    if (!accessToken.startsWith("xoxe.xoxp-") || !refreshToken.startsWith("xoxe-1-")) {
      res.status(400).json({
        success: false,
        error: "Enter a valid Slack app configuration access and refresh token pair",
      });
      return;
    }
    const surface = await getSlackSurface();
    if (!surface) {
      res.status(503).json({ success: false, error: "Slack surface is not initialized" });
      return;
    }
    const rotated = await rotateSlackRefreshToken(refreshToken);
    const existing = await getOrgSlackConnection(orgId, surface.id);
    const config = configWithRotatedTokens(existing?.config, rotated);
    await prisma.connectedSurface.upsert({
      where: orgConnectionWhere(orgId, surface.id),
      create: {
        orgId,
        surfaceId: surface.id,
        surfaceTenantId: ORG_LEVEL_TENANT_ID,
        config,
        status: "ACTIVE",
      },
      update: { config, status: "ACTIVE" },
    });
    res.json({ success: true, data: { configTokenStatus: "valid" } });
  } catch (error) {
    if (error instanceof SlackConfigTokenError) {
      res.status(400).json({ success: false, error: error.message });
      return;
    }
    log.error("[surfaces-slack] Configuration token connection failed", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    res.status(500).json({ success: false, error: "Failed to store Slack configuration token" });
  }
});

router.get("/agents/status", requireUserAuth, async (req: Request, res: Response) => {
  try {
    const userId = getRequesterId(req);
    const sessionOrgId = getOrgId(req);
    const requestedOrgId = typeof req.query["orgId"] === "string" ? req.query["orgId"].trim() : sessionOrgId;
    if (!userId || !sessionOrgId || !requestedOrgId) {
      res.status(401).json({ success: false, error: "Authenticated organization session required" });
      return;
    }
    const platformAdmin = await isClawAdmin(userId);
    if (!platformAdmin && (sessionOrgId !== requestedOrgId || !(await isOrgAdmin(userId, requestedOrgId)))) {
      res.status(403).json({ success: false, error: "Requires platform admin or organization OWNER/ADMIN" });
      return;
    }
    const surface = await getSlackSurface();
    if (!surface) {
      res.status(503).json({ success: false, error: "Slack surface is not initialized" });
      return;
    }
    const rows = await listOrgAgentRegistrations(surface.id, requestedOrgId);
    const data: SlackAgentStatusEntry[] = [];
    for (const row of rows) {
      if (!row.externalAppId || !row.clientId) {
        if (row.commandName) {
          // Command-only registration on the umbrella app — no dedicated app.
          data.push({
            agentId: row.agent.id,
            agentSlug: row.agent.slug,
            appId: "",
            status: "command",
            commandName: row.commandName,
            installs: [],
            installUrl: null,
            manifestStale: false,
          });
          continue;
        }
        log.warn(`[slack-apps] Skipping invalid per-agent Slack app state for agent ${row.agent.id}`);
        continue;
      }
      const installs = row.installs.map((install) => ({
        teamId: install.surfaceTenantId,
        teamName: install.tenantName ?? "",
        installedAt: install.installedAt.toISOString(),
      }));
      data.push({
        agentId: row.agent.id,
        agentSlug: row.agent.slug,
        appId: row.externalAppId,
        status: installs.length > 0 || row.status === "installed" ? "installed" : "created",
        ...(row.commandName ? { commandName: row.commandName } : {}),
        installs,
        manifestStale: row.manifestHash !== serializedSlackManifest(row.agent).hash,
        installUrl: await createAgentInstallUrl({
          orgId: requestedOrgId,
          userId,
          surfaceAgentId: row.id,
          clientId: row.clientId,
        }),
      });
    }
    res.json({ success: true, data });
  } catch (error) {
    log.error("[surfaces-slack] Per-agent Slack app status failed", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    res.status(500).json({ success: false, error: "Failed to load Slack app status" });
  }
});

router.post("/agents/:slug/sync-app", requireUserAuth, async (req: Request, res: Response) => {
  try {
    const resolved = await resolveSlackAgentRequest(req);
    if (!resolved.ok) {
      res.status(resolved.status).json({ success: false, error: resolved.error });
      return;
    }
    const { userId, agent } = resolved;
    const surface = await getSlackSurface();
    if (!surface) {
      res.status(503).json({ success: false, error: "Slack surface is not initialized" });
      return;
    }
    const surfaceAgent = await prisma.surfaceAgent.findUnique({
      where: agentRegistrationWhere(agent.id, surface.id),
      select: { id: true, externalAppId: true, clientId: true },
    });
    const appId = surfaceAgent?.externalAppId ?? "";
    const clientId = surfaceAgent?.clientId ?? "";
    if (!surfaceAgent || !appId || !clientId) {
      res.status(404).json({ success: false, error: "Existing Slack app not found for agent" });
      return;
    }
    const connection = await getOrgSlackConnection(agent.orgId, surface.id);
    if (!connection || !hasUsableSlackConfigToken(connection)) {
      res.status(503).json({ success: false, error: "Connect Slack with an app configuration token first" });
      return;
    }
    let configAccessToken: string;
    try {
      configAccessToken = await rotateStoredSlackConfigToken(connection.id);
    } catch (error) {
      if (error instanceof SlackConfigTokenError) {
        res
          .status(503)
          .json({ success: false, error: "Connect Slack with an app configuration token first" });
        return;
      }
      throw error;
    }
    const currentManifest = serializedSlackManifest(agent);
    try {
      await slackClient(configAccessToken).apps.manifest.update({
        app_id: appId,
        manifest: currentManifest.manifest as unknown as SlackManifest,
      });
    } catch (error) {
      const code = slackErrorCode(error) ?? "network_error";
      log.warn(`[slack-apps] manifest update failed: ${code}`);
      res.status(502).json({ success: false, error: `Slack app update failed: ${code}` });
      return;
    }
    await prisma.surfaceAgent.update({
      where: { id: surfaceAgent.id },
      data: { manifestSyncedAt: new Date(), manifestHash: currentManifest.hash },
    });
    res.json({
      success: true,
      data: {
        appId,
        installUrl: await createAgentInstallUrl({
          orgId: agent.orgId,
          userId,
          surfaceAgentId: surfaceAgent.id,
          clientId,
        }),
        scopesChanged: true,
      },
    });
  } catch (error) {
    log.error("[surfaces-slack] Per-agent Slack app sync failed", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    res.status(500).json({ success: false, error: "Failed to update Slack app" });
  }
});

router.post("/agents/:slug/create-app", requireUserAuth, async (req: Request, res: Response) => {
  try {
    const resolved = await resolveSlackAgentRequest(req);
    if (!resolved.ok) {
      res.status(resolved.status).json({ success: false, error: resolved.error });
      return;
    }
    const { userId, agent } = resolved;
    const body = objectPayload(req.body);
    const surface = await getSlackSurface();
    if (!surface) {
      res.status(503).json({ success: false, error: "Slack surface is not initialized" });
      return;
    }
    const recreate = body?.["recreate"] === true;
    const existingSurfaceAgent = await prisma.surfaceAgent.findUnique({
      where: agentRegistrationWhere(agent.id, surface.id),
      select: { id: true, externalAppId: true, clientId: true },
    });
    const existingAppId = existingSurfaceAgent?.externalAppId ?? "";
    const existingClientId = existingSurfaceAgent?.clientId ?? "";
    if (existingSurfaceAgent && existingAppId && !recreate) {
      if (!existingClientId) {
        log.error(`[surfaces-slack] Existing per-agent Slack app ${existingAppId} is missing its client ID`);
        res.status(500).json({ success: false, error: "Existing Slack app state is incomplete" });
        return;
      }
      // Deleting an app in the Slack console emits no webhook — verify the app
      // still exists before reusing it, else fall through and mint a fresh one.
      const stillExists = await slackAppStillExists(agent.orgId, surface.id, existingAppId);
      if (stillExists) {
        res.json({
          success: true,
          data: {
            appId: existingAppId,
            installUrl: await createAgentInstallUrl({
              orgId: agent.orgId,
              userId,
              surfaceAgentId: existingSurfaceAgent.id,
              clientId: existingClientId,
            }),
            reused: true,
          },
        });
        return;
      }
      log.warn(`[surfaces-slack] Stored Slack app ${existingAppId} no longer exists — recreating`);
    }
    if (recreate && existingAppId) {
      log.warn(`[surfaces-slack] Replacing per-agent Slack app ${existingAppId}`);
    }
    const connection = await getOrgSlackConnection(agent.orgId, surface.id);
    if (!connection || !hasUsableSlackConfigToken(connection)) {
      res.status(503).json({ success: false, error: "Connect Slack with an app configuration token first" });
      return;
    }
    let configAccessToken: string;
    try {
      configAccessToken = await rotateStoredSlackConfigToken(connection.id);
    } catch (error) {
      if (error instanceof SlackConfigTokenError) {
        res
          .status(503)
          .json({ success: false, error: "Connect Slack with an app configuration token first" });
        return;
      }
      throw error;
    }
    const currentManifest = serializedSlackManifest(agent);
    let manifest: SlackManifestResponse;
    try {
      manifest = (await slackClient(configAccessToken).apps.manifest.create({
        manifest: currentManifest.manifest as unknown as SlackManifest,
      })) as SlackManifestResponse;
    } catch (error) {
      const code = slackErrorCode(error) ?? "network_error";
      log.warn(`[slack-apps] manifest creation failed: ${code}`);
      res.status(502).json({ success: false, error: `Slack app creation failed: ${code}` });
      return;
    }
    const appId = manifest.app_id?.trim() ?? "";
    const clientId = manifest.credentials?.client_id?.trim() ?? "";
    const clientSecret = manifest.credentials?.client_secret?.trim() ?? "";
    const signingSecret = manifest.credentials?.signing_secret?.trim() ?? "";
    if (!appId || !clientId || !clientSecret || !signingSecret) {
      log.warn(`[slack-apps] manifest creation returned incomplete credentials`);
      res.status(502).json({ success: false, error: "Slack app creation failed: malformed_response" });
      return;
    }
    // Columns hold everything the core queries; config keeps only provenance
    // residue, and saveAppRegistration merges it so a prior command binding's
    // residue survives the agent later getting its own app.
    const surfaceAgent = await saveAppRegistration({
      agentId: agent.id,
      surfaceId: surface.id,
      registration: {
        externalAppId: appId,
        clientId,
        encryptedClientSecret: encryptSurfaceSecret(clientSecret),
        signingSecret: encryptSurfaceSecret(signingSecret),
        status: "created",
        manifestSyncedAt: new Date(),
        manifestHash: currentManifest.hash,
      },
      createdByUserId: userId,
    });
    const installUrl = await createAgentInstallUrl({
      orgId: agent.orgId,
      userId,
      surfaceAgentId: surfaceAgent.id,
      clientId,
    });
    res.json({ success: true, data: { appId, installUrl, reused: false } });
  } catch (error) {
    log.error("[surfaces-slack] Per-agent Slack app creation failed", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    res.status(500).json({ success: false, error: "Failed to create Slack app" });
  }
});

router.delete("/agents/:slug/slack-app", requireUserAuth, async (req: Request, res: Response) => {
  try {
    const resolved = await resolveSlackAgentRequest(req);
    if (!resolved.ok) {
      res.status(resolved.status).json({ success: false, error: resolved.error });
      return;
    }
    const { agent } = resolved;
    const surface = await getSlackSurface();
    if (!surface) {
      res.status(503).json({ success: false, error: "Slack surface is not initialized" });
      return;
    }
    // Forget the stored registration (app credentials, installs, command
    // binding). This does NOT delete the app on Slack's side — the console is
    // the source of truth there; this clears claw's mirror of it.
    await prisma.surfaceAgent.deleteMany({
      where: { agentId: agent.id, surfaceId: surface.id, surfaceTenantId: ORG_LEVEL_TENANT_ID },
    });
    log.info(`[surfaces-slack] cleared Slack registration for agent ${agent.slug}`);
    res.json({ success: true, data: { removed: true } });
  } catch (error) {
    log.error("[surfaces-slack] Slack registration removal failed", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    res.status(500).json({ success: false, error: "Failed to remove Slack registration" });
  }
});

router.post("/agents/:slug/register-command", requireUserAuth, async (req: Request, res: Response) => {
  try {
    const resolved = await resolveSlackAgentRequest(req);
    if (!resolved.ok) {
      res.status(resolved.status).json({ success: false, error: resolved.error });
      return;
    }
    const { userId, agent } = resolved;
    const body = objectPayload(req.body);
    const requestedCommand =
      typeof body?.["commandName"] === "string" && body["commandName"].trim()
        ? body["commandName"].trim()
        : `/${agent.slug}`;
    const commandName = requestedCommand.startsWith("/") ? requestedCommand : `/${requestedCommand}`;
    if (!SLACK_COMMAND_RE.test(commandName)) {
      res.status(400).json({
        success: false,
        error: "commandName must be /name with 1-32 lowercase letters, numbers, hyphens or underscores",
      });
      return;
    }
    const surface = await getSlackSurface();
    if (!surface) {
      res.status(503).json({ success: false, error: "Slack surface is not initialized" });
      return;
    }
    const conflicting = await findCommandConflict({
      surfaceId: surface.id,
      orgId: agent.orgId,
      commandName,
      excludeAgentId: agent.id,
    });
    if (conflicting) {
      res.status(409).json({
        success: false,
        error: `${commandName} is already registered for ${conflicting.agent.slug}`,
      });
      return;
    }
    const umbrella = await findUmbrellaApp(agent.orgId, surface.id);
    if (!umbrella) {
      res.status(503).json({
        success: false,
        error: "No workspace-installed Slack app found for this organization — connect Slack first",
      });
      return;
    }
    const tokenRow = await getOrgSlackConnection(agent.orgId, surface.id);
    if (!tokenRow || !hasUsableSlackConfigToken(tokenRow)) {
      res.status(503).json({ success: false, error: "Connect Slack with an app configuration token first" });
      return;
    }
    let configAccessToken: string;
    try {
      configAccessToken = await rotateStoredSlackConfigToken(tokenRow.id);
    } catch (error) {
      if (error instanceof SlackConfigTokenError) {
        res
          .status(503)
          .json({ success: false, error: "Connect Slack with an app configuration token first" });
        return;
      }
      throw error;
    }
    await registerUmbrellaCommand({
      configAccessToken,
      umbrellaAppId: umbrella.appId,
      commandName,
      description: `Ask ${agent.name}`,
    });
    await bindAgentCommand({
      agentId: agent.id,
      surfaceId: surface.id,
      commandName,
      commandConnectedSurfaceId: umbrella.connectionId,
      commandAppId: umbrella.appId,
      registeredByUserId: userId,
    });
    log.info(`[surfaces-slack] registered command ${commandName} -> ${agent.slug} on app ${umbrella.appId}`);
    res.json({ success: true, data: { commandName, appId: umbrella.appId } });
  } catch (error) {
    log.error("[surfaces-slack] Slash-command registration failed", {
      errorType: error instanceof Error ? error.name : "UnknownError",
      message: errMsg(error),
    });
    res.status(500).json({ success: false, error: "Failed to register Slack command" });
  }
});
