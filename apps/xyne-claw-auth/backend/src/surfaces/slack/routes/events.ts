/**
 * Slack Events API inbound: per-app HMAC verification (api_app_id), retry
 * dedup, url_verification challenges, and dispatch of mentions/DMs through
 * the shared Slack run pipeline. Acks inside Slack's 3-second deadline; all
 * heavy work happens after the response is committed.
 */
import type { Prisma } from "@prisma/client";
import { errMsg } from "../../../lib/errors.js";
import { Router, type Request, type Response } from "express";
import { prisma } from "../../../db.js";
import { createLogger } from "../../../logger.js";
import { getSurfaceAdapter } from "../../../lib/surface-adapter.js";
import {
  decryptSurfaceSecret,
  getConnectedSurfaceSigningSecret,
  resolveInboundForTenant,
  resolveSurfaceTenant,
  SurfaceResolverError,
} from "../../../lib/surface-resolver.js";
import { agentBotToken, postSlackMessage } from "../delivery.js";
import { dispatchSlackRun, slackConversationId, type BoundSlackSurfaceAgent } from "../dispatch.js";
import { resolveSlackUserByEmail } from "../identity.js";
import { objectPayload } from "./shared.js";
import { findSurfaceAgentByAppId, getInstall } from "../store.js";
import { EVENT_DEDUP_TTL_MS, MAX_EVENT_DEDUP_ENTRIES } from "../const.js";

const log = createLogger("slack-events");
export const eventsRouter = Router();
const router = eventsRouter;


const seenEvents = new Map<string, number>();

function isDuplicate(key: string, now = Date.now()): boolean {
  const seenAt = seenEvents.get(key);
  if (seenAt !== undefined && now - seenAt <= EVENT_DEDUP_TTL_MS) {
    seenEvents.delete(key);
    seenEvents.set(key, seenAt);
    return true;
  }

  if (seenAt !== undefined) seenEvents.delete(key);
  seenEvents.set(key, now);
  while (seenEvents.size > MAX_EVENT_DEDUP_ENTRIES) {
    const oldest = seenEvents.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    seenEvents.delete(oldest);
  }
  return false;
}

function slackEventRecord(raw: unknown): Record<string, unknown> | null {
  return objectPayload(objectPayload(raw)?.["event"]);
}

function stripSlackBotMention(text: string, botUserId: string): string {
  if (!botUserId) return text.trim();
  const escaped = botUserId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text
    .replace(new RegExp(`<@${escaped}>`, "g"), " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function processBoundSlackEvent(input: {
  event: {
    eventType: "APP_MENTIONED" | "DIRECT_MESSAGE";
    surfaceTenantId: string;
    surfaceUserId: string;
    channelId: string;
    threadId?: string;
    text: string;
    eventId: string;
    raw: unknown;
  };
  surfaceId: string;
  orgId: string;
  resolvedUserId: string | null;
  surfaceAgent: BoundSlackSurfaceAgent;
}): Promise<void> {
  const { event, surfaceAgent } = input;
  const install = await getInstall(surfaceAgent.id, event.surfaceTenantId);
  const botToken = install?.encryptedBotToken
    ? decryptSurfaceSecret(install.encryptedBotToken, "Slack bot token")
    : null;
  if (!botToken) throw new Error(`Slack bot install missing for team ${event.surfaceTenantId}`);

  const rawEvent = slackEventRecord(event.raw);
  const eventTs = typeof rawEvent?.["ts"] === "string" ? rawEvent["ts"] : "";
  const threadRootTs = event.threadId ?? eventTs;
  if (!threadRootTs) throw new Error(`Slack event ${event.eventId} is missing ts`);

  const userId = await resolveSlackUserByEmail({
    currentUserId: input.resolvedUserId,
    surfaceId: input.surfaceId,
    orgId: input.orgId,
    teamId: event.surfaceTenantId,
    slackUserId: event.surfaceUserId,
    botToken,
  });
  if (!userId) {
    await postSlackMessage(botToken, {
      channel: event.channelId,
      threadTs: threadRootTs,
      text: "Your Slack account isn't linked to a Xyne Claw user yet — sign in to claw with your work email first",
    });
    return;
  }

  const botUserId = install?.botUserId ?? "";
  const task =
    event.eventType === "APP_MENTIONED" ? stripSlackBotMention(event.text, botUserId) : event.text.trim();
  if (!task) return;

  const conversationId = slackConversationId(event.surfaceTenantId, event.channelId, threadRootTs);
  await dispatchSlackRun({
    agent: surfaceAgent.agent,
    surfaceAgentId: surfaceAgent.id,
    userId,
    task,
    conversationId,
    eventType: event.eventType,
    idempotencyKey: event.eventId,
    teamId: event.surfaceTenantId,
    channelId: event.channelId,
    threadRootTs,
    slackUserId: event.surfaceUserId,
    ...(eventTs ? { sourceMessageId: eventTs } : {}),
  });

  // Slack thread IDs are opaque conversation keys throughout the run/chat
  // repositories. Queueing is intentionally deferred for v1; each inbound gets
  // its own run session while deterministic conversationId preserves history.
  void postSlackMessage(botToken, {
    channel: event.channelId,
    threadTs: threadRootTs,
    text: `⏳ ${surfaceAgent.agent.name} is working on it…`,
  }).catch((error) =>
    log.warn("[surfaces-slack] failed to post working acknowledgement", {
      error: errMsg(error),
    }),
  );
}

/**
 * Deterministic per-thread conversation id. claw's /internal/run restricts
 * ids to [A-Za-z0-9_-] (they flow into filesystem paths and cleanup), so
 * Slack's ":"-separated ids and "."-form timestamps must be flattened.
 */

router.post("/events", async (req: Request, res: Response) => {
  let claimedEventKey: string | null = null;
  try {
    const payload = objectPayload(req.body);
    const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
    const adapter = getSurfaceAdapter("slack");
    if (!payload || !rawBody || !adapter) {
      res.status(adapter ? 401 : 500).json({ success: false, error: "Unauthorized" });
      return;
    }

    if (payload["type"] === "url_verification" && typeof payload["challenge"] === "string") {
      let verified = false;
      if (!verified) {
        const apiAppId = typeof payload["api_app_id"] === "string" ? payload["api_app_id"].trim() : "";
        const verifyCandidates = async (where: Prisma.SurfaceAgentWhereInput): Promise<boolean> => {
          const candidates = await prisma.surfaceAgent.findMany({
            where,
            select: { signingSecret: true },
          });
          for (const candidate of candidates) {
            if (!candidate.signingSecret) continue;
            try {
              const secret = decryptSurfaceSecret(candidate.signingSecret, "Slack signing secret");
              if (adapter.verifySignature(rawBody, req.headers, secret)) return true;
            } catch {
              // A malformed row must not prevent another per-agent secret from matching.
            }
          }
          return false;
        };
        verified = await verifyCandidates({
          signingSecret: { not: null },
          ...(apiAppId ? { config: { path: ["appId"], equals: apiAppId } } : {}),
        });
        if (!verified && apiAppId) {
          verified = await verifyCandidates({ signingSecret: { not: null } });
        }
      }
      if (!verified) {
        res.status(401).json({ success: false, error: "Unauthorized" });
        return;
      }
      res.json({ challenge: payload["challenge"] });
      return;
    }

    const surfaceTenantId = typeof payload["team_id"] === "string" ? payload["team_id"] : null;
    if (!surfaceTenantId) {
      res.status(401).json({ success: false, error: "Unauthorized" });
      return;
    }

    const tenant = await resolveSurfaceTenant("slack", surfaceTenantId);
    const apiAppId = typeof payload["api_app_id"] === "string" ? payload["api_app_id"].trim() : "";
    const surfaceAgent = apiAppId ? await findSurfaceAgentByAppId(tenant.surface.id, apiAppId) : null;
    if (surfaceAgent && surfaceAgent.agent.orgId !== tenant.connectedSurface.orgId) {
      res.status(401).json({ success: false, error: "Unauthorized" });
      return;
    }

    let verified = false;
    if (surfaceAgent?.signingSecret) {
      try {
        verified = adapter.verifySignature(
          rawBody,
          req.headers,
          decryptSurfaceSecret(surfaceAgent.signingSecret, "Slack signing secret"),
        );
      } catch {
        verified = false;
      }
    }
    if (!verified) {
      const connectedSecret = getConnectedSurfaceSigningSecret(tenant.connectedSurface);
      if (connectedSecret) verified = adapter.verifySignature(rawBody, req.headers, connectedSecret);
    }
    if (!verified) {
      res.status(401).json({ success: false, error: "Unauthorized" });
      return;
    }

    const event = adapter.parseInbound(payload);
    if (!event) {
      res.sendStatus(200);
      return;
    }
    claimedEventKey = `${event.surfaceTenantId}:${event.eventId}`;
    if (isDuplicate(claimedEventKey)) {
      claimedEventKey = null;
      res.sendStatus(200);
      return;
    }
    const resolved = await resolveInboundForTenant(
      tenant,
      event.surfaceUserId,
      surfaceAgent
        ? {
            surfaceAgentId: surfaceAgent.id,
            agentId: surfaceAgent.agent.id,
            agentSlug: surfaceAgent.agent.slug,
          }
        : undefined,
    );
    log.info(
      `[surfaces-slack] resolved event=${event.eventId} tenant=${event.surfaceTenantId} org=${resolved.orgId} user=${resolved.userId ?? "(public-only)"} publicOnly=${resolved.publicOnly}`,
    );
    res.sendStatus(200);
    if (surfaceAgent && (event.eventType === "APP_MENTIONED" || event.eventType === "DIRECT_MESSAGE")) {
      // Slack's three-second deadline ends here. Identity auto-link, provider
      // resolution and run dispatch all happen after the response is committed.
      void processBoundSlackEvent({
        event,
        surfaceId: tenant.surface.id,
        orgId: tenant.connectedSurface.orgId,
        resolvedUserId: resolved.userId,
        surfaceAgent: surfaceAgent as BoundSlackSurfaceAgent,
      }).catch(async (error) => {
        log.error("[surfaces-slack] asynchronous event dispatch failed", {
          eventId: event.eventId,
          error: errMsg(error),
        });
        try {
          const botToken = await agentBotToken(surfaceAgent.id, event.surfaceTenantId);
          const rawEvent = slackEventRecord(event.raw);
          const eventTs = typeof rawEvent?.["ts"] === "string" ? rawEvent["ts"] : "";
          const threadTs = event.threadId ?? eventTs;
          if (botToken && threadTs) {
            await postSlackMessage(botToken, {
              channel: event.channelId,
              threadTs,
              text: "Something went wrong dispatching this to the agent — please retry",
            });
          }
        } catch (replyError) {
          log.warn("[surfaces-slack] failed to post dispatch failure reply", {
            eventId: event.eventId,
            error: errMsg(replyError),
          });
        }
      });
    }
  } catch (err) {
    // Do not poison retries when processing the authenticated event failed.
    if (claimedEventKey) seenEvents.delete(claimedEventKey);
    if (
      err instanceof SurfaceResolverError &&
      (err.code === "UNKNOWN_TENANT" || err.code === "UNKNOWN_SURFACE")
    ) {
      res.status(401).json({ success: false, error: "Unauthorized" });
      return;
    }
    if (err instanceof SurfaceResolverError && err.code === "INVALID_SIGNING_SECRET") {
      res.status(401).json({ success: false, error: "Unauthorized" });
      return;
    }
    log.error("[surfaces-slack] inbound event failed:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
