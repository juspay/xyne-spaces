import { Router, type NextFunction, type Request, type Response } from "express";
import { errMsg } from "../lib/errors.js";
import { randomUUID } from "crypto";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { prisma } from "../db.js";
import { CONFIG } from "../config.js";
import { decrypt } from "../crypto.js";
import { spacesAppFetch } from "../lib/spaces-api.js";
import { agentRepository, chatMessageRepository, agentRunRepository, chatAttachmentRepository, userProviderCredentialsRepository, userAgentInstructionRepository } from "../repositories/index.js";
import { resolveBriefAgentSlug } from "../services/dailyBrief.js";
import { buildAgentCatalog } from "../services/agentCatalogService.js";
import { gcsService } from "../services/storageService.js";
import {
  normalizeAttachedContext,
  buildAttachedContextPayload,
  type AttachedContextRef,
} from "../services/agentChatContextService.js";
import { storeForSession as storeAttachedContextForSession } from "../mcp/attached-context-injector.js";
import { storeRunScalars } from "../mcp/run-scalars.js";
import { parseSdlcAgentRunContext } from "../mcp/sdlc-baseline-run-context.js";
import type { SpacesAuthContext } from "../mcp/servers/xyne-spaces-client.js";
import { resolveCustomSubagentsForRun } from "../lib/subagent-resolver.js";
import {
  resolveCallableAgentsForRun,
  resolveCallableAgentSpecForOrchestratorCall,
  resolveOrchestratorCallableAgentsForRun,
} from "../lib/callable-agent-resolver.js";

import {
  buildSdlcAgentToolProfile,
  ClawSseParser,
  parseToolsConfig,
  stripPlatformConfigKeys,
  isAgentInvocableBy,
} from "xyne-claw-shared";
import { tools as xyneSpacesTools } from "../mcp/servers/xyne-spaces-tools.js";
import { mintSessionToken, verifySessionToken } from "../lib/session-tokens.js";
import { consumeAlreadyOpenStream, streamDispatcher } from "../lib/consume-claw-stream.js";
import {
  resolveAgentProviderConfigs,
  resolveSubagentProviderMode,
  type ProviderConfig,
} from "../lib/agent-provider-config.js";
import { resolveFastMode } from "../lib/fast-mode.js";
import { withAwakeningSendTool } from "../awakening/send-tool.js";
import { redisService } from "../redis.js";
import {
  requireAuth,
  requireStrictS2S,
  requireUserAuth,
  requireResultToken,
  s2sKeyMatches,
} from "../middleware/require-auth.js";
import { handleRunCompletion, handleRunHandoff } from "../queue/run-recovery-worker.js";
import { getDmChannelForUserAndApp, getSpacesAuthForUser, getWorkspaceIdForUser } from "../lib/spaces-db.js";
import { isAllowedExternalCallbackUrl, isInternalCallbackOrigin, type ExternalResultCallbackConfig } from "../surfaces/external-api/delivery.js";
import type { VerifiedCliToken } from "../lib/cli-tokens.js";
import { agentScopeAllows, canPostToChannels, sanitizeExternalRunBody } from "../lib/service-tokens.js";
import { encryptSurfaceSecret } from "../lib/surface-resolver.js";
import { decryptStoredField } from "../surfaces/spaces/client.js";

import { createLogger } from "../logger.js";
import { getRequesterId, getOrgId } from "../middleware/agent-acl.js";
import { fetchClawRunWithRetry } from "../lib/claw-fetch.js";
import {
  armHeadlessFinalizeCheck,
  isScheduledOrAutomationEvent,
  postBrokenSseTerminalCallback,
} from "../lib/run-bridge.js";
import {
  prepareRun,
  persistRunStart,
  startRun,
  RECORDING_REF_PREFIX,
  RECORDING_MAX_BYTES,
  type RunCaller,
  type RunRecordingRef,
  type StartRunInput,
} from "../lib/start-run.js";
import type { SessionContext } from "./webhook.js";
const log = createLogger("run");
const SDLC_AGENT_TOOL_PROFILE = buildSdlcAgentToolProfile(
  xyneSpacesTools.map((tool) => tool.name),
);

const router = Router();



function requireRunCaller(req: Request, res: Response, next: NextFunction): void | Promise<void> {
  if (req.originalUrl.includes("/internal/run")) {
    return requireAuth(req, res, next);
  }
  if ((req.body as { triggerSource?: unknown } | undefined)?.triggerSource === "api") {
    return requireAuth(req, res, next);
  }
  return requireUserAuth(req, res, next);
}



// ── Resolve Spaces auth from request (for service-to-service calls) ──

async function resolveSpacesAuthFromRequest(
  req: Request,
  userId?: string,
): Promise<SpacesAuthContext | undefined> {
  try {
    // Parse cookies — may be absent, header/Authorization fallbacks still apply.
    const cookieMap = new Map<string, string>();
    const cookies = req.headers.cookie;
    if (cookies) {
      for (const cookie of cookies.split(";")) {
        const [name, ...rest] = cookie.trim().split("=");
        if (name && rest.length > 0) {
          cookieMap.set(name, rest.join("="));
        }
      }
    }

    // Workspace id: x-workspace-id header → xyne_last_workspace cookie
    const workspaceHeader = req.headers["x-workspace-id"];
    const workspaceId =
      typeof workspaceHeader === "string" && workspaceHeader.trim()
        ? workspaceHeader.trim()
        : cookieMap.get("xyne_last_workspace");

    // Token: workspace-scoped JWT → legacy google_access_token JWT → Authorization Bearer
    let token: string | undefined;
    if (workspaceId) {
      const wsToken = cookieMap.get(`xyne_ws_${workspaceId}_token`);
      if (wsToken && wsToken.split(".").length === 3) {
        token = wsToken;
      }
    }
    if (!token) {
      const legacy = cookieMap.get("google_access_token");
      if (legacy && legacy.split(".").length === 3) {
        token = legacy;
      }
    }
    if (!token) {
      const authHeader = req.headers.authorization;
      if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
        token = authHeader.slice(7);
      }
    }

    // Session id: x-session-id header → xyne_session cookie → user_session_id cookie.
    // Spaces' authV2 sets `user_session_id`, not `xyne_session` — checking both
    // keeps legacy callers working while fixing the dominant miss.
    const sessionHeader = req.headers["x-session-id"];
    const sessionId =
      typeof sessionHeader === "string" && sessionHeader.trim()
        ? sessionHeader.trim()
        : (cookieMap.get("xyne_session") ?? cookieMap.get("user_session_id"));

    if (!token && !sessionId) return undefined;

    const effectiveWorkspaceId =
      workspaceId ??
      (userId ? await getWorkspaceIdForUser(userId, "require-auth").catch(() => null) : null) ??
      undefined;
    if (!workspaceId && effectiveWorkspaceId) {
      log.info(
        `[run] resolved Spaces workspaceId=${effectiveWorkspaceId} from user row for userId=${userId ?? "unknown"}`,
      );
    }

    return {
      ...(token ? { token } : {}),
      ...(sessionId ? { sessionId } : {}),
      ...(effectiveWorkspaceId ? { workspaceId: effectiveWorkspaceId } : {}),
    };
  } catch (err) {
    log.warn("[run] Failed to resolve Spaces auth from request:", err);
    return undefined;
  }
}


// ── POST /clone-session — forward chat-branching session clone to xyne-claw ──
//
// claw-auth doesn't own PI session files (xyne-claw does), so chat branching
// asks xyne-claw to materialize a sibling JSONL via SessionManager.createBranchedSession.
// This route is the S2S bridge. Body: { sourceConversationId, targetConversationId, branchMode? }
router.post("/clone-session", requireStrictS2S, async (req: Request, res: Response) => {
  const { sourceConversationId, targetConversationId, branchMode } = req.body as {
    sourceConversationId?: string;
    targetConversationId?: string;
    branchMode?: "lastUser" | "beforeLastUser" | "full";
  };
  if (branchMode !== undefined && branchMode !== "lastUser" && branchMode !== "beforeLastUser" && branchMode !== "full") {
    res.status(400).json({ success: false, error: "branchMode must be lastUser, beforeLastUser or full" });
    return;
  }
  if (!sourceConversationId || typeof sourceConversationId !== "string") {
    res.status(400).json({ success: false, error: "sourceConversationId is required" });
    return;
  }
  if (!targetConversationId || typeof targetConversationId !== "string") {
    res.status(400).json({ success: false, error: "targetConversationId is required" });
    return;
  }
  try {
    const clawRes = await fetch(`${CONFIG.xyneClawUrl}/clone-session`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(CONFIG.xyneClawS2sKey ? { "x-s2s-key": CONFIG.xyneClawS2sKey } : {}),
      },
      body: JSON.stringify({
        sourceConversationId,
        targetConversationId,
        branchMode: branchMode ?? "lastUser",
      }),
    });
    const body = (await clawRes.json().catch(() => ({}))) as { success?: boolean; error?: string };
    if (!clawRes.ok) {
      res.status(clawRes.status).json({ success: false, error: body.error ?? `HTTP ${clawRes.status}` });
      return;
    }
    res.json({ success: body.success === true, ...(body.error ? { error: body.error } : {}) });
  } catch (err) {
    log.error("[run] clone-session forward failed:", err instanceof Error ? err.message : err);
    res.status(502).json({ success: false, error: "Failed to reach agent service" });
  }
});

router.get("/callable-agent-spec", requireStrictS2S, async (req: Request, res: Response) => {
  try {
    const caller = (req.query["caller"] as string | undefined)?.trim();
    const callee = (req.query["callee"] as string | undefined)?.trim();
    const userId = (req.query["userId"] as string | undefined)?.trim();
    const sessionId = (req.query["sessionId"] as string | undefined)?.trim();
    if (!caller || !callee || !userId || !sessionId) {
      res.status(400).json({ success: false, error: "caller, callee, userId, and sessionId are required" });
      return;
    }

    const resolvedSpec = await resolveCallableAgentSpecForOrchestratorCall(prisma, {
      callerSlug: caller,
      calleeSlug: callee,
      userId,
    });
    if ("error" in resolvedSpec) {
      res.status(resolvedSpec.status).json({ success: false, error: resolvedSpec.error });
      return;
    }

    res.json({
      success: true,
      data: {
        ...resolvedSpec.spec,
        sessionToken: mintSessionToken({
          sessionId,
          userId,
          agentSlug: resolvedSpec.spec.slug,
          ...(resolvedSpec.spec.spacesAppId ? { spacesAppId: resolvedSpec.spec.spacesAppId } : {}),
          ttlSeconds: 6 * 60 * 60,
        }),
      },
    });
  } catch (err) {
    log.error("[run] callable-agent-spec error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/**
 * Stream one recording that was explicitly attached to this run. Sandboxes
 * have no egress; xyne-claw presents its S2S key + per-run token and relays
 * this response through the Kata file API in bounded chunks.
 */
router.get(
  "/run/:sessionId/recordings/:attachmentId",
  requireStrictS2S,
  requireResultToken((req) => req.params["sessionId"]),
  async (req: Request<{ sessionId: string; attachmentId: string }>, res: Response): Promise<void> => {
    const sessionId = req.params.sessionId;
    const attachmentId = req.params.attachmentId;
    const token = verifySessionToken(req.headers["x-session-token"] as string | undefined);
    if (typeof token === "string") {
      res.status(401).json({ success: false, error: `session token ${token}` });
      return;
    }

    const redis = redisService.getConnection();
    const storedRaw = await redis.get(`${RECORDING_REF_PREFIX}${sessionId}`).catch(() => null);
    if (!storedRaw) {
      res.status(404).json({ success: false, error: "No recordings are registered for this run" });
      return;
    }
    let stored: { userId?: string; refs?: RunRecordingRef[] };
    try {
      stored = JSON.parse(storedRaw) as { userId?: string; refs?: RunRecordingRef[] };
    } catch {
      res.status(500).json({ success: false, error: "Recording reference state is invalid" });
      return;
    }
    if (stored.userId !== token.uid) {
      res.status(403).json({ success: false, error: "Recording owner does not match this run" });
      return;
    }
    const ref = stored.refs?.find((candidate) => candidate.attachmentId === attachmentId);
    if (!ref) {
      res.status(404).json({ success: false, error: "Recording was not attached to this run" });
      return;
    }

    const sources: Array<{ label: string; url: string; headers: Record<string, string> }> = [];
    const live = await getSpacesAuthForUser(token.uid, "webhook").catch(() => null);
    if (live) {
      const cookie = [
        `google_access_token=${live.token}`,
        `user_session_id=${live.sessionId}`,
        `xyne_session=${live.sessionId}`,
        `xyne_last_workspace=${live.workspaceId}`,
      ].join("; ");
      sources.push({
        label: "user-token",
        url: `${CONFIG.spacesInternalUrl}/api/attachments/${encodeURIComponent(attachmentId)}/download`,
        headers: {
          Authorization: `Bearer ${live.token}`,
          "x-session-id": live.sessionId,
          "x-workspace-id": live.workspaceId,
          Cookie: cookie,
        },
      });
    }
    if (token.appid) {
      const agent = await agentRepository.findBySpacesAppId(token.appid).catch(() => null);
      if (agent?.spacesAppToken) {
        try {
          const appToken = decryptStoredField(agent.spacesAppToken);
          sources.push({
            label: "apps-route",
            url: `${CONFIG.spacesInternalUrl}/api/apps/attachments/${encodeURIComponent(attachmentId)}/download`,
            headers: { Authorization: `Bearer ${appToken}` },
          });
        } catch (error) {
          log.warn(`[recording-stream] could not decrypt app token for appid=${token.appid}: ${errMsg(error)}`);
        }
      }
    }
    if (sources.length === 0) {
      res.status(401).json({ success: false, error: "No Spaces credential is available for this recording" });
      return;
    }

    let upstream: globalThis.Response | null = null;
    const failures: string[] = [];
    for (const source of sources) {
      try {
        const candidate = await fetch(source.url, {
          headers: source.headers,
          signal: AbortSignal.timeout(30 * 60 * 1000),
        });
        if (candidate.ok && candidate.body) {
          upstream = candidate;
          break;
        }
        failures.push(`${source.label}: HTTP ${candidate.status}`);
        await candidate.body?.cancel().catch(() => undefined);
      } catch (error) {
        failures.push(`${source.label}: ${errMsg(error)}`);
      }
    }
    if (!upstream?.body) {
      log.warn(`[recording-stream] session=${sessionId} attachment=${attachmentId} failed: ${failures.join(" | ")}`);
      res.status(502).json({ success: false, error: "Failed to download recording from Spaces" });
      return;
    }

    const declaredLength = Number(upstream.headers.get("content-length") ?? ref.fileSize);
    if (Number.isFinite(declaredLength) && declaredLength > RECORDING_MAX_BYTES) {
      await upstream.body.cancel().catch(() => undefined);
      res.status(413).json({ success: false, error: "Recording exceeds the 1 GB limit" });
      return;
    }
    res.status(200);
    res.setHeader("Content-Type", ref.mimeType);
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(ref.fileName)}`);
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Recording-Expected-Bytes", String(ref.fileSize));

    let streamedBytes = 0;
    const limiter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        streamedBytes += chunk.length;
        if (streamedBytes > RECORDING_MAX_BYTES) {
          callback(new Error("recording stream exceeded 1 GB"));
          return;
        }
        callback(null, chunk);
      },
    });
    try {
      await pipeline(
        Readable.fromWeb(upstream.body as ReadableStream<Uint8Array>),
        limiter,
        res,
      );
      log.info(`[recording-stream] session=${sessionId} attachment=${attachmentId} bytes=${streamedBytes}`);
    } catch (error) {
      log.warn(`[recording-stream] session=${sessionId} attachment=${attachmentId} interrupted: ${errMsg(error)}`);
      if (!res.headersSent) res.status(502).json({ success: false, error: "Recording stream failed" });
      else res.destroy(error instanceof Error ? error : undefined);
    }
  },
);

// ── POST /run — accept task, resolve identity + agent, forward to xyne-claw ──

router.post("/run", requireRunCaller, async (req: Request, res: Response) => {
  // Service tokens get the EXTERNAL body contract: unknown fields (provider
  // overrides, eventType, session plumbing) are stripped before the shared
  // destructure below ever sees them — external traffic must not be able to
  // masquerade as internal traffic.
  const serviceToken = (res.locals ?? {})["accessToken"] as VerifiedCliToken | undefined;
  const isServiceTokenCaller = serviceToken?.client === "service";
  if (isServiceTokenCaller) {
    // Channel-delivery fields (channelId/deliverTo) survive the strip ONLY
    // when the token carries CHANNELS_POST_SCOPE; otherwise external callers
    // still cannot address a Spaces channel.
    const allowChannelDelivery = canPostToChannels(serviceToken?.scopes ?? []);
    const { sanitized, dropped } = sanitizeExternalRunBody(req.body as Record<string, unknown>, { allowChannelDelivery });
    if (dropped.length > 0) {
      log.warn(`[run] service token dropped non-contract fields: ${dropped.join(", ")}`);
    }
    req.body = sanitized;
  }

  const acceptHeader = (req.headers["accept"] as string | undefined) ?? "";
  const wantsSse = acceptHeader.includes("text/event-stream");
  const input: StartRunInput = {
    body: req.body as Record<string, unknown>,
    isInternalRun: req.baseUrl.includes("/internal"),
    isInternalS2SCaller: s2sKeyMatches(req.headers["x-s2s-key"]),
    wantsSse,
    authenticatedUserId: getRequesterId(req),
    headerOrgId: getOrgId(req),
    resolveSpacesAuth: (userId: string) => resolveSpacesAuthFromRequest(req, userId),
  };
  const caller: RunCaller = { serviceToken };

  if (!wantsSse) {
    const result = await startRun(input, caller);
    if (!result.ok) {
      res.status(result.status).json({ success: false, error: result.error });
      return;
    }
    res.status(input.body["detached"] === true ? 202 : 200).json({
      success: true,
      sessionId: result.sessionId,
    });
    return;
  }

  // SSE pass-through: the caller (run-stream.ts) opted into the streaming
  // transport via Accept: text/event-stream. The response IS the stream, so
  // this branch stays in the route shell; everything before the wire
  // (identity, agent resolution, forwardBody assembly) is prepareRun's.
  try {
    const preparation = await prepareRun(input, caller);
    if (!preparation.ok) {
      res.status(preparation.status).json({ success: false, error: preparation.error });
      return;
    }
    const prepared = preparation.prepared;
    const { sessionId, sessionToken, forwardBody, conversationId, agentSlug, eventType, callbackUrl } =
      prepared;

    log.info(`[run] proxy: forwarding SSE upstream to claw (sessionId=${sessionId})`);
    const clawRes = await fetchClawRunWithRetry(
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          ...(CONFIG.xyneClawS2sKey ? { "x-s2s-key": CONFIG.xyneClawS2sKey } : {}),
        },
        body: JSON.stringify(forwardBody),
      },
      "sse-pass-through",
    );

    if (!clawRes.ok || !clawRes.body) {
      const errText = await clawRes.text().catch(() => "");
      log.error(`[run] proxy: claw SSE returned ${clawRes.status}: ${errText.slice(0, 300)}`);
      res
        .status(clawRes.status || 502)
        .json({ success: false, error: errText || "Failed to reach agent service" });
      return;
    }

    // Persist user message + AgentRun start NOW (same conditions as the JSON
    // path below) since the SSE response will not surface a separate
    // {success, sessionId} hand-off.
    await persistRunStart(prepared);

    // Stream the upstream SSE response straight to the caller. The caller
    // (consumeClawStream) parses frames as they arrive — we just have to
    // not buffer.
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    // If the caller (run-stream.ts) drops, propagate to claw by cancelling
    // the upstream reader so claw's res.on("close") fires and the agent
    // abort path runs. Use res.on("close") on the inbound response, NOT
    // req.on("close") — the latter fires as soon as Express's body parser
    // finishes consuming the request body (well before we're done piping),
    // which would tear down the upstream prematurely.
    const upstreamReader = (clawRes.body as ReadableStream<Uint8Array>).getReader();
    res.on("close", () => {
      if (!res.writableEnded) {
        log.info(`[run] proxy: caller disconnected, cancelling claw upstream (sessionId=${sessionId})`);
        try {
          upstreamReader.cancel();
        } catch {
          /* already done */
        }
      }
    });

    const parser = new ClawSseParser();
    const decoder = new TextDecoder("utf-8");
    let sawDone = false;
    let streamBroken = false;
    try {
      for (;;) {
        const { value, done } = await upstreamReader.read();
        if (done) break;
        if (value) {
          for (const event of parser.feed(decoder.decode(value, { stream: true }))) {
            if (event.event === "done") sawDone = true;
          }
          if (!res.write(Buffer.from(value))) {
            // backpressure: wait for drain before reading the next chunk so
            // we don't accumulate the agent's text deltas in the Node heap
            await new Promise<void>((resolve) => res.once("drain", () => resolve()));
          }
        }
      }
    } catch (pipeErr) {
      streamBroken = true;
      log.error(
        `[run] proxy: SSE pipe error (sessionId=${sessionId}):`,
        errMsg(pipeErr),
      );
      if (!res.writableEnded) {
        try {
          res.write(
            `event: error\ndata: ${JSON.stringify({ error: pipeErr instanceof Error ? pipeErr.message : "pipe error" })}\n\n`,
          );
        } catch {
          /* socket gone */
        }
      }
    } finally {
      try {
        upstreamReader.releaseLock();
      } catch {
        /* ignore */
      }
      if (!sawDone) {
        if (callbackUrl && !isScheduledOrAutomationEvent(eventType)) {
          // Same headless tolerance as the legacy-bridge paths: the runtime
          // keeps running after a consumer disconnect and finalizes via its
          // callback — synthesizing failure here raced that and mislabeled
          // ~47 live runs/day as "sse stream broken" (prod 2026-07-09).
          log.warn(`[run] proxy: pass-through stream lost; run continues headless (session=${sessionId})`);
          armHeadlessFinalizeCheck({
            sessionId,
            sessionToken,
            callbackUrl,
            conversationId: typeof conversationId === "string" ? conversationId : undefined,
            agentSlug: typeof agentSlug === "string" ? agentSlug : undefined,
            eventType,
            fastMode: prepared.effectiveFastMode,
          });
        } else {
          await postBrokenSseTerminalCallback({
            callbackUrl,
            sessionId,
            sessionToken,
            conversationId: typeof conversationId === "string" ? conversationId : undefined,
            agentSlug: typeof agentSlug === "string" ? agentSlug : undefined,
            eventType,
            fastMode: prepared.effectiveFastMode,
            logPrefix: streamBroken ? "pass-through pipe error" : "pass-through ended before done",
          });
        }
      }
      if (!res.writableEnded) {
        try {
          res.end();
        } catch {
          /* ignore */
        }
      }
    }
  } catch (err) {
    log.error("[run] Error forwarding to xyne-claw:", err);
    if (!res.headersSent) res.status(502).json({ success: false, error: "Failed to reach agent service" });
  }
});

async function forwardRunControl(
  action: "cancel" | "interrupt-with-reply",
  req: Request<{ sessionId: string }>,
  res: Response,
): Promise<void> {
  const { sessionId } = req.params;
  if (!sessionId || typeof sessionId !== "string") {
    res.status(400).json({ success: false, error: "sessionId is required" });
    return;
  }

  const callerUserId = req.headers["x-user-id"];
  if (typeof callerUserId !== "string" || !callerUserId.trim()) {
    res.status(400).json({ success: false, error: "x-user-id is required" });
    return;
  }

  try {
    const clawRes = await fetch(`${CONFIG.xyneClawUrl}/run/${encodeURIComponent(sessionId)}/${action}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(CONFIG.xyneClawS2sKey ? { "x-s2s-key": CONFIG.xyneClawS2sKey } : {}),
        "x-user-id": callerUserId,
      },
    });

    const body = (await clawRes.json().catch(() => null)) as Record<string, unknown> | null;
    if (!clawRes.ok) {
      res
        .status(clawRes.status)
        .json(body ?? { success: false, error: `${action} failed: HTTP ${clawRes.status}` });
      return;
    }

    res.json(body ?? { success: true, sessionId });
  } catch (err) {
    log.error(`[run] Error forwarding ${action} to xyne-claw:`, err);
    res.status(502).json({ success: false, error: "Failed to reach agent service" });
  }
}

// ── POST /run/:sessionId/interrupt-with-reply — ask active run to post a partial reply, then drain queued follow-up ──
router.post(
  "/run/:sessionId/interrupt-with-reply",
  requireRunCaller,
  async (req: Request<{ sessionId: string }>, res: Response) => {
    await forwardRunControl("interrupt-with-reply", req, res);
  },
);

// ── POST /run/:sessionId/cancel — proxy cancel to xyne-claw ──
router.post(
  "/run/:sessionId/cancel",
  requireRunCaller,
  async (req: Request<{ sessionId: string }>, res: Response) => {
    await forwardRunControl("cancel", req, res);
  },
);

// ── POST /clear-session — proxy to xyne-claw (forget a thread's session) ──
// Hit by webhook.ts when a user types `/clear`. The handler lives on the pod
// (xyne-claw run.ts); claw-auth only needs to forward it. requireStrictS2S
// because runRouter is also mounted at the unauthenticated BASE, so the route
// must self-protect; the webhook supplies the same xyneClawS2sKey end-to-end.
router.post("/clear-session", requireStrictS2S, async (req: Request, res: Response) => {
  try {
    const clawRes = await fetch(`${CONFIG.xyneClawUrl}/clear-session`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(CONFIG.xyneClawS2sKey ? { "x-s2s-key": CONFIG.xyneClawS2sKey } : {}),
      },
      body: JSON.stringify(req.body ?? {}),
    });

    const body = (await clawRes.json().catch(() => null)) as Record<string, unknown> | null;
    if (!clawRes.ok) {
      res
        .status(clawRes.status)
        .json(body ?? { success: false, error: `clear-session failed: HTTP ${clawRes.status}` });
      return;
    }

    res.json(body ?? { success: true });
  } catch (err) {
    log.error("[run] Error forwarding clear-session to xyne-claw:", err);
    res.status(502).json({ success: false, error: "Failed to reach agent service" });
  }
});

// ── POST /sessions/:id/result — callback from xyne-claw, forward to Xyne Spaces ──

router.post(
  "/sessions/:id/result",
  requireStrictS2S,
  requireResultToken((req) => req.params["id"]),
  async (req: Request<{ id: string }>, res: Response) => {
    const { id } = req.params;
    const payload = req.body as Record<string, unknown>;

    log.info(`[sessions] ${id}: received result (status=${payload["status"] as string})`);

    // Acknowledge xyne-claw immediately (per-run token already verified by
    // requireResultToken middleware).
    res.json({ success: true });

    // Persist assistant message in ChatMessage table (same as /chat callback)
    // so conversations appear in the /conversations history endpoint
    const conversationId = payload["conversationId"] as string | undefined;
    const agentSlug = payload["agentSlug"] as string | undefined;
    const userId = payload["userId"] as string | undefined;
    const content = (payload["result"] as string) || (payload["error"] as string) || "";
    const status = payload["status"] as string;
    const reasoning = (payload["reasoning"] as string | undefined) || undefined;

    if (status === "handoff") {
      const lastTurn = typeof payload["lastTurn"] === "number" ? payload["lastTurn"] : undefined;
      log.info(
        `[sessions] ${id}: handoff callback received conversation=${conversationId ?? ""} agent=${agentSlug ?? ""} lastTurn=${lastTurn ?? "unknown"}`,
      );
      const handoff = await handleRunHandoff(id).catch((err) => {
        log.warn(
          `[sessions] ${id}: handoff re-dispatch failed:`,
          errMsg(err),
        );
        return null;
      });
      if (handoff) {
        log.info(
          `[sessions] ${id}: handoff re-dispatched root=${handoff.rootSessionId} newSession=${handoff.newSessionId}`,
        );
      } else {
        log.warn(
          `[sessions] ${id}: handoff callback had no active recovery state; recovery is not registered for this callback/session`,
        );
      }
      return;
    }

    const toolInvocations = payload["toolInvocations"] as unknown[] | undefined;
    const toolsUsed = payload["toolsUsed"] as string[] | undefined;
    const attachments = payload["attachments"] as
      | Array<{ fileName: string; mimeType: string; data: string }>
      | undefined;

    if (conversationId && userId) {
      try {
        // Persist any tool-generated attachments (e.g. create-ppt .pptx) into GCS
        // and the ChatAttachment table so the UI can render download cards
        const persistedAttachments: Array<{
          id: string;
          mimeType: string;
          originalFilename: string;
          size: number;
        }> = [];

        if (attachments?.length) {
          for (const att of attachments) {
            try {
              const buffer = Buffer.from(att.data, "base64");
              const now = new Date();
              const year = String(now.getUTCFullYear());
              const month = String(now.getUTCMonth() + 1).padStart(2, "0");
              const safeName = att.fileName.replace(/[^\w.\-]+/g, "_").slice(0, 200);
              const destPath = `chat-attachments/${userId}/${year}/${month}/${Date.now()}-${randomUUID()}-${safeName}`;

              await gcsService.uploadFile(buffer, destPath, att.mimeType);

              const row = await prisma.chatAttachment.create({
                data: {
                  uploaderUserId: userId,
                  storageProvider: "gcs",
                  url: destPath,
                  originalFilename: att.fileName,
                  mimeType: att.mimeType,
                  size: buffer.length,
                },
              });

              persistedAttachments.push({
                id: row.id,
                mimeType: row.mimeType,
                originalFilename: row.originalFilename,
                size: row.size,
              });
            } catch (attErr) {
              log.error(
                `[sessions] ${id}: failed to persist attachment ${att.fileName}:`,
                errMsg(attErr),
              );
            }
          }
        }

        const run = await agentRunRepository.findBySessionId(id).catch(() => null);
        if (!run) {
          log.warn(`[run/callback] no AgentRun found for session ${id}; skipping ChatMessage persistence`);
          return;
        }
        const assistantMsg = await chatMessageRepository.create({
          conversationId,
          agentSlug: agentSlug || "assistant",
          userId,
          role: "assistant",
          content,
          status: status === "completed" ? "completed" : "failed",
          orgId: run.orgId,
          ...(reasoning ? { reasoning } : {}),
        });

        // Link attachments to the assistant message
        if (persistedAttachments.length) {
          await chatAttachmentRepository.linkToMessage(
            persistedAttachments.map((a) => a.id),
            assistantMsg.id,
            userId,
          );
        }
      } catch (msgErr) {
        log.warn(
          `[sessions] ${id}: failed to persist assistant message:`,
          errMsg(msgErr),
        );
      }

      // Also finalize the AgentRun with tool invocations so they appear in history
      try {
        await agentRunRepository.finalize(id, {
          status: status === "completed" ? "completed" : "failed",
          result: content,
          error: status !== "completed" ? content : null,
          ...(reasoning ? { reasoning } : {}),
          ...(typeof payload.provider === "string" ? { provider: payload.provider } : {}),
          ...(typeof payload.model === "string" ? { model: payload.model } : {}),
          toolsUsed: toolsUsed ?? [],
          ...(toolInvocations ? { toolInvocations } : {}),
          ...((payload as { fastMode?: boolean }).fastMode !== undefined
            ? { fastMode: (payload as { fastMode?: boolean }).fastMode === true }
            : {}),
        });
      } catch (finalizeErr) {
        log.warn(
          `[sessions] ${id}: failed to finalize agent run:`,
          finalizeErr instanceof Error ? finalizeErr.message : finalizeErr,
        );
      }
    }

    // Forward result to Xyne Spaces
    if (!CONFIG.xyneSpacesCallbackUrl) {
      log.warn(`[sessions] ${id}: no XYNE_SPACES_CALLBACK_URL configured, result not forwarded`);
      return;
    }

    try {
      const { reasoning: _omitReasoning, ...spacesPayload } = payload;
      const spacesRes = await fetch(CONFIG.xyneSpacesCallbackUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(spacesPayload),
      });

      if (!spacesRes.ok) {
        log.error(`[sessions] ${id}: Xyne Spaces callback returned ${spacesRes.status}`);
      }
    } catch (err) {
      log.error(`[sessions] ${id}: failed to forward to Xyne Spaces:`, err);
    }
  },
);

export { router as runRouter };
