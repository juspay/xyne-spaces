/**
 * Slack slash-command inbound (umbrella-app commands): signature-verified,
 * ephemeral 3s ack, in-channel echo as thread root, then dispatch through
 * the shared Slack run pipeline replying with the umbrella bot token.
 */
import { Router, type Request, type Response } from "express";
import { errMsg } from "../../../lib/errors.js";
import { createLogger } from "../../../logger.js";
import { getSurfaceAdapter } from "../../../lib/surface-adapter.js";
import {
  getConnectedSurfaceSigningSecret,
  resolveInboundForTenant,
  resolveSurfaceTenant,
  SurfaceResolverError,
} from "../../../lib/surface-resolver.js";
import { postResponseUrl } from "../api.js";
import { connectedSurfaceBotToken, postSlackMessage } from "../delivery.js";
import { dispatchSlackRun, slackConversationId, type BoundSlackSurfaceAgent } from "../dispatch.js";
import { resolveSlackUserByEmail } from "../identity.js";
import { objectPayload } from "./shared.js";
import { findSurfaceAgentByCommand } from "../store.js";

const log = createLogger("slack-commands");
export const commandsRouter = Router();
const router = commandsRouter;

router.post("/commands", async (req: Request, res: Response) => {
  try {
    const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
    const adapter = getSurfaceAdapter("slack");
    const payload = objectPayload(req.body);
    if (!payload || !rawBody || !adapter) {
      res.status(adapter ? 401 : 500).json({ success: false, error: "Unauthorized" });
      return;
    }
    const field = (name: string): string =>
      typeof payload[name] === "string" ? (payload[name] as string).trim() : "";
    const teamId = field("team_id");
    const command = field("command");
    if (!teamId || !command) {
      res.status(401).json({ success: false, error: "Unauthorized" });
      return;
    }
    const tenant = await resolveSurfaceTenant("slack", teamId);
    // Commands are signed with the UMBRELLA app's signing secret — the
    // snapshot stored on the team's connection row at install time. (All
    // apps are platform-minted; there is no env-credential path.)
    let verified = false;
    const connectedSecret = getConnectedSurfaceSigningSecret(tenant.connectedSurface);
    if (connectedSecret) verified = adapter.verifySignature(rawBody, req.headers, connectedSecret);
    if (!verified) {
      res.status(401).json({ success: false, error: "Unauthorized" });
      return;
    }
    const surfaceAgent = await findSurfaceAgentByCommand(
      tenant.surface.id,
      tenant.connectedSurface.orgId,
      command,
    );
    if (!surfaceAgent) {
      res.json({ response_type: "ephemeral", text: `No agent is registered for ${command} yet.` });
      return;
    }
    // Slack's 3-second deadline: acknowledge ephemerally, then work async.
    res.json({ response_type: "ephemeral", text: `⏳ Dispatching to ${surfaceAgent.agent.name}…` });
    void processSlackCommand({
      tenant,
      surfaceAgent: surfaceAgent as unknown as BoundSlackSurfaceAgent & { agent: { name: string } },
      teamId,
      channelId: field("channel_id"),
      slackUserId: field("user_id"),
      text: field("text"),
      responseUrl: field("response_url"),
      triggerId: field("trigger_id"),
    }).catch(async (error) => {
      log.error("[surfaces-slack] asynchronous command dispatch failed", {
        command,
        error: errMsg(error),
      });
      const responseUrl = field("response_url");
      if (!responseUrl) return;
      // The 3s ack is already sent, so this is the only channel left for
      // telling the user. If even this fails, say so — otherwise they are left
      // watching a spinner with no trace of why.
      const delivered = await postResponseUrl(responseUrl, {
        text: "Something went wrong dispatching this to the agent — please retry",
      });
      if (!delivered) {
        log.error("[surfaces-slack] could not deliver failure notice to response_url", { command });
      }
    });
  } catch (err) {
    if (
      err instanceof SurfaceResolverError &&
      (err.code === "UNKNOWN_TENANT" || err.code === "UNKNOWN_SURFACE")
    ) {
      res.status(401).json({ success: false, error: "Unauthorized" });
      return;
    }
    log.error("[surfaces-slack] Slash-command handling failed", {
      errorType: err instanceof Error ? err.name : "UnknownError",
    });
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

async function processSlackCommand(input: {
  tenant: Awaited<ReturnType<typeof resolveSurfaceTenant>>;
  surfaceAgent: BoundSlackSurfaceAgent;
  teamId: string;
  channelId: string;
  slackUserId: string;
  text: string;
  responseUrl: string;
  triggerId: string;
}): Promise<void> {
  const { tenant, surfaceAgent } = input;
  const task = input.text.trim();
  const connectedSurfaceId = surfaceAgent.commandConnectedSurfaceId ?? tenant.connectedSurface.id;
  const botToken = await connectedSurfaceBotToken(connectedSurfaceId);
  if (!botToken) throw new Error(`Umbrella Slack bot token missing for team ${input.teamId}`);
  if (!task) {
    await postSlackMessage(botToken, {
      channel: input.channelId,
      text: `Usage: give the command a task, e.g. \`${surfaceAgent.commandName ?? "/agent"} summarise today's errors\``,
    });
    return;
  }

  // Echo the ask in-channel (command invocations are invisible otherwise) —
  // the echo message becomes the thread root for the reply + follow-ups.
  const echo = await postSlackMessage(botToken, {
    channel: input.channelId,
    text: `💬 <@${input.slackUserId}> → *${surfaceAgent.agent.name}*: ${task}`,
  });
  const threadRootTs = echo.ts;
  if (!threadRootTs) throw new Error("Slack echo post returned no ts");

  const resolved = await resolveInboundForTenant(tenant, input.slackUserId, {
    surfaceAgentId: surfaceAgent.id,
    agentId: surfaceAgent.agent.id,
    agentSlug: surfaceAgent.agent.slug,
  });
  const userId = await resolveSlackUserByEmail({
    currentUserId: resolved.userId,
    surfaceId: tenant.surface.id,
    orgId: tenant.connectedSurface.orgId,
    teamId: input.teamId,
    slackUserId: input.slackUserId,
    botToken,
  });
  if (!userId) {
    await postSlackMessage(botToken, {
      channel: input.channelId,
      threadTs: threadRootTs,
      text: "Your Slack account isn't linked to a Xyne Claw user yet — sign in to claw with your work email first",
    });
    return;
  }

  const conversationId = slackConversationId(input.teamId, input.channelId, threadRootTs);
  await dispatchSlackRun({
    agent: surfaceAgent.agent,
    surfaceAgentId: surfaceAgent.id,
    connectedSurfaceId,
    userId,
    task,
    conversationId,
    eventType: "APP_MENTIONED",
    idempotencyKey: `slash:${input.teamId}:${input.channelId}:${threadRootTs}`,
    teamId: input.teamId,
    channelId: input.channelId,
    threadRootTs,
    slackUserId: input.slackUserId,
    sourceMessageId: threadRootTs,
  });
}
