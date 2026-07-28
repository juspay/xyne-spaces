/**
 * Slack OAuth install flow: /oauth/start mints single-use state and redirects
 * to Slack consent; /oauth/callback exchanges the code, encrypts the bot
 * token, and records the install (per-agent app or org-level legacy path).
 */
import { Router, type Request, type Response } from "express";
import { CONFIG } from "../../../config.js";
import { prisma } from "../../../db.js";
import { createLogger } from "../../../logger.js";
import { encryptSurfaceSecret, decryptSurfaceSecret } from "../../../lib/surface-resolver.js";
import { slackClientWithoutToken, slackErrorCode } from "../api.js";
import { slackCallbackUri } from "../manifest.js";
import { takeOAuthState } from "../oauth-state.js";
import { objectPayload } from "./shared.js";
import { getSlackSurface, listConnectionsForTeam, recordInstall } from "../store.js";
import type { SlackConnectOutcomeParam } from "./types.js";

const log = createLogger("slack-oauth");
export const oauthRouter = Router();
const router = oauthRouter;

interface SlackOAuthResponse {
  ok?: boolean;
  error?: string;
  access_token?: string;
  bot_user_id?: string;
  app_id?: string;
  team?: { id?: string; name?: string };
}

function frontendOrganizationUrl(param: SlackConnectOutcomeParam, value: string): string {
  const url = new URL("v3/organizations", CONFIG.frontendUrl);
  url.searchParams.set(param, value);
  return url.toString();
}

router.get("/oauth/callback", async (req: Request, res: Response) => {
  const state = await takeOAuthState(req.query["state"]);
  if (!state) {
    res.status(400).json({ success: false, error: "Invalid or expired Slack OAuth state" });
    return;
  }

  const oauthError = typeof req.query["error"] === "string" ? req.query["error"] : "";
  if (oauthError) {
    res.redirect(frontendOrganizationUrl("slack_error", oauthError));
    return;
  }
  const code = typeof req.query["code"] === "string" ? req.query["code"].trim() : "";
  if (!code) {
    res.redirect(frontendOrganizationUrl("slack_error", "missing_authorization_code"));
    return;
  }

  try {
    // Installs are always per-agent-app: credentials come from the app's
    // SurfaceAgent row (minted via apps.manifest.create), never from env.
    const perAgent = await prisma.surfaceAgent.findUnique({
      where: { id: state.surfaceAgentId },
      include: { agent: { select: { orgId: true, slug: true } } },
    });
    const clientId = perAgent?.clientId ?? "";
    const encryptedClientSecret = perAgent?.encryptedClientSecret ?? "";
    if (!perAgent || perAgent.agent?.orgId !== state.orgId || !clientId || !encryptedClientSecret) {
      res.redirect(frontendOrganizationUrl("slack_error", "invalid_surface_agent"));
      return;
    }
    const credentials = {
      clientId,
      clientSecret: decryptSurfaceSecret(encryptedClientSecret, "Slack client secret"),
    };
    let tokens: SlackOAuthResponse;
    try {
      tokens = (await slackClientWithoutToken().oauth.v2.access({
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        code,
        redirect_uri: slackCallbackUri(),
      })) as SlackOAuthResponse;
    } catch (error) {
      const code = slackErrorCode(error);
      if (code === undefined) throw error;
      log.warn(`[surfaces-slack] Slack token exchange failed: ${code}`);
      res.redirect(frontendOrganizationUrl("slack_error", code));
      return;
    }

    const teamId = tokens.team?.id?.trim() ?? "";
    const teamName = tokens.team?.name?.trim() ?? "";
    const accessToken = tokens.access_token?.trim() ?? "";
    const botUserId = tokens.bot_user_id?.trim() ?? "";
    const appId = tokens.app_id?.trim() ?? "";
    if (!teamId || !teamName || !accessToken.startsWith("xoxb-") || !botUserId || !appId) {
      res.redirect(frontendOrganizationUrl("slack_error", "invalid_oauth_response"));
      return;
    }

    const surface = await getSlackSurface();
    if (!surface) {
      log.error("[surfaces-slack] Slack Surface catalog row is missing");
      res.redirect(frontendOrganizationUrl("slack_error", "slack_surface_not_initialized"));
      return;
    }

    const workspaceConnections = await listConnectionsForTeam(surface.id, teamId);
    if (workspaceConnections.some((connection) => connection.orgId !== state.orgId)) {
      log.warn(`[surfaces-slack] rejected workspace ${teamId}: owned by another organization`);
      res.redirect(frontendOrganizationUrl("slack_error", "workspace_connected_to_another_organization"));
      return;
    }

    if (perAgent) {
      const existingWorkspace = workspaceConnections.find((connection) => connection.orgId === state.orgId);
      const existingWorkspaceConfig = objectPayload(existingWorkspace?.config) ?? {};
      await recordInstall({
        orgId: state.orgId,
        surfaceId: surface.id,
        surfaceTenantId: teamId,
        tenantName: teamName,
        workspaceConfig: existingWorkspaceConfig,
        surfaceAgentId: perAgent.id,
        externalAppId: appId,
        encryptedBotToken: encryptSurfaceSecret(accessToken),
        botUserId,
        installedByUserId: state.userId,
      });
      log.info(`[surfaces-slack] installed per-agent app ${appId} for org ${state.orgId}`);
      res.redirect(frontendOrganizationUrl("slack_connected", "true"));
      return;
    }

  } catch (err) {
    log.error("[surfaces-slack] OAuth callback failed", {
      errorType: err instanceof Error ? err.name : "UnknownError",
    });
    res.redirect(frontendOrganizationUrl("slack_error", "connection_failed"));
  }
});
