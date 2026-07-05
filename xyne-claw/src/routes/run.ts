import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { Router, type Response } from "express";
import {
  runTask,
  pushAttachment,
  applyCopilotProxyIfNeeded,
  RunCancelledError,
  QuotaExhaustedError,
  isQuotaExhaustedError,
  isTransientProviderError,
  type ImageContent,
  type ProgressDest,
  type ProgressEmitter,
  type Attachment,
} from "../agent.js";
import {
  frameSseEvent,
  KEEPALIVE_FRAME,
  type ClawStreamEvent,
  type ClawAttachmentPayload,
  type ClawSandboxPreviewPayload,
  type ClawStreamMeta,
  type ClawDoneStatus,
} from "xyne-claw-shared";
import { SessionLockedError } from "../session-lock.js";
import { isSafeId } from "../safe-id.js";
import { validateS2SKey } from "../middleware/auth.js";
import { loadMcpToolsForUser } from "../mcp.js";
import { loadCustomTools } from "../custom-tools.js";
import { buildCopilotTool } from "../copilot.js";
import {
  buildVerifiedResponseTool,
  SUBMIT_RESPONSE_SYSTEM_INSTRUCTION,
  type EvidenceRef,
} from "../verified-response.js";
import {
  parseModelSettings,
  parseOutputFormat,
  buildSubmitResultTool,
  buildSubmitResultInstruction,
  renderTemplate,
  type StructuredOutputRef,
} from "../agent-model-settings.js";
import { fetchLiteLLMWithRetry } from "../litellm-retry.js";
import {
  buildSubagentTools,
  loadDeepwikiTools,
  loadContext7Tools,
  loadPlaywrightTools,
  type SkillTrigger,
} from "../subagent-tools.js";
import {
  parseToolsConfig,
  COPILOT_SYSTEM_INSTRUCTION,
  REPO_CONFIGS,
  getSandboxSession,
  probeSession,
  buildSandboxStoreKey,
  type SetupStep,
} from "xyne-claw-shared";
import { SERVER, PATHS, LITELLM, isAllowedCallbackUrl } from "../config.js";
import { judgeChainContinuation } from "../chain-judge.js";
import { isDigitalTwinAgent, listSubsystemTaxonomy } from "../memory.js";
import { buildMemorySearchTool } from "../memory-search.js";
import {
  buildSuggestGoalTool,
  type PendingGoalSuggestion,
} from "../suggest-goal-tool.js";
import {
  createWorkspace,
  deleteWorkspace,
  isAllowedCwd,
  writeWorkspaceTextFiles,
  writeWorkspaceBinaryFiles,
} from "../workspace.js";
import { toolOutputBaseDir, deleteSession, branchSession } from "../session-store.js";
import { gcsUploadResultMarker, gcsDownloadResultMarker } from "../gcs.js";
import { takeLlmCitations } from "xyne-claw-shared";
import { ingestAttachments } from "../attachment-ingest.js";
import { metric } from "../metrics.js";
import { runWithProviderFallback } from "../provider-fallback.js";
import { createLogger } from "../logger.js";

const clog = createLogger("run");

const router = Router();

interface ActiveRunControl {
  abortController: AbortController;
  /** Owner of the run. Used to reject cross-user cancellation. */
  userId: string;
  /** True when the abort was triggered by an explicit user cancel (the
   *  /run/:sessionId/cancel endpoint), as opposed to the agent's own
   *  respond-to-user termination (which also aborts the controller). Lets the
   *  catch block honor a user stop instead of posting a just-generated answer. */
  userCancelled?: boolean;
}

const activeRuns = new Map<string, ActiveRunControl>();

// Appended to the agent's systemPrompt at runTime when channelId is present
// (i.e. the agent is replying in a Spaces chat thread). Lives in the system
// role — pi-coding-agent treats it as background context, not a user message,
// so the model accepts it silently instead of replying "Noted — will use the
// inline span format" every turn (which is what happened when this lived in
// the per-turn promptInjections path).
// Appended to the system prompt for agents in CITATION_GUIDE_AGENT_SLUGS only.
// Lives in the system role so the model accepts it silently.
const CITATION_GUIDE_AGENT_SLUGS = new Set<string>(["ask-ai"]);
const CITATION_GUIDE = `

## Citation System

You MUST cite factual claims inline in the response text itself.

Tool outputs may already contain exact citation tokens like \`[clf-abc123#14]\`.
Copy those tokens verbatim. Do NOT invent new refs, do NOT change the tool call id, and do NOT create ranges like \`#14-#18\`.

Rules:
- Every factual claim backed by a tool result must carry at least one citation token.
- Place the token immediately after the sentence or clause it supports.
- Keep punctuation outside the token.
- One citation token = one chunk. If two separate chunks support two separate claims, cite them separately.
- If a claim is supported by multiple chunks, cite each relevant chunk inline.
- Do not append a separate citations section at the end.

Examples:

Correct:
The minimum unit size for InvIT private placements is ₹1 crore [clf-agzja79pabewihgzkfe9pa97#14]. SEBI raised this from ₹10 lakh in the 2019 amendment [clf-agzja79pabewihgzkfe9pa97#22].
Sponsor holding lock-in remains 15% for three years [clf-mn0k9pxd2vrwxa7sjqf7lq3p#88].

Incorrect:
The minimum unit size is ₹1 crore.
The minimum unit size is ₹1 crore. [1.1](cite:clf-chatcmpl-tool-9a01ab9ff7b89df8#1)
The minimum unit size is ₹1 crore [clf-agzja79pabewihgzkfe9pa97#14-#22].

The inline citation tokens are the only citation mechanism for Claw v3. Never use the legacy add-citations flow.`;

const SPACES_MENTION_GUIDE = `

## Mentioning people
To notify or tag someone in this conversation, write their name with an @ in front, as plain text — e.g. \`@Amrit Raj\`. Use their real display name as it appears in the conversation. Do NOT add IDs, brackets, or look anything up — the system turns \`@Name\` into a real, clickable mention automatically. If you just want to refer to someone without notifying them, write their name with no @.

CRITICAL — mention the RIGHT person, never a guessed one:
- Do NOT append a raw user ID or random token to a name (e.g. \`@Tushar n9mvl...\`) — appending an ID you don't actually know produces a broken, wrong-person tag.
- Tag a thread participant by their display name: \`@Display Name\` (as it appears in the conversation). To tag someone who is NOT in this thread (e.g. to notify them for FYI, or to ask them to raise/own a ticket), use their FULL EMAIL: \`@john.doe@gmail.com\` — an email resolves to exactly one person, so it is safe even for a non-participant and the system turns it into a real, notifying mention. "They are not a participant" is NOT a reason to refuse if you know their email.
- Only refer to someone by plain name with NO @ when you have NEITHER a participant display name NOR a known email — i.e. you genuinely cannot identify the exact person. Never invent or guess an email; if you're unsure of the exact address, ask the user for it rather than guessing.`;

/**
 * Best-effort decode of the claw-auth session token payload (`payloadB64.sig`).
 * We do NOT hold the signing key, so this is a consistency check only — the
 * cryptographic verification happens on claw-auth for every call that presents
 * the token (MCP, OAuth token retrieval). Rejecting uid/sid mismatches here
 * gives callers a fast 400 instead of a half-run that fails on the first
 * authenticated outbound call.
 */
function decodeSessionTokenPayload(
  raw: string,
): { sid?: string; uid?: string; aslug?: string } | null {
  const dot = raw.indexOf(".");
  if (dot <= 0) return null;
  const payloadB64 = raw.slice(0, dot).replace(/-/g, "+").replace(/_/g, "/");
  try {
    const parsed = JSON.parse(
      Buffer.from(payloadB64, "base64").toString("utf8"),
    ) as Record<string, unknown>;
    return {
      ...(typeof parsed["sid"] === "string" ? { sid: parsed["sid"] } : {}),
      ...(typeof parsed["uid"] === "string" ? { uid: parsed["uid"] } : {}),
      ...(typeof parsed["aslug"] === "string"
        ? { aslug: parsed["aslug"] }
        : {}),
    };
  } catch {
    return null;
  }
}

function toWorkspaceContextPath(input: string): string {
  const rawSegments = input.split(/[/\\]+/);
  const cleaned = rawSegments
    .filter((seg) => seg && seg !== "." && seg !== "..")
    .map((seg) => seg.replace(/[^a-zA-Z0-9._-]/g, "_"))
    .filter(Boolean);
  if (cleaned.length === 0) return ".context/attached-context.md";
  if (cleaned[0] !== ".context") cleaned.unshift(".context");
  return cleaned.join("/");
}

router.post("/run", validateS2SKey, async (req, res: Response) => {
  const {
    userId,
    userName,
    userEmail,
    task,
    context,
    conversationId,
    piSessionConversationId,
    spacesConversationId,
    callbackUrl,
    systemPrompt,
    agentConfig,
    agentSlug,
    channelId,
    cwd: requestCwd,
    eventType,
    traceId,
    skills,
    provider,
    providerOrder,
    subagentProviders,
    providerConfigs,
    progressUrl,
    attachments,
    contextFiles,
    additionalInstructions,
    researchContext,
    customSubagents,
    sessionId: providedSessionId,
    sessionToken,
    ticketIds,
    canvasIds,
    callIds,
    idempotencyKey,
    compactBeforeRun,
    isRegenerate,
  } = req.body as {
    userId?: string;
    userName?: string;
    userEmail?: string;
    task?: string;
    context?: string;
    conversationId?: string;
    /** When set, this OVERRIDES conversationId for the persistent-session
     *  lookup (the PI session JSONL filename). Used by chat branching: the
     *  conversation row stays the same so the UI keeps one thread, but the
     *  underlying PI session lives at a branched id like
     *  `${conversationId}__branch__${assistantMessageId}` so context from the
     *  selected branch doesn't leak across siblings. */
    piSessionConversationId?: string;
    // Optional upstream-provided Spaces thread/conversation ID. Surfaced to
    // the agent's system metadata so it can construct thread-link citations
    // even when the agent session's own conversationId is a synthetic one
    // (e.g. scheduled job IDs). Caller-side wiring: webhook.ts / agent-chat.ts
    // forward this field when they have a Spaces conversation context.
    spacesConversationId?: string;
    callbackUrl?: string;
    systemPrompt?: string;
    agentConfig?: Record<string, unknown>;
    agentSlug?: string;
    channelId?: string;
    cwd?: string;
    eventType?: string;
    traceId?: string;
    skills?: {
      slug?: string;
      name: string;
      description?: string;
      content: string;
    }[];
    provider?: string;
    // Ordered fallback chain set by the agent owner via the Provider tab.
    // First entry is the primary parent; subsequent entries are walked on
    // quota exhaustion before dropping to "spaces" (LiteLLM/Kimi).
    providerOrder?: string[];
    subagentProviders?: Record<string, string>;
    providerConfigs?: Record<
      string,
      {
        apiKey: string;
        model: string;
        baseUrl?: string;
        authType?: string;
        reasoningEffort?: string;
      }
    >;
    progressUrl?: string;
    attachments?: Array<{ fileName: string; mimeType: string; data: string }>;
    contextFiles?: Array<{ path: string; content: string }>;
    additionalInstructions?: string;
    researchContext?: {
      type: string;
      id?: string;
      name: string;
      repositoryId?: string;
      productId?: string;
    };
    customSubagents?: import("../subagent-tools.js").CustomSubagentSpec[];
    // claw-auth-issued per-run identifiers. sessionId is the URL-bound run id;
    // sessionToken is an HMAC bearer used on every outbound /sessions/:sessionId/mcp/*
    // call back to claw-auth. Both REQUIRED in production — required check below.
    sessionId?: string;
    sessionToken?: string;
    ticketIds?: string[];
    canvasIds?: string[];
    callIds?: string[];
    // Stable per-unit-of-work key for run idempotency. Set by the recovery
    // worker to the rootSessionId so a re-dispatch of an already-completed run
    // is detected (via the GCS result marker) and NOT re-executed. Absent on
    // first dispatch (the marker is then keyed by sessionId).
    idempotencyKey?: string;
    // `/compact`: force a one-shot compaction of the resumed session before the
    // first turn runs (only fires when resuming an existing session). Plumbed
    // into the initial runAttempt below.
    compactBeforeRun?: boolean;
    /** Branching: when true, runTask branches the PI session at the last user
     *  entry so the new assistant turn becomes a sibling of the previous one. */
    isRegenerate?: boolean;
  };

  // [AUTODBG] claw-side receipt of every /run forward (esp. automations). Confirms
  // the request crossed claw-auth → claw and which session id it arrived under
  // (claw-auth mints a fresh UUID, so this won't be the `<exec>:step_0` id).
  clog.info(`[run] AUTODBG /run received: eventType=${eventType} sessionId=${providedSessionId} agent=${agentSlug} hasCallbackUrl=${!!callbackUrl} hasProviderConfigs=${!!providerConfigs} conv=${conversationId ?? ""}`);

  if (!userId || typeof userId !== "string" || userId.trim().length === 0) {
    res.status(400).json({ success: false, error: "userId is required" });
    return;
  }

  if (!task || typeof task !== "string" || task.trim().length === 0) {
    res
      .status(400)
      .json({
        success: false,
        error: "task is required and must be a non-empty string",
      });
    return;
  }

  if (
    !providedSessionId ||
    typeof providedSessionId !== "string" ||
    providedSessionId.trim().length === 0
  ) {
    res
      .status(400)
      .json({
        success: false,
        error: "sessionId is required (must be minted by claw-auth)",
      });
    return;
  }
  if (
    !sessionToken ||
    typeof sessionToken !== "string" ||
    sessionToken.trim().length === 0
  ) {
    res
      .status(400)
      .json({
        success: false,
        error: "sessionToken is required (must be minted by claw-auth)",
      });
    return;
  }

  const sessionId = providedSessionId.trim();

  // These three flow into path.join(...) for workspaces/sessions (and rm -rf
  // on cleanup) plus the result-callback URL path — reject anything that
  // isn't a plain opaque id before any of that machinery sees it.
  if (!isSafeId(sessionId)) {
    res
      .status(400)
      .json({ success: false, error: "sessionId has invalid format" });
    return;
  }
  if (
    conversationId !== undefined &&
    (typeof conversationId !== "string" || !isSafeId(conversationId))
  ) {
    res
      .status(400)
      .json({ success: false, error: "conversationId has invalid format" });
    return;
  }
  if (
    agentSlug !== undefined &&
    (typeof agentSlug !== "string" || !isSafeId(agentSlug))
  ) {
    res
      .status(400)
      .json({ success: false, error: "agentSlug has invalid format" });
    return;
  }
  // idempotencyKey becomes a GCS object name (claw-results/<key>.json) — same
  // charset guard as the other ids.
  if (
    idempotencyKey !== undefined &&
    (typeof idempotencyKey !== "string" || !isSafeId(idempotencyKey))
  ) {
    res
      .status(400)
      .json({ success: false, error: "idempotencyKey has invalid format" });
    return;
  }
  // cwd becomes the agent working dir and the attachment write root — never
  // accept a path outside the workspaces root / configured allowlist
  // (XYNE_CLAW_ALLOWED_CWD_ROOTS). See isAllowedCwd in workspace.ts.
  if (
    requestCwd !== undefined &&
    (typeof requestCwd !== "string" || !isAllowedCwd(requestCwd))
  ) {
    res
      .status(400)
      .json({ success: false, error: "cwd is not under an allowed root" });
    return;
  }
  // The sessionToken claw-auth minted binds {sid, uid}. Reject runs where the
  // body's userId/sessionId disagree with the token — a leaked S2S key can't
  // mint a token for a victim, so this (with claw-auth's signature check on
  // every outbound call) stops body-userId impersonation at the front door.
  const tokenPayload = decodeSessionTokenPayload(sessionToken.trim());
  if (
    !tokenPayload ||
    tokenPayload.uid !== userId.trim() ||
    tokenPayload.sid !== sessionId
  ) {
    res
      .status(400)
      .json({
        success: false,
        error: "sessionToken does not match userId/sessionId",
      });
    return;
  }

  // Transport selector: SSE if the caller asked for it, else legacy JSON+POSTs.
  // Logged unconditionally so prod incidents like "claw-auth thinks it's SSE but
  // claw answered in JSON" are diagnosable from a single line per request.
  const accept = (req.headers["accept"] as string | undefined) ?? "";
  const sseRequested = accept.includes("text/event-stream");
  clog.info(`[run] transport: ${sseRequested ? "sse" : "legacy"} (accept=${JSON.stringify(accept)}, sessionId=${sessionId})`);

  const abortController = new AbortController();
  activeRuns.set(sessionId, { abortController, userId: userId.trim() });

  // SSE mode: caller (e.g. claw-auth's run-stream proxy) opted in by sending
  // Accept: text/event-stream. We hold the response open, write every progress
  // event as an SSE frame to a single TCP connection — order is preserved by
  // construction — and write `event: done` with the final result before
  // closing. callbackUrl / progressUrl from the body are ignored in this mode
  // since the response stream IS the channel.
  if (sseRequested) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    const emitter = makeSseProgressEmitter(res, sessionId);
    emitter.writeStarted();

    // Periodic keepalive comment so middleboxes/HTTP-keep-alives don't idle
    // the connection during long stretches of no agent output (e.g. a slow
    // tool execution). Comments are ignored by the spec-compliant parser.
    const keepaliveTimer = setInterval(() => {
      try { res.write(KEEPALIVE_FRAME); } catch { /* response already closed */ }
    }, 25_000);

    // If the consumer disconnects mid-run, abort the agent loop. processTask's
    // catch handler observes the abort and the finally below tears down.
    //
    // Use res.on("close"), NOT req.on("close"): IncomingMessage emits 'close'
    // as soon as the request body is fully consumed by Express's body parser,
    // which happens before the route handler even starts running anything
    // meaningful. That would abort the agent before it produced a single
    // token. res.on("close") fires only when the response socket actually
    // closes — when the client (the proxy in our case) hangs up — so it
    // distinguishes "we finished and called res.end()" (writableEnded=true)
    // from "client went away" (writableEnded=false).
    res.on("close", () => {
      if (!res.writableEnded && !abortController.signal.aborted) {
        clog.info(`[run/sse] client disconnected before done — aborting agent (sessionId=${sessionId})`);
        // Distinct cancel frame BEFORE the abort takes hold. The consumer
        // sees this as soon as the bytes flush — gives the frontend's typing
        // indicator a way to stop immediately, without waiting for the
        // cancelled `done` (which is delayed until partial state is gathered
        // and the /callback replay completes).
        emitter.writeCancelled(sessionId, "client disconnected");
        abortController.abort();
      }
    });

    // Also catch the explicit Stop-button path: claw-auth's /cancel hits
    // /run/:sessionId/cancel which calls activeRuns.get(sid).abortController
    // .abort(). That fires the signal directly — without this listener we'd
    // only emit `cancelled` on a raw socket disconnect, not on the well-
    // behaved /cancel POST. Idempotent: writeCancelled() short-circuits on
    // its own guard.
    const onAbortSignal = () => {
      if (!res.writableEnded) {
        emitter.writeCancelled(sessionId, "cancel requested");
      }
    };
    abortController.signal.addEventListener("abort", onAbortSignal, { once: true });

    let processTaskError: unknown = undefined;
    try {
      await processTask(
        sessionId,
        sessionToken.trim(),
        userId.trim(),
        task.trim(),
        context,
        userName,
        userEmail,
        conversationId,
        piSessionConversationId,
        spacesConversationId,
        emitter,
        systemPrompt,
        agentConfig,
        agentSlug,
        channelId,
        requestCwd,
        eventType,
        traceId,
        skills,
        provider,
        providerOrder,
        subagentProviders,
        providerConfigs,
        emitter,
        attachments,
        contextFiles,
        additionalInstructions,
        researchContext,
        customSubagents,
        ticketIds,
        canvasIds,
        callIds,
        idempotencyKey,
        isRegenerate,
        abortController.signal,
        () => abortController.abort(),
        compactBeforeRun,
      );
    } catch (err) {
      processTaskError = err;
    } finally {
      clearInterval(keepaliveTimer);
      activeRuns.delete(sessionId);
      // Backstop: processTask has several silent-return paths (most notably
      // SessionLockedError — another pod owns this run and suppresses the
      // callback) and any future throw outside its try/catch around
      // sendCallback. In legacy HTTP mode that's fine because the owning pod
      // will POST the result. In SSE mode the consumer is waiting on a `done`
      // frame on THIS connection — without it, the stream hangs and the
      // consumer raises "ended without a done frame". So if the emitter
      // hasn't written done by the time we get here, write one now.
      if (!emitter.wroteDone()) {
        const reason = processTaskError instanceof Error
          ? processTaskError.message
          : processTaskError !== undefined
            ? String(processTaskError)
            : "Run ended without emitting a result (likely session-locked or silent early-return — check claw logs for this sessionId)";
        const status: "completed" | "failed" | "cancelled" = processTaskError ? "failed" : "completed";
        emitter.forceDone(sessionId, status, reason);
      }
      if (!res.writableEnded) {
        try { res.end(); } catch { /* ignore */ }
      }
    }
    return;
  }

  // Legacy JSON mode: return sessionId immediately, run agent in background,
  // POST chunks to progressUrl and the final result to callbackUrl. This is
  // the path every non-migrated caller still uses (webhook flows, agent-chat,
  // scheduled jobs, etc.). It must stay byte-identical until they migrate.
  res.json({ success: true, sessionId });

  // Process in background
  processTask(
    sessionId,
    sessionToken.trim(),
    userId.trim(),
    task.trim(),
    context,
    userName,
    userEmail,
    conversationId,
    piSessionConversationId,
    spacesConversationId,
    callbackUrl,
    systemPrompt,
    agentConfig,
    agentSlug,
    channelId,
    requestCwd,
    eventType,
    traceId,
    skills,
    provider,
    providerOrder,
    subagentProviders,
    providerConfigs,
    progressUrl,
    attachments,
    contextFiles,
    additionalInstructions,
    researchContext,
    customSubagents,
    ticketIds,
    canvasIds,
    callIds,
    idempotencyKey,
    isRegenerate,
    abortController.signal,
    () => abortController.abort(),
    compactBeforeRun,
  ).finally(() => {
    activeRuns.delete(sessionId);
  });
});

// ── SSE producer: in-process emitter that writes ClawStreamEvent frames into
// a live HTTP response. Replaces N HTTP POSTs per chunk with N writes into
// one TCP connection. seq is monotonic per session so the consumer can
// detect drops (today we don't replay; that's the next hardening layer).
interface SseProgressEmitter extends ProgressEmitter {
  writeStarted: () => void;
  /** Distinct cancel signal — emitted as soon as the route handler observes
   *  an aborted run, BEFORE forceDone / the cancelled done payload. Gives the
   *  consumer an early "stop the typing indicator" hook without waiting on the
   *  partial-state collection that gates `done`. Idempotent. */
  writeCancelled: (sessionId: string, reason?: string) => void;
  /** True once done() has been called. The route handler reads this in its
   *  finally so it can write a fallback done frame if processTask returned
   *  through one of the silent paths (SessionLockedError, etc.) — without
   *  this the consumer's parser hangs waiting on a done that never arrives. */
  wroteDone: () => boolean;
  /** Write a synthetic done frame on behalf of the route handler. Used as a
   *  backstop in finally so an emitter that never got done() called still
   *  emits ONE final frame before res.end() — keeps the wire contract intact. */
  forceDone: (sessionId: string, status: "completed" | "failed" | "cancelled", reason: string) => void;
}

function makeSseProgressEmitter(res: Response, sessionId: string): SseProgressEmitter {
  let seq = 0;
  const next = () => seq++;
  let closed = false;
  let doneWritten = false;
  let cancelEmitted = false;
  const write = (event: ClawStreamEvent): void => {
    if (closed) return;
    try {
      res.write(frameSseEvent(event));
    } catch (err) {
      closed = true;
      clog.warn(`[run/sse] write failed (session=${sessionId}): ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  return {
    writeStarted: () => write({ event: "started", seq: next(), sessionId }),
    writeCancelled: (sid, reason) => {
      if (cancelEmitted) return;
      cancelEmitted = true;
      write({ event: "cancelled", seq: next(), sessionId: sid, ...(reason ? { reason } : {}) });
    },
    wroteDone: () => doneWritten,
    forceDone: (sid, status, reason) => {
      if (doneWritten) return;
      write({ event: "done", seq: next(), sessionId: sid, result: { status, error: reason } });
      doneWritten = true;
      closed = true;
    },
    invocation: (sid, invocation) => write({ event: "invocation", seq: next(), sessionId: sid, toolInvocation: invocation }),
    attachment: (sid, attachment: ClawAttachmentPayload) => write({ event: "attachment", seq: next(), sessionId: sid, attachment }),
    sandboxPreview: (sid, payload: ClawSandboxPreviewPayload) => write({ event: "sandbox-preview", seq: next(), sessionId: sid, payload }),
    streamChunk: (sid, payload) => {
      if (payload.reasoningDelta !== undefined) {
        write({ event: "reasoning", seq: next(), sessionId: sid, reasoningDelta: payload.reasoningDelta });
      }
      if (payload.textDelta !== undefined) {
        write({ event: "delta", seq: next(), sessionId: sid, textDelta: payload.textDelta });
      }
    },
    debugProgress: (sid, event) => write({ event: "debug", seq: next(), sessionId: sid, debugEvent: event }),
    progressLabel: (sid, toolLabel, meta?: ClawStreamMeta) => write({
      event: "progress-label",
      seq: next(),
      sessionId: sid,
      payload: { toolLabel, ...(meta ?? {}) },
    }),
    done: async (sid, payload) => {
      if (doneWritten) return;
      // Pass the entire sendCallback payload through verbatim. /webhook/result,
      // /agent-chat/callback, and other consumers depend on fields well beyond
      // the obvious subset (userId / conversationId / agentSlug / toolsUsed /
      // tokenUsage / provider / model / reasoning / latency / pendingResponses
      // / pendingGoalSuggestion). Filtering here was the proximate cause of
      // Spaces @mention summarize losing its final reply: /webhook/result
      // needs conversationId + agentSlug to resolve session context when the
      // sessionId-based lookup races against setSession() or run-recovery.
      const status = (payload["status"] as "completed" | "failed" | "cancelled" | undefined) ?? "completed";
      const result: ClawDoneStatus = { ...payload, status };
      write({ event: "done", seq: next(), sessionId: sid, result });
      doneWritten = true;
      closed = true;
    },
  };
}

// `/clear` — delete a thread's persisted agent session so the next message
// starts fresh (the agent forgets all prior context). Keyed the same way runs
// resume: `buildSandboxStoreKey(userId, conversationId, agentSlug)` →
// `<conversationId>_<agentSlug>`. S2S-only; claw-auth calls this when a user
// types `/clear`. Idempotent — deleting a non-existent session is a no-op.
router.post("/clear-session", validateS2SKey, async (req, res: Response) => {
  const { userId, conversationId, agentSlug } = (req.body ?? {}) as {
    userId?: string;
    conversationId?: string;
    agentSlug?: string;
  };
  if (!conversationId || typeof conversationId !== "string") {
    res.status(400).json({ success: false, error: "conversationId is required" });
    return;
  }
  const sessionKey = buildSandboxStoreKey(userId, conversationId, agentSlug) ?? conversationId;
  if (!isSafeId(sessionKey)) {
    res.status(400).json({ success: false, error: "resolved session key has invalid format" });
    return;
  }
  try {
    await deleteSession(sessionKey);
    clog.info(`[run] /clear-session: deleted session ${sessionKey}`);
    res.json({ success: true });
  } catch (err) {
    clog.error(`[run] /clear-session failed for ${sessionKey}: ${err instanceof Error ? err.message : String(err)}`);
    res.status(500).json({ success: false, error: "failed to clear session" });
  }
});

router.post("/run/:sessionId/cancel", validateS2SKey, (req, res: Response) => {
  const { sessionId } = req.params as { sessionId?: string };
  if (!sessionId) {
    res.status(400).json({ success: false, error: "sessionId is required" });
    return;
  }

  const active = activeRuns.get(sessionId);
  if (!active) {
    res.json({ success: true, sessionId, status: "not_running" });
    return;
  }

  // Object-level authz: a cancel must come from the run's owner. claw-auth
  // verifies ownership before forwarding and always sends x-user-id (the only
  // caller of this endpoint — agent-chat.ts cancel forwarder). Fail closed:
  // a leaked S2S key alone can't abort an arbitrary user's run without also
  // knowing the owner's id.
  const callerUserId = req.headers["x-user-id"];
  if (
    typeof callerUserId !== "string" ||
    !callerUserId ||
    callerUserId !== active.userId
  ) {
    res
      .status(403)
      .json({ success: false, error: "Not authorized to cancel this run" });
    return;
  }

  // Mark this as a USER-initiated cancel BEFORE aborting, so the run's catch
  // block can distinguish it from the agent's own respond-to-user abort and
  // emit status="cancelled" (not "completed") even if a response was already
  // generated — otherwise a just-finished answer overwrites the user's stop.
  active.userCancelled = true;
  active.abortController.abort();
  res.json({ success: true, sessionId, status: "cancelled" });
});

// POST /clone-session — branch a persistent session to a new conversationId
// using PI's native createBranchedSession. Used by claw-auth to set up a
// branched session BEFORE /run dispatches so the regenerate / edit-user turn
// runs on a sibling subtree rather than appending to the original history.
//
// Body: { sourceConversationId, targetConversationId, branchMode? }
//   branchMode = "lastUser"       → regenerate (default)
//   branchMode = "beforeLastUser" → edit-user
router.post("/clone-session", validateS2SKey, async (req, res: Response) => {
  const { sourceConversationId, targetConversationId } = req.body as {
    sourceConversationId?: string;
    targetConversationId?: string;
    branchMode?: "lastUser" | "beforeLastUser";
  };
  const branchMode = (req.body as { branchMode?: "lastUser" | "beforeLastUser" }).branchMode ?? "lastUser";

  if (!sourceConversationId || typeof sourceConversationId !== "string") {
    res.status(400).json({ success: false, error: "sourceConversationId is required" });
    return;
  }
  if (!targetConversationId || typeof targetConversationId !== "string") {
    res.status(400).json({ success: false, error: "targetConversationId is required" });
    return;
  }
  if (!isSafeId(sourceConversationId)) {
    res.status(400).json({ success: false, error: "sourceConversationId has invalid format" });
    return;
  }
  if (!isSafeId(targetConversationId)) {
    res.status(400).json({ success: false, error: "targetConversationId has invalid format" });
    return;
  }

  try {
    const success = await branchSession(sourceConversationId, targetConversationId, branchMode);
    res.json({ success });
  } catch (err) {
    clog.error(
      `[clone-session] ${sourceConversationId} → ${targetConversationId}: ${err instanceof Error ? err.stack ?? err.message : String(err)}`,
    );
    res.status(500).json({ success: false, error: "Failed to clone session" });
  }
});

async function processTask(
  sessionId: string,
  sessionToken: string,
  userId: string,
  task: string,
  context: string | undefined,
  userName: string | undefined,
  userEmail: string | undefined,
  conversationId: string | undefined,
  piSessionConversationId: string | undefined,
  spacesConversationId: string | undefined,
  callbackUrl: ProgressDest,
  systemPrompt: string | undefined,
  agentConfig: Record<string, unknown> | undefined,
  agentSlug: string | undefined,
  channelId: string | undefined,
  requestCwd: string | undefined,
  eventType: string | undefined,
  traceId: string | undefined,
  skills:
    | { slug?: string; name: string; description?: string; content: string }[]
    | undefined,
  provider: string | undefined,
  providerOrder: string[] | undefined,
  subagentProviders: Record<string, string> | undefined,
  providerConfigs:
    | Record<
        string,
        {
          apiKey: string;
          model: string;
          baseUrl?: string;
          authType?: string;
          reasoningEffort?: string;
        }
      >
    | undefined,
  progressUrl: ProgressDest,
  attachments:
    | Array<{ fileName: string; mimeType: string; data: string }>
    | undefined,
  contextFiles: Array<{ path: string; content: string }> | undefined,
  additionalInstructions: string | undefined,
  researchContext:
    | {
        type: string;
        id?: string;
        name: string;
        repositoryId?: string;
        productId?: string;
      }
    | undefined,
  customSubagents:
    | import("../subagent-tools.js").CustomSubagentSpec[]
    | undefined,
  ticketIds: string[] | undefined,
  canvasIds: string[] | undefined,
  callIds: string[] | undefined,
  idempotencyKey: string | undefined,
  isRegenerate: boolean | undefined,
  abortSignal?: AbortSignal,
  abortRun?: () => void,
  compactBeforeRun?: boolean,
): Promise<void> {
  let mcpCleanup: (() => Promise<void>) | undefined;
  const tid = traceId ?? sessionId.slice(0, 8);
  const log = (msg: string) => clog.info(`[run] [${tid}] ${msg}`);
  const logErr = (msg: string, err?: unknown) =>
    clog.error(`[run] [${tid}] ${msg}`, err ?? "");

  // Idempotency backstop: only re-dispatches carry idempotencyKey (the recovery
  // rootSessionId). If a terminal-result marker for it already exists in GCS,
  // this run already finished and its completion callback was lost — replay the
  // cached result instead of re-executing, so finished side-effecting work
  // (PRs, sandboxes) is never re-run. (The recovery worker also checks this
  // before dispatch; this covers any path that still reaches /run.)
  if (idempotencyKey) {
    try {
      const markerBuf = await gcsDownloadResultMarker(idempotencyKey);
      if (markerBuf) {
        const marker = JSON.parse(markerBuf.toString("utf8")) as {
          status?: string;
          result?: string;
          toolsUsed?: string[];
        };
        log(
          `Idempotency hit for ${idempotencyKey}: run already completed — replaying result, skipping execution`,
        );
        await sendCallback(callbackUrl, sessionToken, {
          sessionId,
          userId,
          conversationId: conversationId ?? null,
          agentSlug: agentSlug ?? null,
          status: marker.status === "failed" ? "failed" : "completed",
          ...(marker.result !== undefined ? { result: marker.result } : {}),
          ...(marker.toolsUsed ? { toolsUsed: marker.toolsUsed } : {}),
        });
        return;
      }
    } catch (err) {
      // Unreadable/parse error → fall through and run normally (safe default).
      logErr(`Idempotency check failed for ${idempotencyKey}, running normally:`, err);
    }
  }

  // Hoisted so the catch handler can recover pendingResponses when
  // respond-to-user fires the abort (graceful copilot termination).
  let customToolsResult: ReturnType<typeof loadCustomTools> | undefined;
  // Hoisted so the catch handler (copilot-mode respond-to-user terminations)
  // can still forward MCP-layer pendingActions to claw-auth. Without this,
  // a copilot-mode agent that calls a write tool like spaces-create-ticket
  // and then ends the turn via respond-to-user has its signed pendingAction
  // silently dropped — claw-auth never sees it, no Approve/Decline button
  // gets posted to the user, and the agent's text says "queued for approval"
  // with nothing to approve. Observed 2026-06-09 with agent "triage-room"
  // (slug used in prod) running model=claude-sonnet-4.6 via copilot.
  let mcpGetPendingActions: (() => Array<Record<string, unknown>>) | undefined;
  // Hoisted like mcpGetPendingActions so both the success path and the catch
  // handler can include files forwarded from MCP tools in the run's attachments.
  let mcpGetAttachments: (() => Attachment[]) | undefined;
  // Hoisted so the catch handler (copilot-mode respond-to-user terminations)
  // can still surface a goal suggestion the worker queued before the early
  // abort. Filled by buildSuggestGoalTool's callback when the agent calls
  // suggest-goal.
  let pendingGoalSuggestion: PendingGoalSuggestion | null = null;
  let callbackProvider = provider ?? "spaces";
  let callbackModel = LITELLM.model;

  try {
    // SSRF guard: progressUrl is caller-supplied and gets POSTed to on every
    // tool/attachment/stream event. Drop it unless it targets the trusted
    // claw-auth origin, so a leaked S2S key can't redirect progress traffic to
    // an attacker / cloud-metadata endpoint. Run still proceeds without it.
    // In-process emitters (SSE mode) bypass the URL check — the destination is
    // a Response object owned by this process, not a network address.
    if (typeof progressUrl === "string" && !isAllowedCallbackUrl(progressUrl)) {
      log(`Ignoring non-allowlisted progressUrl: ${progressUrl}`);
      progressUrl = undefined;
    }
    const progressUrlLabel = !progressUrl ? "none" : (typeof progressUrl === "string" ? progressUrl : "sse-emitter");
    log(
      `Session ${sessionId}: starting for user ${userId}, progressUrl=${progressUrlLabel}`,
    );

    // All per-type attachment ingestion (filter → decode → convert to a
    // `.context/` markdown sibling, plus the pdf/video/zip side effects) lives
    // in attachment-ingest.ts. derivedContextFiles ordering is significant —
    // see that module's header.
    const {
      derivedContextFiles,
      pdfBuffers: pdfBuffersByName,
      videoKeyframes,
      imageAttachments,
      textAttachments,
      xlsxAttachments,
      pdfAttachments,
    } = await ingestAttachments(attachments, log);

    const mergedContextFiles = [
      ...(contextFiles ?? []),
      ...derivedContextFiles,
    ];

    // Use provided cwd, repo workspace, or create an ephemeral workspace
    const workspaceDir = requestCwd ?? (await createWorkspace(sessionId));
    if (mergedContextFiles.length > 0) {
      const written = await writeWorkspaceTextFiles(
        workspaceDir,
        mergedContextFiles,
      );
      log(`Attached context files written: ${written.length}`);
    }
    // Drop the raw PDF bytes next to the extracted markdown — keeps
    // fill-pdf-form / inspect-pdf-form able to open the actual PDF off disk.
    // Path mirrors the markdown: `.context/<originalFileName>` (no extra suffix).
    if (pdfBuffersByName.length > 0) {
      const writtenBin = await writeWorkspaceBinaryFiles(
        workspaceDir,
        pdfBuffersByName.map((p) => ({ path: p.fileName, data: p.buf })),
      );
      log(`Raw PDF originals kept: ${writtenBin.length}`);
    }

    const toolPermissions =
      (agentConfig?.["toolPermissions"] as
        | Record<string, string>
        | undefined) ?? {};
    // Over-large MCP results spill to the persistent session dir (survives the
    // ephemeral workspace teardown + resume) when a conversation is in play;
    // the workspace is still used for binary attachments. See toolOutputBaseDir.
    const mcpOutputDir = toolOutputBaseDir(conversationId, workspaceDir);
    const {
      groups: mcpGroups,
      cleanup,
      getPendingActions,
      getAttachments: getMcpAttachments,
    } = await loadMcpToolsForUser(
      sessionId,
      sessionToken,
      workspaceDir,
      toolPermissions,
      agentSlug,
      mcpOutputDir,
      (att) => pushAttachment(progressUrl, sessionId, att),
    );
    mcpGetAttachments = getMcpAttachments;
    // Expose the MCP-layer pendingActions getter to the catch handler so
    // copilot-mode respond-to-user terminations can still recover signed
    // write-tool actions. See the hoisted `mcpGetPendingActions` declaration
    // near the top of this function for the full bug context.
    mcpGetPendingActions = getPendingActions;
    mcpCleanup = cleanup;

    const meta: Record<string, string> = { userId };
    if (userName) meta["userName"] = userName;
    if (userEmail) meta["userEmail"] = userEmail;
    if (agentSlug) meta["agentSlug"] = agentSlug;
    if (channelId) meta["channelId"] = channelId;
    if (conversationId) meta["conversationId"] = conversationId;
    // Surface the run's trigger type so the sandbox tools can route scheduled /
    // automation runs to the shared read-only sbx-git sandbox instead of cloning
    // a per-project golden snapshot (see sandboxRepoSetup → resolveSbxGit).
    if (eventType) meta["eventType"] = eventType;
    // Sandbox repo pin (agent.config.sandboxRepo). Propagating it into meta is what
    // lets pinnedTemplateForContext (tools.ts) route bare `sandbox-create` and
    // one-shot `sandbox-run` onto the pinned repo's template — not just
    // `sandbox-repo-setup`. Without this the pin was invisible to those tools, so a
    // pinned agent's bare create silently fell back to the Kata default template.
    if (agentConfig?.["sandboxRepo"]) meta["sandboxRepo"] = String(agentConfig["sandboxRepo"]);
    // Per-agent opt-in (e.g. reviewer agents): ALWAYS use the shared read-only
    // sbx-git sandbox, even for interactive runs. The sandbox tool ORs this with
    // isReadOnlyJob (see sandboxRepoSetup → resolveSbxGit). Reviewers only
    // grep/read across all repos, so they never need a per-project clone.
    if (agentConfig?.["forceReadOnlySandbox"] === true) meta["forceReadOnlySandbox"] = "true";
    // Operator-selected sbx-git repo context (agent.config.sbxGitRepos: string[]).
    // Surfaced to the read-only sandbox message so the agent focuses on these repos.
    const sbxGitRepos = agentConfig?.["sbxGitRepos"];
    if (Array.isArray(sbxGitRepos) && sbxGitRepos.length > 0) {
      meta["sbxGitRepos"] = JSON.stringify(sbxGitRepos.filter((r) => typeof r === "string"));
    }
    const spacesConversationId = agentConfig?.["SPACES_CONVERSATION_ID"];
    if (spacesConversationId && typeof spacesConversationId === "string")
      meta["spacesConversationId"] = spacesConversationId;

    // For google-agent: fetch the user's Google OAuth token from xyne-claw-auth
    const effectiveConfig = { ...(agentConfig ?? {}) };
    // Parent agent's provider config — looked up from user's provider credentials.
    // We also reuse it to drive custom:create-ppt so PPT generation uses the
    // same user credential/model instead of shared env keys.
    const parentProviderConfig =
      provider === "copilot" || provider === "claude" || provider === "codex"
        ? providerConfigs?.[provider]
        : undefined;

    // Resolve the run's provider ONCE (copilot proxy + base-URL defaulting) so
    // tools that make their own LLM call (create-ppt's slide-JSON generation)
    // inherit the agent's configured model via context.providerConfig instead
    // of a hardcoded fallback. Passed to loadCustomTools below.
    let runtimeProviderConfig:
      | { provider: string; baseUrl?: string; apiKey: string; model: string; authType?: string }
      | undefined;
    if (provider && parentProviderConfig?.apiKey) {
      const resolved =
        provider === "copilot"
          ? await applyCopilotProxyIfNeeded(provider, parentProviderConfig)
          : parentProviderConfig;
      runtimeProviderConfig = {
        provider,
        baseUrl:
          resolved?.baseUrl ??
          (provider === "claude" ? "https://api.anthropic.com" : "https://api.openai.com/v1"),
        apiKey: resolved?.apiKey ?? parentProviderConfig.apiKey,
        model: resolved?.model ?? parentProviderConfig.model,
        ...(provider === "claude"
          ? { authType: resolved?.authType ?? parentProviderConfig.authType ?? "api_key" }
          : {}),
      };
      log(`Tool provider resolved: provider=${provider} model=${runtimeProviderConfig.model}`);
    }

    // NOTE: Google + Microsoft no longer fetch/inject an OAuth token here. They
    // run as claw-auth-hosted stdio MCP connectors (type "google"/"microsoft"),
    // so their access token is resolved + refreshed by claw-auth's credential
    // loader when the MCP server is spawned — same lazy path as every other
    // connector. The old wantsGoogle/wantsMicrosoft pre-fetch was removed.

    // Custom tools still use the URL-based progress channel internally for
    // their own inline progress posts. In SSE mode that channel is bypassed —
    // we pass undefined so they no-op, and attachment events still surface via
    // the onAttachment callback above, which dispatches through pushAttachment
    // (URL or emitter, whichever is plumbed).
    const progressUrlForCustom = typeof progressUrl === "string" ? progressUrl : undefined;
    customToolsResult = loadCustomTools(
      effectiveConfig,
      meta,
      (att) => pushAttachment(progressUrl, sessionId, att),
      researchContext,
      progressUrlForCustom,
      sessionId,
      SERVER.s2sKey,
      sessionToken,
      undefined,
      runtimeProviderConfig,
    );
    const {
      tools: customToolDefs,
      getAttachments,
      getPendingQuestions,
      getPendingActions: getCustomPendingActions,
      getPendingResponses,
    } = customToolsResult;

    // Load deepwiki/context7/playwright MCP tool groups (stdio transport, cached).
    // Playwright doesn't get its own subagent — its tools are spliced into the
    // sandbox subagent's palette via bonusToolsBySubagent below.
    const [deepwikiGroup, context7Group, playwrightGroup] = await Promise.all([
      loadDeepwikiTools(),
      loadContext7Tools(),
      loadPlaywrightTools(),
    ]);

    // Extract skill triggers from agent config (needed by both subagent tools and runTask)
    const rawTriggers =
      (agentConfig?.["skillTriggers"] as Array<{
        toolName: string;
        skillSlug: string;
        when: string;
        prompt?: string;
      }>) ?? [];
    const resolvedTriggers = rawTriggers
      .filter((t) => t.toolName && t.skillSlug)
      .map((t) => {
        const skill = skills?.find((s) => s.name === t.skillSlug);
        return skill
          ? {
              toolName: t.toolName,
              skillSlug: t.skillSlug,
              skillContent: skill.content,
              when: t.when as "before" | "after",
              prompt: t.prompt,
            }
          : null;
      })
      .filter((t): t is NonNullable<typeof t> => t !== null);

    // Extract prompt injections (per-turn system reminders)
    const rawInjections =
      (agentConfig?.["promptInjections"] as Array<{
        id: string;
        label: string;
        content: string;
        enabled: boolean;
      }>) ?? [];
    const activeInjections = rawInjections
      .filter(
        (p) =>
          p.enabled &&
          typeof p.content === "string" &&
          p.content.trim().length > 0,
      )
      .map((p) => ({
        id: p.id,
        label: p.label || "Reminder",
        content: p.content,
      }));

    // Memory — opt-in per agent via agentConfig.memoryEnabled=true.
    // No more inject-all-recalled-facts. Instead: inject a tiny taxonomy hint
    // and let the agent search on demand via the memory-search tool.
    //
    // The Digital Twin (slug=digital-twin) is per-user: scope the taxonomy
    // to memories tagged `user:<userId>` so the injected hint doesn't leak
    // other users' subsystem counts. Other memory-enabled agents see the
    // full shared taxonomy.
    const memoryEnabled =
      agentConfig?.["memoryEnabled"] === true ||
      agentConfig?.["memoryEnabled"] === "true";
    if (agentSlug && memoryEnabled) {
      // Bank-id comparison, not raw slug — see isDigitalTwinAgent in memory.ts.
      const isDigitalTwin = isDigitalTwinAgent(agentSlug);
      const taxonomy = await listSubsystemTaxonomy(
        agentSlug,
        isDigitalTwin ? { userTag: `user:${userId}` } : undefined,
      ).catch(() => []);
      if (taxonomy.length > 0) {
        const lines = taxonomy
          .slice(0, 12)
          .map(
            (s) =>
              `- ${s.name} (${s.memoryCount} ${s.memoryCount === 1 ? "memory" : "memories"})`,
          )
          .join("\n");
        activeInjections.push({
          id: "__memory-taxonomy",
          label: isDigitalTwin
            ? "Your Personal Memory"
            : "Shared Knowledge Bank",
          content: isDigitalTwin
            ? [
                "You have a personal memory bank — facts about THIS user that they",
                "themselves approved. Currently you have memories under these clusters:",
                "",
                lines,
                "",
                "When you need to know how the user works, who they collaborate with,",
                "what they prefer, or what they own, call `memory-search` FIRST with a",
                "specific natural-language query. Never invent facts about the user —",
                "only use what the tool returns.",
              ].join("\n")
            : [
                "You have access to a shared knowledge bank for this agent. It contains",
                "facts learned across past sessions, grouped by subsystem:",
                "",
                lines,
                "",
                "When a user question overlaps any subsystem, call the `memory-search`",
                "tool FIRST with a specific natural-language query. Do not invent facts",
                "from memory — only use what the tool returns.",
              ].join("\n"),
        });
      }
    }

    // Resolve subagent-level skills: NONE by default — users opt skills in
    // per-subagent via agent.config.subagentSkills. Rationale: a parent
    // agent's skills are often tuned for the parent's context (e.g. release
    // notes templates) and become noise/cost when injected into every child
    // (spaces, bitbucket, deepwiki, ...) without the user asking for it.
    //
    // Resolution:
    //   subagentSkills.spaces = ["skill-a"]   → only skill-a goes to spaces
    //   subagentSkills.spaces = []            → no skills (same as absent)
    //   subagentSkills.spaces is not set      → no skills (DEFAULT)
    //
    // Previous behavior was "inherit ALL parent skills by default" — flipped
    // here. Agents that depended on the old default need to explicitly list
    // the skills they want propagated per subagent.
    const allSkills = skills ?? [];
    const rawSubagentSkills = agentConfig?.["subagentSkills"] as
      | Record<string, string[]>
      | undefined;

    let resolvedSubagentSkills:
      | Record<
          string,
          Array<{
            slug?: string;
            name: string;
            description?: string;
            content: string;
          }>
        >
      | undefined;
    if (rawSubagentSkills) {
      resolvedSubagentSkills = {};
      for (const [subagentName, skillNames] of Object.entries(
        rawSubagentSkills,
      )) {
        const resolved = skillNames
          .map((name) => allSkills.find((s) => s.name === name))
          .filter((s): s is NonNullable<typeof s> => s != null);
        if (resolved.length > 0) {
          resolvedSubagentSkills[subagentName] = resolved;
        }
        // empty array → omit; the subagent gets no skills
      }
      if (Object.keys(resolvedSubagentSkills).length === 0) {
        resolvedSubagentSkills = undefined;
      }
    }

    // Pull the virtual `knowledge-base` group out of mcpGroups BEFORE the
    // subagent-builder sees it. KB tools are mounted directly on the parent
    // agent (Option B / parent-hoist) — the user already gated access via
    // their KB picker; we don't want the spaces subagent to absorb these,
    // nor do we want them filtered by tools.subagents / tools.direct /
    // tools.custom (KB has its own per-agent allowlist on the claw-auth side).
    // If left in allGroups, buildSubagentTools's else-branch would route them
    // into `directTools`, which would then be filtered out by the run.ts
    // tools.direct gate further down.
    const kbGroup = mcpGroups.find((g) => g.serverType === "knowledge-base");
    const mcpGroupsWithoutKb = kbGroup ? mcpGroups.filter((g) => g !== kbGroup) : mcpGroups;
    const kbHoistedTools = kbGroup ? kbGroup.tools : [];

    // Combine all MCP groups and build subagent wrappers (also wraps matching custom tools like pgm)
    const allGroups = [
      ...mcpGroupsWithoutKb,
      ...(deepwikiGroup ? [deepwikiGroup] : []),
      ...(context7Group ? [context7Group] : []),
    ];
    // Parent agent's provider — used as default for subagents that don't have an override
    const parentProvider =
      provider && (["copilot", "claude", "codex"] as readonly string[]).includes(provider)
        ? provider
        : "spaces";
    // Shared ref: subagents append their inner MCP tool names here so chain
    // `toolsMustInclude`/`toolsMustExclude` conditions can target specific
    // nested tools (e.g. Bitbucket__create_pull_request), not just the
    // subagent wrapper names returned by the parent agent.
    const subagentInnerTools: string[] = [];
    // NOTE: the "sandbox" subagent was removed (2026-06-14). Sandbox tools now
    // mount directly on the parent (see parentHoistedTools below); playwright
    // browser tools are hoisted alongside them for sandbox-capable agents. The
    // old bonusToolsBySubagent splices (playwright + bitbucket upload) targeted
    // the sandbox subagent's palette and are gone with it.

    // Parse agent-level tool config up-front. Used both for the post-build
    // filter (further down) AND for the directPickSuffixes hoist below — when
    // a user ticks a single tool (e.g. bitbucket.get_pull_request) in the
    // agent UI without picking the whole bitbucket subagent, the runtime
    // should still expose that one tool to the parent. Without this, picking
    // individual tools from a subagent-backed connector was a silent no-op.
    const toolsConfigEarly = parseToolsConfig(effectiveConfig);
    const directPickSuffixes = toolsConfigEarly?.direct ?? [];

    const { subagentTools, directTools, remainingCustomTools } =
      buildSubagentTools(
        allGroups,
        customToolDefs,
        resolvedTriggers.length > 0 ? resolvedTriggers : undefined,
        resolvedSubagentSkills,
        { parentProvider, subagentProviders, providerConfigs },
        {
          ...(progressUrl ? { progressUrl } : {}),
          parentSessionId: sessionId,
          ...(conversationId
            ? {
                parentDebugSessionId:
                  buildSandboxStoreKey(userId, conversationId, agentSlug) ??
                  conversationId,
              }
            : {}),
          parentToolsUsed: subagentInnerTools,
          parentMeta: {
            ...(conversationId ? { conversationId } : {}),
            ...(agentSlug ? { agentSlug } : {}),
            ...(userId ? { userId } : {}),
          },
          // Propagate the cancel signal so any in-flight subagent session
          // (sandbox, spaces, bitbucket, ...) disposes itself when the user
          // hits Stop, instead of running for its full duration and orphaning
          // the result back to a parent that's already thrown RunCancelledError.
          ...(abortSignal ? { abortSignal } : {}),
        },
        undefined, // bonusToolsBySubagent — removed with the sandbox subagent
        customSubagents,
        directPickSuffixes,
      );

    // Parent-direct mount for ALL sandbox tools (source = "custom:sandbox",
    // covers compute/file tools in xyne-claw-shared/src/tools/sandbox/ and
    // browser tools in xyne-claw-shared/src/tools/sandbox-pw/). The sandbox
    // subagent was removed (2026-06-14) — sandbox is now a flat set of
    // parent tools, gated per-agent by the agent.config.tools filter below
    // (the slug must be in tools.custom). `sandbox-destroy` is excluded: it
    // reaps live sessions and caused pod-churn when exposed to an LLM.
    const parentHoistedTools = customToolDefs.filter((t) => {
      const src = (t as { source?: string }).source ?? "";
      return src === "custom:sandbox" && t.name !== "sandbox-destroy";
    });

    // Playwright browser tools (@playwright/mcp) ride on sandbox selection —
    // they were previously only in the sandbox subagent palette. An agent that
    // selects any sandbox tool gets the browser tools on the parent too. They
    // bypass the tools.custom gate (not custom-sourced), so only add them when
    // sandbox is actually selected.
    const sandboxSelected = (toolsConfigEarly?.custom ?? []).some((s) => s.startsWith("sandbox-"));
    const playwrightHoistedTools =
      sandboxSelected && playwrightGroup ? playwrightGroup.tools : [];

    let allTools = [
      ...subagentTools, // spaces, bitbucket, grafana, deepwiki, context7, pgm
      ...directTools, // write tools (create-ticket, send-message)
      ...remainingCustomTools, // custom tools not wrapped in a subagent
      ...parentHoistedTools, // sandbox tools mounted directly on the parent
      ...playwrightHoistedTools, // browser tools, for sandbox-selected agents
      ...kbHoistedTools, // kb-* tools when the agent has ≥1 AgentCollection grant
    ];

    log(
      `Tools: ${subagentTools.length} subagents, ${directTools.length} direct, ${customToolDefs.length} custom, ${parentHoistedTools.length} parent-hoisted, ${kbHoistedTools.length} kb-hoisted`,
    );

    // Apply agent-level tool config from DB (agent.config.tools). Reuses the
    // toolsConfigEarly parse we did above for the directPickSuffixes hoist.
    if (toolsConfigEarly) {
      const allowedSubagents = new Set(toolsConfigEarly.subagents ?? []);
      const allowedDirect = toolsConfigEarly.direct ?? [];
      const allowedCustom = new Set(toolsConfigEarly.custom ?? []);
      const allowedGatewayServices = new Set(toolsConfigEarly.gateway ?? []);

      allTools = allTools.filter((t) => {
        if (subagentTools.some((s) => s.name === t.name))
          return allowedSubagents.has(t.name);
        if (directTools.some((d) => d.name === t.name)) {
          // Live tool names (t.name) and config entries (d) can disagree on
          // case and on separator convention:
          //   • bare                — "user-send-message"
          //   • slug-cased prefix   — "xyne-spaces-app-tools__apps-send-message"   (synced `tools.slug`)
          //   • human-cased prefix  — "Xyne_Spaces_App_Tools__apps-send-message"   (decorated at runtime)
          // Existing branches handle the bare/prefixed pairing. The new
          // normalized-full match (lowercase + _→-) catches the slug-vs-
          // decorated case (same server, different casing convention) WITHOUT
          // matching across different servers — we compare the whole string,
          // not just the bare suffix, so a config entry from server A can't
          // accidentally grant tools from server B that share a bare name.
          const norm = (s: string): string =>
            s.toLowerCase().replace(/_/g, "-");
          const tNorm = norm(t.name);
          const toolSelectionKey = (t as { selectionKey?: string }).selectionKey;
          const isDirectPick = allowedDirect.some((d: string) =>
            t.name === d ||
            t.name.endsWith(d) ||
            d.endsWith(`__${t.name}`) ||
            tNorm === norm(d) ||
            (toolSelectionKey ? d === toolSelectionKey : false),
          );
          // Gateway tools are exposed as direct tools; keep them when their
          // service name (e.g. "mettle") is selected in tools.gateway.
          // Use stable serviceName metadata instead of mutable display label.
          const toolServiceName = (t as { serviceName?: string }).serviceName;
          const isGatewayPick = toolServiceName ? allowedGatewayServices.has(toolServiceName) : false;
          // Some claw-auth-executed direct tools are catalogued under "System
          // Tools" (source custom:*), so the user selects them by slug into
          // tools.custom rather than by name into tools.direct (e.g. webfetch).
          // Honour that selection here via the tool's selectionKey so execution
          // can stay in claw-auth (/mcp/call) while the picker shows it as a
          // System Tool. See mcp/adapters/webfetch.ts in xyne-claw-auth.
          const isCustomPick = toolSelectionKey ? allowedCustom.has(toolSelectionKey) : false;
          return isDirectPick || isGatewayPick || isCustomPick;
        }
        if (customToolDefs.some((c) => c.name === t.name))
          return allowedCustom.has(t.name);
        return true;
      });

      log(
        `Agent tools config applied: ${allTools.length} tools after filtering`,
      );
    }

    // Inject copilot respond-to-user tool if provider is copilot.
    // Defence-in-depth: also require an actual copilot config. Without this
    // guard, a caller dispatching `provider="copilot"` without copilot creds
    // (the historical webhook resolver bug — see claw-auth/routes/webhook.ts)
    // would land in copilot mode while the LLM actually fell through to
    // LiteLLM. That mismatch forced thinking on a Claude Sonnet that
    // doesn't separate thinking blocks, leaking visible reasoning to users.
    const isCopilot = provider === "copilot" && !!parentProviderConfig?.apiKey;
    const effectiveModel = parentProviderConfig?.model ?? LITELLM.model;
    log(
      `provider=${provider ?? "spaces"} isCopilot=${isCopilot} model=${effectiveModel}`,
    );
    if (isCopilot) {
      const copilotTool = buildCopilotTool(getPendingResponses, abortRun);
      allTools.push(copilotTool);
      log("Copilot mode — injected respond-to-user tool");
    }

    if (agentSlug && memoryEnabled) {
      allTools.push(buildMemorySearchTool(agentSlug, userId, sessionId));
      log("Memory enabled — injected memory-search tool");
    }

    // verifyResponses: opt-in per agent. The agent delivers its final answer
    // via the submit-response tool, which verifies the draft against gathered
    // evidence before posting (single-run equivalent of the /goal audit pass).
    // Scoped to non-copilot: copilot already owns delivery via respond-to-user,
    // and stacking two terminal delivery tools would confuse the model.
    // `evidenceRef.getDigest` is wired by agent.ts once the session exists.
    // Per-agent model settings + structured output (agentConfig.modelSettings /
    // agentConfig.outputFormat). Structured output is mutually exclusive with
    // the other terminal delivery channels: copilot owns delivery via
    // respond-to-user, and verifyResponses owns it via submit-response — when
    // outputFormat is set it wins over verifyResponses and is skipped in
    // copilot mode.
    const modelSettings = parseModelSettings(agentConfig);
    if (modelSettings) {
      log(`Per-agent modelSettings: ${JSON.stringify(modelSettings)}`);
    }
    const outputFormat = parseOutputFormat(agentConfig);
    const structuredOutputRef: StructuredOutputRef = {};
    const structuredOutputActive = !!outputFormat && !isCopilot;
    if (outputFormat && isCopilot) {
      log(
        "outputFormat configured but provider is copilot — structured output skipped (respond-to-user owns delivery)",
      );
    }
    if (structuredOutputActive && outputFormat) {
      allTools.push(buildSubmitResultTool(outputFormat, structuredOutputRef));
      log(
        "outputFormat enabled — injected submit-result tool (JSON schema-constrained final answer)",
      );
    }

    // verifyResponses resolution:
    //   1. Per-agent config flag (explicit true/false) always wins.
    //   2. Else the global env default RESPONSE_VERIFY_ALL=on.
    // Replay over real sessions (2026-06: 60 sessions, 18% rejected, ~73% of
    // those genuine — fabricated counts/timestamps/IDs, false /goal completion)
    // backed enabling globally. False positives clustered in Digital Twin
    // casual chat (rhetorical questions, no verifiable deliverable), so the
    // GLOBAL default skips Twin agents; an explicit per-agent `true` still
    // honors them. Always yields to structured output (it owns delivery).
    const verifyAllDefault =
      (process.env["RESPONSE_VERIFY_ALL"] ?? "off").toLowerCase() === "on";
    const verifyCfg = agentConfig?.["verifyResponses"] as boolean | undefined;
    const isTwinAgent = agentSlug ? isDigitalTwinAgent(agentSlug) : false;
    const verifyResponses =
      (verifyCfg ?? (verifyAllDefault && !isTwinAgent)) &&
      !structuredOutputActive;
    const evidenceRef: EvidenceRef = {};
    if (verifyResponses && !isCopilot) {
      const rawCriteria = agentConfig?.["verifyResponseCriteria"];
      const verifyResponseCriteria =
        typeof rawCriteria === "string" && rawCriteria.trim() ? rawCriteria.trim() : undefined;
      allTools.push(
        buildVerifiedResponseTool({
          getPendingResponses,
          abortRun,
          task,
          evidenceRef,
          agentSlug,
          ...(verifyResponseCriteria ? { criteria: verifyResponseCriteria } : {}),
        }),
      );
      log(
        `verifyResponses enabled — injected submit-response tool${verifyResponseCriteria ? " (with per-agent criteria)" : ""}`,
      );
    }

    // Citation reflection: opt-in per agent (agentConfig.citationReflection).
    // Post-response, agent.ts nudges the model to add inline [clf-…] citations
    // when it answered from citeable sources but cited none. Cheap (regex +
    // ≤1 re-prompt), independent of verifyResponses. Accepts boolean or "true"
    // string (the dashboard free-form config editor stores scalars as strings).
    const citationReflection =
      agentConfig?.["citationReflection"] === true ||
      agentConfig?.["citationReflection"] === "true";
    if (citationReflection) log("citationReflection enabled — post-response citation nudge active");

    // Generic auto-citations: opt-in per agent (agentConfig.autoToolCitations).
    // When on, every tool result that doesn't already self-cite is chunked and
    // prefixed with inline [clf-…] tokens so the model can cite any tool's
    // output. Accepts boolean or "true" (free-form config editor stores strings).
    const autoToolCitations =
      agentConfig?.["autoToolCitations"] === true ||
      agentConfig?.["autoToolCitations"] === "true";
    if (autoToolCitations) log("autoToolCitations enabled — generic [clf-…] tokens on all tool results");

    // suggest-goal tool: opt-in per agent. When the agent's config has
    // `suggestGoal: true`, the worker can call this tool to propose a /goal
    // loop. The suggestion is surfaced as a one-click button in the Spaces
    // thread (rendered by claw-auth webhook.ts based on pendingGoalSuggestion
    // on the result payload). Only the latest call wins. The collector
    // variable is hoisted at the top of the handler so the copilot-mode
    // catch branch can also forward it.
    const suggestGoalEnabled = agentConfig?.["suggestGoal"] === true;
    if (suggestGoalEnabled) {
      allTools.push(
        buildSuggestGoalTool((s) => {
          pendingGoalSuggestion = s;
        }),
      );
      log("suggestGoal enabled — injected suggest-goal tool");
    }

    // A scheduled run must NEVER see the schedule-task tool. Without this,
    // agents whose task text implies recurrence ("hourly PR report") re-arm
    // themselves every run — a chain of once-jobs that user deletion can't
    // kill because the in-flight run respawns the next link (prod 2026-06-11:
    // doctor-agent re-created its job 90s after a mass-delete). Agents also
    // abused delayMs=0 "scheduled" jobs as a post-to-channel hack, spawning
    // 1-3 extra jobs + full agent runs per report. Recurrence belongs to the
    // ONE originating cron/once job; only interactive runs may create jobs.
    const isScheduledRun =
      eventType === "scheduled_job" ||
      (conversationId?.startsWith("scheduled_") ?? false);
    if (isScheduledRun) {
      const before = allTools.length;
      allTools = allTools.filter((t) => t.name !== "schedule-task");
      if (allTools.length !== before) {
        log("Scheduled run — schedule-task tool removed (self-scheduling ban)");
      }
    }

    // Read-only routing (sbx-git): scheduled / automation runs are diverted to
    // the SHARED read-only sbx-git sandbox (see sandboxRepoSetup → resolveSbxGit),
    // so they must not carry mutating sandbox tools. Strip them here as the
    // tool-level half of read-only enforcement (the sbx-git pod also mounts
    // repos read-only). A rare automation that genuinely needs to write/run can
    // opt out with agentConfig.allowWriteInReadOnlyJob.
    const isReadOnlyJob = eventType === "automation" || eventType === "scheduled" || isScheduledRun;
    const allowWriteInReadOnlyJob = agentConfig?.["allowWriteInReadOnlyJob"] === true;
    // forceReadOnlySandbox: per-agent opt-in to the read-only sbx-git path for ALL
    // runs (reviewer agents). It wins over allowWriteInReadOnlyJob — explicit
    // read-only intent — and applies even to interactive (non-job) runs.
    const forceReadOnlySandbox = agentConfig?.["forceReadOnlySandbox"] === true;
    if (forceReadOnlySandbox || (isReadOnlyJob && !allowWriteInReadOnlyJob)) {
      // Keep in sync with SBX_GIT.disabledTools (xyne-claw-shared/.../repo-configs.ts).
      const RO_DISABLED = new Set([
        "sandbox-run", "sandbox-run-detached", "sandbox-write-file",
        "sandbox-create", "sandbox-destroy", "write",
      ]);
      const before = allTools.length;
      allTools = allTools.filter((t) => !RO_DISABLED.has(t.name));
      if (allTools.length !== before) {
        log(`Read-only ${eventType ?? "scheduled"} run — stripped ${before - allTools.length} mutating sandbox tool(s) (sbx-git read-only)`);
      }
    }

    const tools = allTools.length > 0 ? allTools : undefined;

    // Inject event type into context so the agent knows how it was invoked
    let fullContext = context;
    if (eventType) {
      const eventNote = `## Event Type: ${eventType}`;
      fullContext = fullContext ? `${eventNote}\n\n${fullContext}` : eventNote;
    }
    if (eventType === "automation") {
      const automationLines = [
        "## Automation Run",
        "This run was started by a Xyne Spaces automation, not a direct human mention.",
        "The task is the workflow's RUN_AGENT prompt. If it says to handle an event but does not include enough detail, inspect the Spaces thread before answering.",
        ...(conversationId
          ? [
              `- Use \`spaces-messages\` with conversationId \`${conversationId}\` to read the triggering thread.`,
            ]
          : []),
        ...(channelId ? [`- channelId: ${channelId}`] : []),
        "Return the workflow step result as the final answer.",
      ];
      const automationNote = automationLines.join("\n");
      fullContext = fullContext
        ? `${fullContext}\n\n${automationNote}`
        : automationNote;
    }
    // Inject metadata so agents can reference channelId/conversationId in tool calls
    const metaLines = [
      "## Session Metadata",
      ...(channelId ? [`- channelId: ${channelId}`] : []),
      ...(conversationId
        ? [`- agent session/conversationId: ${conversationId}`]
        : []),
      ...(spacesConversationId && typeof spacesConversationId === "string"
        ? [
            `- spacesConversationId/threadId: ${spacesConversationId} \n This conversation/thread id is attached by the user as context for this claw agent session`,
          ]
        : []),
    ];
    if (metaLines.length > 1) {
      fullContext = fullContext
        ? `${fullContext}\n\n${metaLines.join("\n")}`
        : metaLines.join("\n");
    }

    // /goal-awareness primer. Injected only when suggest-goal is registered
    // for this run. Without this, the agent learns about the loop feature
    // only by reading the tool's description mid-decision — too late if it
    // already finished planning in plain prose. The primer surfaces the
    // option up-front so the model considers it during planning, not after.
    // Kept short on purpose: full mechanics live in the tool description.
    if (suggestGoalEnabled) {
      const goalPrimer = [
        "## Autonomous /goal loop available",
        "This product supports `/goal` — a mode where you keep getting re-invoked turn after turn until a separate boss judge decides an exit condition is met (no human reply between turns; turn cap ~20; an audit pass runs once before termination).",
        "When you finish planning a task that (a) needs ≥3 independent iterations, (b) has a clear observable exit condition, and (c) doesn't need further user input, end your turn by calling the `suggest-goal` tool. The user sees a one-click button to promote the work to a /goal loop. The tool's full description has the criteria and exit-condition writing rules — read it before calling.",
        "If the task is single-turn or open-ended, just answer normally and do NOT call `suggest-goal`.",
      ].join("\n");
      fullContext = fullContext
        ? `${fullContext}\n\n${goalPrimer}`
        : goalPrimer;
    }

    // ── Sandbox primer ─────────────────────────────────────────────────────
    // Replaces what the sandbox subagent used to inject into its own session.
    // The subagent was removed (2026-06-09) because it slowed every read/write
    // by a full LLM round-trip and crashed on context overflow. Now that
    // sandbox-* tools mount directly on the parent, we surface the same
    // session-reuse + delivery rules in the parent's context — same content,
    // no extra hop. Sandbox is parent-direct (subagent removed) — gated by a
    // sandbox-* slug in tools.custom, matching custom-tools.ts.
    const sandboxEnabledForPrompt = (() => {
      const toolsObj = (agentConfig?.["tools"] ?? {}) as Record<
        string,
        unknown
      >;
      const customList = Array.isArray(toolsObj["custom"])
        ? (toolsObj["custom"] as string[])
        : [];
      // Sandbox is parent-direct now (subagent removed) — selection == any
      // sandbox-* slug in tools.custom.
      return customList.some((s) => s.startsWith("sandbox-"));
    })();
    if (sandboxEnabledForPrompt) {
      const sandboxLines: string[] = [
        "## Sandbox usage",
        "READ vs WRITE — this matters. For read-first repos (e.g. xyne-spaces) `sandbox-repo-setup` DEFAULTS to an instant READ-ONLY git sandbox (no wait): use it for reading, grepping, and inspecting code / PR review — which is almost everything. Only call `sandbox-repo-setup` with `write:true` when you must actually EDIT files, build, run tests, or commit — that claims a short-lived, auto-expiring writable dev sandbox. Do NOT request write just to look at code; default to read and escalate to write only when you're about to change something.",
        "Sandbox tools (sandbox-create, sandbox-run, sandbox-write-file, sandbox-read-file, sandbox-deliver-files, sandbox-pw-*) run code/commands in an isolated VM. Use them whenever you need execution, file generation, screenshots, or browser automation.",
        "- To send a file BACK to the user, you MUST call `sandbox-deliver-files` with the path(s). Returning file contents as text in your reply is NOT delivery — Spaces won't render it as an attachment.",
        "- Reuse a single sandbox session across many commands when possible. Avoid one-shot `sandbox-run` calls if you need to keep state.",
        "- For URLs of the form `http://localhost:<port>` (dashboard :5173, backend :3001) use `sandbox-pw-*` tools, NOT `sandbox-run` with inline Playwright. The browser inside the sandbox can reach those addresses.",
        "- Git/GitHub PRs: make + commit your changes in the sandbox and `git push` the branch from there (the sandbox has push credentials). The sandbox has NO `gh` CLI — do NOT try `gh pr create`. To OPEN the PR, hand it to the **github** subagent's `create_pull_request` tool (head=<your branch>, base=<default branch>); that runs against the GitHub API and needs no `gh`. Only fall back to giving the user a compare URL if `create_pull_request` actually returns an error — and report that real error.",
        "- NEVER claim a branch was pushed or a PR was opened from memory. Verify first: a push is only real if `git ls-remote --heads origin <branch>` shows the ref (or `git push` printed the upstream-tracking/'new branch' line). State exactly what the command returned — do not narrate a success or a failure you did not observe.",
      ];
      // Surface an active session for this conversation so the agent reuses
      // it instead of cold-starting. Only repo-template sessions are worth
      // reusing — bare warmpool VMs have no creds baked in.
      if (conversationId) {
        const storeKey = buildSandboxStoreKey(
          userId,
          conversationId,
          agentSlug,
        );
        const existing = storeKey ? getSandboxSession(storeKey) : undefined;
        const isRepoTemplate =
          !!existing &&
          (existing.id.includes("agent-workspace") ||
            existing.id.includes("docker-dev"));
        if (existing && isRepoTemplate) {
          const alive = await probeSession(existing, storeKey).catch(
            () => false,
          );
          if (alive) {
            sandboxLines.push(
              `- Active sandbox session: \`${existing.id}\` (already provisioned for this conversation). Use it as \`sessionId\` for ALL sandbox-run calls. Do NOT call \`sandbox-repo-setup\` again unless the session has died.`,
            );
            log(`Sandbox primer: surfaced existing session ${existing.id}`);
          }
        }
      }
      // Pinned repo config (agent.config.sandboxRepo). When set, the runtime
      // forces sandbox-repo-setup onto this repo — the LLM gets workdir + port
      // map so it doesn't guess `/home/user/` paths.
      const pinnedRepoName =
        (agentConfig?.["sandboxRepo"] as string | undefined) ?? undefined;
      const pinnedRepo = pinnedRepoName
        ? REPO_CONFIGS[pinnedRepoName]
        : undefined;
      if (pinnedRepoName && pinnedRepo) {
        const installPkgs = pinnedRepo.steps
          .filter(
            (
              s: SetupStep,
            ): s is { type: "install"; packages: string[]; cmd?: string } =>
              s.type === "install",
          )
          .flatMap((s) => s.packages);
        const setupLines: string[] = [];
        if (installPkgs.length > 0)
          setupLines.push(
            `  - npm install in: ${installPkgs.map((p) => `\`${p}/\``).join(", ")}`,
          );
        if (pinnedRepo.steps.some((s: SetupStep) => s.type === "services")) {
          setupLines.push(
            `  - docker compose services up (\`npm run services\`)`,
          );
        }
        if (!pinnedRepo.repoUrl) {
          // No-repo profile (e.g. "Browser (no repo)") — no clone, no dev
          // servers. The sandbox is a browser-only environment.
          sandboxLines.push(
            `- Pinned sandbox: **${pinnedRepoName}** — a browser-only sandbox (headless chromium + CDP + noVNC), NO repository and NO dev servers. Use the \`sandbox-pw-*\` tools for web automation; do not expect a repo at \`${pinnedRepo.workDir}\`.`,
          );
        } else {
          sandboxLines.push(
            `- Pinned repo: **${pinnedRepoName}** — repo \`${pinnedRepo.repoUrl}\`, default branch \`${pinnedRepo.defaultBranch}\`, workdir in VM \`${pinnedRepo.workDir}\`.` +
              (setupLines.length > 0
                ? `\n  \`sandbox-repo-setup\` auto-runs:\n${setupLines.join("\n")}`
                : "") +
              (pinnedRepo.ports
                ? `\n  Ports: ${Object.entries(pinnedRepo.ports)
                    .map(([k, v]) => `${k}=${v}`)
                    .join(", ")}`
                : ""),
          );
        }
      }
      const sandboxPrimer = sandboxLines.join("\n");
      fullContext = fullContext
        ? `${fullContext}\n\n${sandboxPrimer}`
        : sandboxPrimer;
    }

    // Surface every derived context file to the agent — without this, files
    // written under .context/ (xlsx → <name>.md, pdf → <name>.md) are
    // invisible: the LLM sees only the user's free-text turn and replies
    // "I don't see any attachment". Each entry shows the ORIGINAL filename
    // plus the path the agent's read tool should use.
    // Advertise the SAME sanitized path that writeWorkspaceTextFiles actually
    // wrote. sanitizeRelativePath replaces every char outside [a-zA-Z0-9._-]
    // with "_", so "Juspay ecomm Issues Log.xlsx" lands at
    // ".context/Juspay_ecomm_Issues_Log.xlsx.md". Previously we showed the agent
    // the RAW filename (spaces/specials intact), so its first read hit a
    // nonexistent path and it had to guess the sanitization — which fails
    // outright for names with parens/&/commas/etc. Run the same sanitizer here
    // (toWorkspaceContextPath, which also prepends ".context/") so the path the
    // agent is told matches the file on disk exactly.
    const attachmentEntries: Array<{ label: string; path: string }> = [
      ...textAttachments.map((a) => ({
        label: `${a.fileName} (${a.mimeType || "application/octet-stream"})`,
        path: toWorkspaceContextPath(a.fileName),
      })),
      ...xlsxAttachments.map((a) => ({
        label: `${a.fileName} (xlsx, extracted to markdown)`,
        path: toWorkspaceContextPath(`${a.fileName}.md`),
      })),
      ...pdfAttachments.map((a) => ({
        label: `${a.fileName} (pdf, text-extracted to markdown)`,
        path: toWorkspaceContextPath(`${a.fileName}.md`),
      })),
    ];
    if (attachmentEntries.length > 0) {
      const attachmentContext = [
        "## Attached Files",
        // e.path already includes the ".context/" prefix — show it verbatim.
        ...attachmentEntries.map((e) => `- ${e.label} → \`${e.path}\``),
        "These files were uploaded with the user's message. Read them at the EXACT path shown (do not alter it) before responding.",
      ].join("\n");
      fullContext = fullContext
        ? `${fullContext}\n\n${attachmentContext}`
        : attachmentContext;
    }

    // Inject copilot system instructions
    if (isCopilot) {
      // COPILOT_SYSTEM_INSTRUCTION imported at top
      const copilotNote = `\n\n${COPILOT_SYSTEM_INSTRUCTION}`;
      fullContext = fullContext ? `${fullContext}${copilotNote}` : copilotNote;
    }
    // Tell verifyResponses agents to deliver via submit-response (the tool was
    // injected above). Mutually exclusive with copilot mode by construction.
    if (verifyResponses && !isCopilot) {
      const note = `\n\n${SUBMIT_RESPONSE_SYSTEM_INSTRUCTION}`;
      fullContext = fullContext ? `${fullContext}${note}` : note;
    }
    // Structured output: tell the agent up-front that the final answer must go
    // through submit-result (the tool description alone surfaces too late).
    // Instruction wording (and the markdown outline) depends on the type.
    if (structuredOutputActive && outputFormat) {
      const note = `\n\n${buildSubmitResultInstruction(outputFormat)}`;
      fullContext = fullContext ? `${fullContext}${note}` : note;
    }
    // Inject additional instructions if provided (backend-contextual guidance not shown in UI)
    if (additionalInstructions) {
      const instructionsNote = `\n\n## Additional Instructions\n${additionalInstructions}`;
      fullContext = fullContext
        ? `${fullContext}${instructionsNote}`
        : instructionsNote;
    }

    // Inject ticket/canvas/call IDs from the frontend into context metadata
    // so the agent knows which specific items the user is asking about
    clog.info(
      `[run] Injecting referenced items: ticketIds=${JSON.stringify(ticketIds)}, canvasIds=${JSON.stringify(canvasIds)}, callIds=${JSON.stringify(callIds)}`,
    );
    if (ticketIds?.length || canvasIds?.length || callIds?.length) {
      const idLines = [
        "## Referenced Items",
        ...(ticketIds?.length ? [`- Ticket IDs: ${ticketIds.join(", ")}`] : []),
        ...(canvasIds?.length ? [`- Canvas IDs: ${canvasIds.join(", ")}`] : []),
        ...(callIds?.length ? [`- Call IDs: ${callIds.join(", ")}`] : []),
      ];
      fullContext = fullContext
        ? `${fullContext}\n\n${idLines.join("\n")}`
        : idLines.join("\n");
    }

    // Key sessions by user + conversationId + agentSlug so each caller gets an isolated sandbox per thread.
    // Branching: when claw-auth has cloned the source session to a sibling
    // `piSessionConversationId`, use THAT as the storage key — the DB
    // `conversationId` stays the same (single logical chat) but the PI
    // session JSONL file lives at the branched dir.
    const sessionConversationId = piSessionConversationId ?? conversationId;
    const sessionKey =
      buildSandboxStoreKey(userId, sessionConversationId, agentSlug) ?? sessionConversationId;
    const runtimeProvider = parentProviderConfig ? provider : undefined;
    const providerConfig = parentProviderConfig;
    // Convert image attachments to ImageContent format for the LLM, then
    // append video keyframes extracted at ingest (see videoBufferToContext).
    // The narrative `.context/<name>.video.md` carries the full description;
    // these keyframes let the agent look at key moments directly.
    const imageContents: ImageContent[] | undefined = [
      ...imageAttachments.map((a) => ({
        type: "image" as const,
        data: a.data,
        mimeType: a.mimeType,
      })),
      ...videoKeyframes.map((f) => ({
        type: "image" as const,
        data: f.data,
        mimeType: f.mimeType,
      })),
    ];

    const fileAttachments = textAttachments.map((a) => ({
      fileName: a.fileName,
      mimeType: a.mimeType,
      path: toWorkspaceContextPath(a.fileName),
    }));

    // Mention handling: tell the agent ONLY the trigger (write plain `@Name`),
    // never IDs/brackets/lookups. The result-delivery path in claw-auth resolves
    // `@Name` → a real mention against the run's context people (sender + anyone
    // already mentioned in the thread) server-side. The old guide taught the
    // bracket+resolve-ID format, which confused agents into guessing IDs or, per
    // its own rule, refusing to emit `@Name` at all — starving the resolver.
    // Only relevant in a chat thread (channelId present).
    const basePrompt = (systemPrompt ?? "").trimEnd();
    const citationGuide =
      agentSlug && CITATION_GUIDE_AGENT_SLUGS.has(agentSlug)
        ? CITATION_GUIDE
        : "";
    const effectiveSystemPrompt = channelId
      ? `${basePrompt}${citationGuide}${SPACES_MENTION_GUIDE}`
      : `${basePrompt}${citationGuide}`;

    // Quota fallback wrapper: walks the agent owner's `providerOrder` on
    // 429 / insufficient_quota / out-of-credits, then drops to "spaces" (Kimi
    // via LiteLLM) as the terminal fallback. If providerOrder isn't set we
    // collapse to the previous behavior (single retry on Kimi).
    //
    // Build the attempt chain:
    //   - First entry = the current parent (runtimeProvider).
    //   - Subsequent entries = remaining providers from `providerOrder`
    //     for which we actually have credentials in `providerConfigs`.
    //   - Final entry = "spaces" (Kimi) unless the parent already was it.
    type Attempt = {
      provider: string | undefined;
      config: typeof providerConfig | undefined;
    };
    const attempts: Attempt[] = [
      { provider: runtimeProvider, config: providerConfig },
    ];
    if (providerOrder && providerOrder.length > 0) {
      for (const p of providerOrder) {
        if (p === runtimeProvider) continue;
        if (p === "spaces") continue; // appended last
        const cfg = providerConfigs?.[p];
        if (!cfg) continue;
        attempts.push({ provider: p, config: cfg });
      }
    }
    if (runtimeProvider && runtimeProvider !== "spaces") {
      attempts.push({ provider: "spaces", config: undefined });
    }

    // Default the per-attempt compaction flag to the caller's `compactBeforeRun`
    // (set by `/compact`). The provider-fallback machine still passes `true`
    // explicitly on empty-completion retries; this just makes the FIRST attempt
    // compact too when the user asked for it.
    const runAttempt = (a: Attempt, forceCompactBeforeRun = compactBeforeRun === true) =>
      runTask({
        // Per-agent model settings. `model` is the Spaces/platform-default model
        // override — runTask only applies it on attempts with no provider
        // credential (the LiteLLM branch), so premium attempts keep the model
        // configured on their credential.
        modelSettings,
        ...(structuredOutputActive ? { structuredOutputRef } : {}),
        userId,
        task,
        context: fullContext,
        userName,
        userEmail,
        customTools: tools,
        systemPromptOverride: effectiveSystemPrompt,
        cwd: workspaceDir,
        conversationId: sessionKey,
        provider: a.provider,
        providerConfig: a.config,
        progressUrl,
        sessionId,
        images: imageContents?.length ? imageContents : undefined,
        fileAttachments:
          fileAttachments.length > 0 ? fileAttachments : undefined,
        skills,
        skillTriggers:
          resolvedTriggers.length > 0 ? resolvedTriggers : undefined,
        promptInjections:
          activeInjections.length > 0 ? activeInjections : undefined,
        abortSignal,
        // Raw Spaces identity for progress callbacks → lets /webhook/progress fall
        // back to claw-auth's conv-keyed session index (mirrors the /result body).
        progressMeta: {
          conversationId: conversationId ?? null,
          agentSlug: agentSlug ?? null,
        },
        forceCompactBeforeRun,
        // submit-response verification: agent.ts wires the evidence accessor on
        // this ref so the tool can check drafts against gathered tool results.
        ...(verifyResponses && !isCopilot
          ? { verifyResponsesRef: evidenceRef }
          : {}),
        citationReflection,
        autoToolCitations,
        ...(isRegenerate ? { isRegenerate: true } : {}),
      });

    // Capture provider-fallback context so an empty FINAL result can tell the
    // user it was a provider/quota failure (e.g. 429) instead of a silent blank.
    // `lastFallbackUnderlying` holds the error that triggered the most recent
    // fallback (a 429/quota rate_limit_error, or "empty completion from <p>").
    let providerFellBack = false;
    let lastFallbackUnderlying: string | undefined;

    // Provider-fallback state machine (empty-completion + quota fallback,
    // compact-before-fallback). Decision logic extracted to provider-fallback.ts
    // so it's unit-tested; this call wires in the I/O (run, log, metrics).
    const {
      result: fbResult,
      completedAttempt,
      fellBackProvider,
    } = await runWithProviderFallback<
      Attempt,
      Awaited<ReturnType<typeof runTask>>
    >({
      attempts,
      providerLabel: (a) => a.provider ?? "spaces",
      runAttempt,
      // Nothing user-visible: no text, no attachments, no pending responses/actions.
      producedNothing: (r) =>
        !r.text.trim() &&
        getAttachments().length === 0 &&
        getPendingResponses().length === 0 &&
        getPendingActions().length === 0 &&
        getCustomPendingActions().length === 0,
      isQuotaError: (err) =>
        err instanceof QuotaExhaustedError || isQuotaExhaustedError(err),
      // Transient provider/network failures + detected stalls fall back to the
      // next provider (→ spaces) instead of dropping the run. A genuine user
      // cancel is gated out by isCancelled below before this is consulted.
      isTransientError: (err) => isTransientProviderError(err),
      isCancelled: (err) =>
        err instanceof RunCancelledError || !!abortSignal?.aborted,
      hooks: {
        onFallback: (from, to, lastErr) => {
          providerFellBack = true;
          lastFallbackUnderlying =
            lastErr instanceof Error ? lastErr.message : String(lastErr);
          metric.count("agent_provider_fallback", { from, to, agentSlug });
          log(
            `Quota fallback: ${from} → ${to}. Underlying: ${lastFallbackUnderlying}`,
          );
        },
        onEmpty: (provider, terminal) => {
          metric.count("agent_empty_completion", {
            provider,
            agentSlug,
            terminal,
          });
          if (!terminal)
            log(
              `Empty completion from ${provider} (no text/attachments/pending) — compacting + falling back to next provider.`,
            );
        },
        onRecovered: (provider) =>
          log(`Quota fallback succeeded on ${provider}.`),
      },
    });
    const result = fbResult;

    const resultAttachments = [...getAttachments(), ...(mcpGetAttachments?.() ?? [])];
    const pendingQuestions = getPendingQuestions();
    const pendingActions = [
      ...getPendingActions(),
      ...getCustomPendingActions(),
    ];
    const dedupedPendingActions = (() => {
      const seen = new Set<string>();
      const out: Array<Record<string, unknown>> = [];
      for (const action of pendingActions) {
        if (!action || typeof action !== "object") {
          out.push(action);
          continue;
        }
        const record = action as Record<string, unknown>;
        const signature = typeof record.signature === "string" ? record.signature : "";
        const key = signature.length > 0 ? `sig:${signature}` : `raw:${JSON.stringify(record)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(action);
      }
      return out;
    })();
    const pendingResponses = getPendingResponses();
    const completedProvider =
      completedAttempt?.provider ?? runtimeProvider ?? "spaces";
    const completedModel = completedAttempt?.config?.model ?? effectiveModel;
    callbackProvider = completedProvider;
    callbackModel = completedModel;

    // Flatten: parent's top-level tools + nested MCP tools run inside subagents.
    // Chain conditions evaluate against this combined list so users can match
    // on specific inner tools (Bitbucket__create_pull_request) in addition to
    // subagent wrappers (bitbucket).
    const combinedToolsUsed = [...result.toolsUsed, ...subagentInnerTools];

    const lat = result.latency;
    const latencyStr = lat
      ? ` | total=${lat.totalMs}ms llm=${lat.llmTotalMs}ms (wait=${lat.llmWaitMs}ms decode=${lat.llmDecodeMs}ms) tools=${lat.toolMs}ms turns=${lat.llmTurns} retries=${lat.llmRetries}` +
        (lat.firstTurnTtftMs != null ? ` ttft=${lat.firstTurnTtftMs}ms` : "") +
        (lat.tokensPerSec != null ? ` tps=${lat.tokensPerSec}` : "")
      : "";
    log(
      `Completed: ${combinedToolsUsed.length} tools used (${result.toolsUsed.length} top-level + ${subagentInnerTools.length} nested), ${resultAttachments.length} attachment(s), ${pendingQuestions.length} question(s), ${dedupedPendingActions.length} pending action(s), ${pendingResponses.length} copilot response(s), resultLength=${result.text.length}${latencyStr}`,
    );

    // Rescue empty-text runs that delivered an attachment. If the agent
    // called an attachment-emitting tool (e.g. create-html-report) and then
    // ended its turn with no chat-visible text, Spaces hides the message
    // entirely and shows "Sorry, I wasn't able to produce a response."
    // Promote the most recent attachment tool's summary (e.g. the agent's
    // own `summary` parameter to create-html-report) to result.text so the
    // user gets a real reply alongside the attachment.
    let finalResultText = result.text;

    // Structured output: derive the chat-visible text from the captured payload
    // and (for type "json") expose the raw JSON to machine consumers.
    //   - markdown      → the agent's markdown string, posted as-is.
    //   - json+template → render the template to markdown for the chat reply;
    //                     raw JSON still flows to workflow/trigger consumers.
    //   - json          → pretty-printed JSON in the chat (no template).
    let structuredOutputPayload: unknown;
    if (
      structuredOutputActive &&
      outputFormat &&
      structuredOutputRef.value !== undefined
    ) {
      const v = structuredOutputRef.value;
      if (outputFormat.type === "markdown") {
        finalResultText = typeof v === "string" ? v : String(v);
      } else {
        structuredOutputPayload = v;
        if (outputFormat.template) {
          try {
            finalResultText = renderTemplate(outputFormat.template, v);
            log(
              `Structured output rendered via template (length=${finalResultText.length})`,
            );
          } catch (e) {
            finalResultText = JSON.stringify(v, null, 2);
            log(
              `Template render failed, falling back to raw JSON: ${e instanceof Error ? e.message : String(e)}`,
            );
          }
        } else {
          finalResultText = JSON.stringify(v, null, 2);
        }
      }
    }

    if (
      (!finalResultText || !finalResultText.trim()) &&
      resultAttachments.length > 0 &&
      customToolsResult
    ) {
      const fallback = customToolsResult.getLastAttachmentSummary();
      if (fallback && fallback.trim()) {
        finalResultText = fallback.trim();
        log(
          `Rescued empty result.text from attachment summary (length=${finalResultText.length})`,
        );
      }
    }

    // submit-response / respond-to-user agents (verifyResponses, copilot, codex —
    // e.g. the doctor agents) deliver their answer as pendingResponses, which
    // leaves result.text EMPTY. The automation/scheduled executor reads the
    // `result` field, so without this the coerced result is `{"result":""}` and
    // REPLY_ON_MESSAGE (content: z.string().min(1)) silently drops it — every run.
    // Fold the pendingResponse message(s) into the result when result.text is
    // empty. Mention runs post pendingResponses directly, so this is a safe
    // fallback there too.
    if ((!finalResultText || !finalResultText.trim()) && pendingResponses.length > 0) {
      finalResultText = pendingResponses
        .map((r) => r.message)
        .filter((m) => typeof m === "string" && m.trim().length > 0)
        .join("\n\n")
        .trim();
      log(
        `Rescued empty result.text from ${pendingResponses.length} pending response(s) (length=${finalResultText.length})`,
      );
    }

    // Retrieve LLM-provided citations from add_citations tool
    const llmCitations = takeLlmCitations(sessionId);
    log(
      `llmCitations retrieved: ${llmCitations?.length ?? 0} keypoint(s) for session ${sessionId}`,
    );

    const automationStructuredResult =
      eventType === "automation"
        ? coerceAutomationResult(finalResultText)
        : undefined;
    // `result` is always the plain chat/markdown answer (the structured
    // `{result:...}` object travels separately in `automationResult` /
    // `structuredOutput` for machine consumers). We do NOT stringify the
    // wrapper into `result`: the Spaces RUN_AGENT executor posts the `result`
    // field verbatim, so a stringified `{"result":"…\n…"}` showed up in threads
    // as raw escaped JSON instead of the rendered answer. The executor still
    // gets the structured form via `automationResult`.
    const callbackResultText = finalResultText;

    // Honor an explicit user stop even when generation FINISHED before the abort
    // could interrupt it. Non-copilot agents (codex/spaces) deliver their final
    // answer here on the success path — NOT via respond-to-user — so the catch
    // block's user-cancel guard never runs for them. Without this, a fast run
    // ("count to 100") posts status="completed" and the answer overwrites the
    // user's "Query aborted by user." in the UI. Emit "cancelled" and skip the
    // completed marker + callback so nothing is persisted/posted.
    if (activeRuns.get(sessionId)?.userCancelled === true) {
      log(`Session cancelled by user — suppressing completed result: ${sessionId}`);
      await sendCallback(callbackUrl, sessionToken, {
        sessionId,
        userId,
        conversationId: conversationId ?? null,
        agentSlug: agentSlug ?? null,
        status: "cancelled",
      });
      return;
    }

    // Durable terminal marker — the source of truth for "this run finished",
    // written to GCS BEFORE the result callback. A deploy/SIGTERM can drop the
    // callback (the 2026-06-11 incident), leaving recovery to re-dispatch; the
    // recovery worker + this run's own pre-check read this marker and replay
    // the result instead of re-executing side-effecting work. Keyed by
    // idempotencyKey (recovery rootSessionId) when present, else this run's
    // sessionId (= rootSessionId for the original dispatch). Best-effort: a
    // failed marker write just means a re-dispatch would re-run (current behavior).
    await gcsUploadResultMarker(
      idempotencyKey ?? sessionId,
      Buffer.from(
        JSON.stringify({
          idempotencyKey: idempotencyKey ?? sessionId,
          sessionId,
          status: "completed",
          completedAt: new Date().toISOString(),
          result: callbackResultText,
          toolsUsed: combinedToolsUsed,
          // Outbox-growth fields — not consumed yet; let this marker become the
          // reconciler's record for idempotent delivery/ack later.
          deliveredToUser: false,
          recoveryAcked: false,
        }),
        "utf8",
      ),
    ).catch(() => {});

    // If the run delivered nothing user-visible AND we fell back between
    // providers, the blank is a provider failure (429/quota, a transient
    // network error, or an empty completion), not the agent having nothing to
    // say. Tag the callback so claw-auth can tell the user it was a provider
    // issue instead of the generic "I wasn't able to produce a response", and
    // forward the underlying detail for ANY fallback (not just 429s). The
    // detail is sanitized — URLs and IP[:port]s stripped, whitespace collapsed,
    // length-clamped — so a transient/network fallback can't leak an internal
    // host or path to end users.
    const finalProducedNothing =
      !callbackResultText.trim() &&
      resultAttachments.length === 0 &&
      pendingResponses.length === 0 &&
      pendingActions.length === 0 &&
      pendingQuestions.length === 0;
    const emptyReason =
      finalProducedNothing && providerFellBack ? "provider_capacity" : undefined;
    const emptyReasonDetail =
      emptyReason && lastFallbackUnderlying
        ? lastFallbackUnderlying
            .replace(/https?:\/\/\S+/gi, "")
            .replace(/\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/g, "")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 200) || undefined
        : undefined;

    await sendCallback(callbackUrl, sessionToken, {
      sessionId,
      userId,
      conversationId: conversationId ?? null,
      agentSlug: agentSlug ?? null,
      status: "completed",
      result: callbackResultText,
      ...(emptyReason ? { emptyReason } : {}),
      ...(emptyReasonDetail ? { emptyReasonDetail } : {}),
      // Raw JSON for machine consumers (chain-workflows/triggers). Present only
      // for type "json" structured output; the chat `result` above may be the
      // template-rendered markdown instead.
      ...(structuredOutputPayload !== undefined
        ? { structuredOutput: structuredOutputPayload }
        : {}),
      ...(automationStructuredResult !== undefined
        ? { automationResult: automationStructuredResult }
        : {}),
      toolsUsed: combinedToolsUsed,
      tokenUsage: result.tokenUsage,
      ...(result.reasoning && result.reasoning.trim()
        ? { reasoning: result.reasoning }
        : {}),
      ...(result.latency ? { latency: result.latency } : {}),
      ...(result.toolInvocations.length > 0
        ? { toolInvocations: result.toolInvocations }
        : {}),
      ...(resultAttachments.length > 0
        ? { attachments: resultAttachments }
        : {}),
      ...(pendingQuestions.length > 0 ? { pendingQuestions } : {}),
      ...(dedupedPendingActions.length > 0 ? { pendingActions: dedupedPendingActions } : {}),
      ...(pendingResponses.length > 0 ? { pendingResponses } : {}),
      ...(pendingGoalSuggestion ? { pendingGoalSuggestion } : {}),
      ...(llmCitations && llmCitations.length > 0 ? { llmCitations } : {}),
      provider: completedProvider,
      model: completedModel,
    });
  } catch (err) {
    // HA: another pod already owns this conversation's lock. Skip silently —
    // do NOT send a failure callback, so the owning pod's real result is the
    // one that reaches claw-auth. (Happens when run-recovery refires a run that
    // the original, still-alive pod is also processing.)
    if (err instanceof SessionLockedError) {
      log(
        `Skipped: conversation locked by another worker (sessionId=${sessionId})`,
      );
      return;
    }
    // If respond-to-user fired before the abort propagated, this is a
    // graceful copilot-mode termination — treat as completed so the response
    // actually posts to Spaces instead of being silently dropped as a cancel.
    const pendingResponsesAtError =
      customToolsResult?.getPendingResponses() ?? [];
    // Recover attachments collected during the run too. Without this, any
    // tool that pushed via `[ATTACHMENT:...]` (create-html-report,
    // create-ppt, sandbox-deliver-files, etc.) — which all run BEFORE the
    // terminating `respond-to-user` call — would have their attachments
    // silently dropped, because this catch block ran instead of the normal
    // completion path that aggregates them at line ~665.
    const attachmentsAtError = [
      ...(customToolsResult?.getAttachments() ?? []),
      ...(mcpGetAttachments?.() ?? []),
    ];
    // Recover pendingActions collected during the run. Mirrors the success
    // path at ~line 1178 which merges MCP-layer + custom-tool pendingActions.
    // Without this, a copilot-mode agent that calls a write tool (e.g.
    // spaces-create-ticket) AND respond-to-user in the same turn has its
    // signed pendingAction dropped on the floor — claw-auth never posts the
    // Approve/Decline FlowUI card and the user sees text saying
    // "pending approval" with nothing to approve.
    const pendingActionsAtError = [
      ...(mcpGetPendingActions?.() ?? []),
      ...(customToolsResult?.getPendingActions() ?? []),
    ];
    const dedupedPendingActionsAtError = pendingActionsAtError.filter(
      (action, index, actions) =>
        index ===
        actions.findIndex(
          (candidate) =>
            candidate.kind === action.kind &&
            candidate.title === action.title &&
            candidate.payloadUrl === action.payloadUrl,
        ),
    );
    // An explicit user stop wins over a just-generated answer. Without this, a
    // fast run (e.g. "count to 100") that calls respond-to-user a beat before
    // the cancel lands would post status="completed" and overwrite the user's
    // "Query aborted by user." in the UI. When the user cancelled, fall through
    // to the cancelled branch below instead.
    const isUserCancel = activeRuns.get(sessionId)?.userCancelled === true;
    if (
      pendingResponsesAtError.length > 0 &&
      !isUserCancel &&
      (err instanceof RunCancelledError || abortSignal?.aborted)
    ) {
      log(
        `Session terminated by respond-to-user (${pendingResponsesAtError.length} response(s), ${attachmentsAtError.length} attachment(s)): ${sessionId}`,
      );
      // Retrieve LLM-provided citations from add_citations tool (same as success path)
      const llmCitationsAtError = takeLlmCitations(sessionId);
      log(
        `llmCitations retrieved at respond-to-user: ${llmCitationsAtError?.length ?? 0} keypoint(s) for session ${sessionId}`,
      );
      // Fold the respond-to-user message(s) into `result` — the SAME rescue as
      // the success path (~line 2143). copilot/codex/verifyResponses delivery
      // terminates by ABORTING (respond-to-user throws), so it lands HERE in the
      // catch, never the success path — meaning that rescue never ran for these.
      // Without this, `result` stays "" and the automation / scheduled forward
      // path (webhook.ts result-forward branch) reads only `result`, ignoring
      // `pendingResponses`, so it forwards empty text → REPLY_ON_MESSAGE
      // (content: z.string().min(1)) silently drops it → no reply posts. Every
      // respond-to-user automation run. Mention/conversation runs post
      // pendingResponses directly, so a populated `result` here is a harmless,
      // consistent fallback (matches the success path, which sends both).
      const recoveredResultText = pendingResponsesAtError
        .map((r) => r.message)
        .filter((m) => typeof m === "string" && m.trim().length > 0)
        .join("\n\n")
        .trim();
      log(
        `Rescued result from ${pendingResponsesAtError.length} respond-to-user response(s) (length=${recoveredResultText.length})`,
      );
      const automationResultAtError =
        eventType === "automation"
          ? coerceAutomationResult(recoveredResultText)
          : undefined;
      await sendCallback(callbackUrl, sessionToken, {
        sessionId,
        userId,
        conversationId: conversationId ?? null,
        agentSlug: agentSlug ?? null,
        status: "completed",
        result: recoveredResultText,
        ...(automationResultAtError !== undefined
          ? { automationResult: automationResultAtError }
          : {}),
        pendingResponses: pendingResponsesAtError,
        ...(pendingGoalSuggestion ? { pendingGoalSuggestion } : {}),
        ...(dedupedPendingActionsAtError.length > 0 ? { pendingActions: dedupedPendingActionsAtError } : {}),
        ...(attachmentsAtError.length > 0 ? { attachments: attachmentsAtError } : {}),
        ...(err instanceof RunCancelledError && err.toolsUsed.length > 0 ? { toolsUsed: err.toolsUsed } : {}),
        ...(err instanceof RunCancelledError && err.toolInvocations.length > 0 ? { toolInvocations: err.toolInvocations } : {}),
        ...(err instanceof RunCancelledError ? { tokenUsage: err.tokenUsage } : {}),
        ...(llmCitationsAtError && llmCitationsAtError.length > 0 ? { llmCitations: llmCitationsAtError } : {}),
        provider: callbackProvider,
        model: callbackModel,
      });
    } else if (err instanceof RunCancelledError || abortSignal?.aborted) {
      log(`Session cancelled: ${sessionId}`);
      await sendCallback(callbackUrl, sessionToken, {
        sessionId,
        userId,
        conversationId: conversationId ?? null,
        agentSlug: agentSlug ?? null,
        status: "cancelled",
        ...(err instanceof RunCancelledError && err.partialText
          ? { result: err.partialText }
          : {}),
        ...(err instanceof RunCancelledError && err.toolsUsed.length > 0
          ? { toolsUsed: err.toolsUsed }
          : {}),
        ...(err instanceof RunCancelledError && err.toolInvocations.length > 0
          ? { toolInvocations: err.toolInvocations }
          : {}),
        ...(err instanceof RunCancelledError
          ? { tokenUsage: err.tokenUsage }
          : {}),
        provider: callbackProvider,
        model: callbackModel,
      });
    } else if (isTransientProviderError(err)) {
      // Terminal transient failure — every provider (incl. the spaces fallback)
      // was unreachable/stalled. claw-auth only posts thread messages for
      // status="completed" with a non-empty result (status="failed" is silent),
      // so deliver a short user-visible notice instead of dropping the request
      // with no reply. This is the release-announcer silent-drop guard.
      logErr(
        `Session failed (transient — all providers unavailable): ${err instanceof Error ? err.message : String(err)}`,
      );
      await sendCallback(callbackUrl, sessionToken, {
        sessionId,
        userId,
        conversationId: conversationId ?? null,
        agentSlug: agentSlug ?? null,
        status: "completed",
        result:
          "⚠️ The model provider was temporarily unavailable and your request couldn't be completed. Please try again in a moment.",
        provider: callbackProvider,
        model: callbackModel,
      });
    } else {
      logErr(
        `Session failed: ${err instanceof Error ? err.message : String(err)}`,
      );

      await sendCallback(callbackUrl, sessionToken, {
        sessionId,
        userId,
        conversationId: conversationId ?? null,
        agentSlug: agentSlug ?? null,
        status: "failed",
        error: err instanceof Error ? err.message : "Internal error",
        provider: callbackProvider,
        model: callbackModel,
      });
    }
  } finally {
    if (mcpCleanup) {
      await mcpCleanup().catch(() => {});
    }
    if (!requestCwd) {
      // Clean up ephemeral workspace. (Host-side git worktrees no longer
      // exist — repo work happens in the sandbox.)
      await deleteWorkspace(sessionId).catch(() => {});
    }
  }
}

function coerceAutomationResult(text: string): Record<string, unknown> {
  return { result: text };
}

async function sendCallback(
  callbackUrl: ProgressDest,
  sessionToken: string,
  payload: Record<string, unknown>,
): Promise<void> {
  // SSE mode: the final result is a `done` frame on the in-process emitter, not a POST.
  // The route handler closes the response after this returns.
  if (callbackUrl && typeof callbackUrl !== "string") {
    const sidSse = (payload["sessionId"] as string | undefined) ?? "?";
    try {
      await callbackUrl.done(sidSse, payload);
    } catch (err) {
      clog.error(`[run] In-process done emit failed (session=${sidSse}): ${err instanceof Error ? err.message : String(err)}`);
    }
    return;
  }
  const url =
    callbackUrl ??
    `${SERVER.authServiceUrl}/claw/api/v1/sessions/${payload["sessionId"] as string}/result`;
  const sid = (payload["sessionId"] as string | undefined) ?? "?";
  // SSRF guard: callbackUrl is caller-supplied. Only post to the trusted
  // claw-auth origin; a non-allowlisted target (e.g. cloud metadata) is dropped.
  if (!isAllowedCallbackUrl(url)) {
    clog.error(
      `[run] Refusing callback to non-allowlisted URL (session=${sid}): ${url}`,
    );
    return;
  }
  const body = JSON.stringify(payload);
  // Up to 3 attempts on transient failures (network throw OR 5xx OR 408/429).
  // We never retry 4xx other than 408/429 — those are caller-shape errors and
  // re-sending won't help. Each attempt is logged so a silent drop becomes
  // impossible. Backoff: 1s, 3s.
  const BACKOFFS_MS = [1000, 3000];
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(SERVER.s2sKey ? { "x-s2s-key": SERVER.s2sKey } : {}),
          // Per-run proof bound to {sid, uid} so claw-auth can verify this
          // result actually belongs to this run, not just that it came from a
          // holder of the shared S2S key. Verified at the /result endpoints.
          ...(sessionToken ? { "x-session-token": sessionToken } : {}),
        },
        body,
      });
      if (res.ok) {
        if (attempt > 1) {
          clog.info(
            `[run] Callback to ${url} succeeded on attempt ${attempt} (session=${sid})`,
          );
        }
        return;
      }
      // Non-2xx: read a snippet of the body so the failure mode is visible.
      const text = await res.text().catch(() => "");
      const retryable =
        res.status >= 500 || res.status === 408 || res.status === 429;
      clog.error(
        `[run] Callback ${res.status} from ${url} (session=${sid}, attempt=${attempt}, bytes=${body.length}, retryable=${retryable}): ${text.slice(0, 300)}`,
      );
      if (!retryable || attempt === 3) return;
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastErr = err;
      clog.error(
        `[run] Callback to ${url} threw (session=${sid}, attempt=${attempt}, bytes=${body.length}): ${err instanceof Error ? err.message : String(err)}`,
      );
      if (attempt === 3) return;
    }
    const wait = BACKOFFS_MS[attempt - 1] ?? 3000;
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
  if (lastErr) {
    clog.error(
      `[run] Callback exhausted retries to ${url} (session=${sid}): ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
    );
  }
}

// ── Chain judge endpoint (called by xyne-claw-auth webhook) ──────────────

router.post("/chain-judge", validateS2SKey, async (req, res: Response) => {
  const {
    agentResult,
    sourceAgent,
    targetAgent,
    taskTemplate,
    userQuery,
    judgeContext,
  } = req.body as {
    agentResult?: string;
    sourceAgent?: string;
    targetAgent?: string;
    taskTemplate?: string;
    userQuery?: string;
    judgeContext?: string;
  };

  if (!agentResult || !sourceAgent || !targetAgent) {
    res
      .status(400)
      .json({
        success: false,
        error: "agentResult, sourceAgent, targetAgent required",
      });
    return;
  }

  const decision = await judgeChainContinuation(
    agentResult,
    sourceAgent,
    targetAgent,
    taskTemplate,
    userQuery,
    judgeContext,
  );
  res.json({ success: true, data: decision });
});

// ── Generate agent prompt (called by xyne-claw-auth) ──────────────────────

router.post("/generate-prompt", validateS2SKey, async (req, res: Response) => {
  const { intent, agentName, existingPrompt } = req.body as {
    intent?: string;
    agentName?: string;
    existingPrompt?: string;
  };

  if (!intent || typeof intent !== "string") {
    res.status(400).json({ success: false, error: "intent is required" });
    return;
  }

  const isUpdate =
    existingPrompt &&
    typeof existingPrompt === "string" &&
    existingPrompt.trim().length > 0;

  const userMessage = isUpdate
    ? `Here is the current system prompt for an agent${agentName ? ` called "${agentName}"` : ""}:\n\n---\n${existingPrompt}\n---\n\nThe user wants to update it with the following instructions:\n\n"${intent}"\n\nApply the requested changes to the existing prompt. Keep the parts that are not affected by the update. Return the full updated prompt.`
    : `Generate a system prompt for an agent${agentName ? ` called "${agentName}"` : ""}. The user described it as:\n\n"${intent}"\n\nThe prompt should:\n- Define the agent's role and personality\n- List what the agent can and cannot do\n- Include guidelines for response style\n- Be concise but thorough (200-400 words)`;

  try {
    const llmRes = await fetch(`${LITELLM.url}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LITELLM.apiKey}`,
      },
      body: JSON.stringify({
        model: LITELLM.model,
        messages: [
          {
            role: "system",
            content:
              "You generate and update system prompts for AI agents. Return ONLY the system prompt text, no explanation or markdown wrapping.",
          },
          {
            role: "user",
            content: userMessage,
          },
        ],
        max_tokens: 2000,
        temperature: 0.7,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!llmRes.ok) {
      res
        .status(500)
        .json({ success: false, error: `LLM returned ${llmRes.status}` });
      return;
    }

    const data = (await llmRes.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const prompt = data.choices?.[0]?.message?.content?.trim() ?? "";

    res.json({ success: true, data: { prompt } });
  } catch (err) {
    clog.error("[generate-prompt] Failed:", err);
    res
      .status(500)
      .json({ success: false, error: "Failed to generate prompt" });
  }
});

// ── Generate structured-output schema + template from a plain-text
//    description (called by xyne-claw-auth's dashboard proxy) ──────────────
//
// The user describes the output they want in normal language ("a report with
// 5 KPIs, trend arrows and a 2-line summary"); the LLM produces the JSON
// Schema for submit-result plus the matching {{placeholder}} markdown
// template. Forced tool call so the response is structured; the schema is
// parsed + sanity-checked server-side before returning, and template
// placeholders are cross-checked against the schema's top-level properties.

const OUTPUT_FORMAT_GENERATOR_SYSTEM = `
You design structured-output contracts for AI agents on this platform.

The platform mechanism: the agent's final answer is forced through a tool
whose input schema IS the JSON Schema you produce. A markdown template then
renders that JSON into the chat message. So: the schema captures the DATA
FIELDS, the template owns ALL layout, labels and punctuation.

Template language (STRICT — nothing else is supported):
- {{path.to.field}} substitutes a value (dot paths allowed)
- {{#each listField}}...{{/each}} iterates an array; inside, {{.}} is a
  scalar item and {{field}} resolves against the item object
- NO conditionals, NO else, NO formatting filters. For optional fragments,
  add a string field that holds the full fragment ("" when absent) and place
  it directly in the template.

Design rules (follow ALL):
1. Prefer "type":"string" for metric values so "n/a" stays representable —
   never force a fake 0 for missing data. Say so in the description.
2. Pre-format display strings in the schema fields (e.g. trend glyphs like
   "up 12%"), so the template stays a dumb substitution.
3. Every {{placeholder}} in the template MUST correspond to a schema field;
   every required schema field SHOULD appear in the template.
4. Keep descriptions one line each — they are instructions to the agent.
5. Mark all fields required unless genuinely optional.
6. No triple backticks anywhere in the template.
`.trim();

const EMIT_OUTPUT_FORMAT_TOOL = {
  type: "function" as const,
  function: {
    name: "emit_output_format",
    description: "Return the generated structured-output contract.",
    parameters: {
      type: "object",
      properties: {
        schema_json: {
          type: "string",
          description:
            "The JSON Schema as a JSON-encoded string. Top level must be an object schema.",
        },
        template: {
          type: "string",
          description:
            "The markdown render template using {{placeholders}}. Empty string when only a markdown outline was requested.",
        },
        notes: {
          type: "string",
          description:
            "1-3 short lines explaining non-obvious design choices, for display under the form.",
        },
      },
      required: ["schema_json", "template", "notes"],
    },
  },
};

/**
 * Top-level {{path}} placeholders that must exist as schema properties.
 * Placeholders INSIDE {{#each x}}…{{/each}} resolve against the array item,
 * not the root object, so they're excluded from the cross-check — only the
 * `each` target itself (x) is a root property. (Mirrors renderTemplate's scope
 * rules in agent-model-settings.ts.)
 */
function templatePlaceholders(template: string): string[] {
  const out = new Set<string>();
  // The `each` targets are root properties.
  for (const m of template.matchAll(/\{\{#each\s+([\w.]+)\s*\}\}/g)) {
    out.add(m[1]!.split(".")[0]!);
  }
  // Strip each-block bodies, then collect the remaining (root-scoped) refs.
  const rootScope = template.replace(
    /\{\{#each\s+[\w.]+\s*\}\}[\s\S]*?\{\{\/each\}\}/g,
    "",
  );
  for (const m of rootScope.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)) {
    const p = m[1];
    if (p && p !== ".") out.add(p.split(".")[0]!);
  }
  return [...out];
}

router.post(
  "/generate-output-format",
  validateS2SKey,
  async (req, res: Response) => {
    const { description, format, existingSchema, existingTemplate, agentName } =
      req.body as {
        description?: string;
        format?: "json" | "markdown";
        existingSchema?: string;
        existingTemplate?: string;
        agentName?: string;
      };

    if (
      !description ||
      typeof description !== "string" ||
      !description.trim()
    ) {
      res
        .status(400)
        .json({ success: false, error: "description is required" });
      return;
    }
    const wantMarkdownOnly = format === "markdown";

    const refining = Boolean(
      (existingSchema && existingSchema.trim()) ||
      (existingTemplate && existingTemplate.trim()),
    );
    const userMessage = [
      wantMarkdownOnly
        ? `Generate ONLY a markdown outline (no schema — set schema_json to "{}") that the agent${agentName ? ` "${agentName}"` : ""} will follow for its final answer.`
        : `Generate the JSON Schema + markdown template pair for the agent${agentName ? ` "${agentName}"` : ""}'s final answer.`,
      "",
      `The user describes the desired output as:`,
      `"${description.trim()}"`,
      ...(refining
        ? [
            "",
            "They already have a draft — apply the description as a refinement, keeping what still fits:",
            ...(existingSchema?.trim()
              ? ["Current schema:", existingSchema.trim()]
              : []),
            ...(existingTemplate?.trim()
              ? ["Current template:", existingTemplate.trim()]
              : []),
          ]
        : []),
    ].join("\n");

    try {
      const llmRes = await fetchLiteLLMWithRetry(
        `${LITELLM.url}/v1/chat/completions`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${LITELLM.apiKey}`,
          },
          body: JSON.stringify({
            model: LITELLM.model,
            messages: [
              { role: "system", content: OUTPUT_FORMAT_GENERATOR_SYSTEM },
              { role: "user", content: userMessage },
            ],
            tools: [EMIT_OUTPUT_FORMAT_TOOL],
            tool_choice: {
              type: "function",
              function: { name: "emit_output_format" },
            },
            max_tokens: 4000,
            temperature: 0.2,
          }),
        },
        { timeoutMs: 45_000, label: "generate-output-format" },
      );

      if (!llmRes.ok) {
        res
          .status(500)
          .json({ success: false, error: `LLM returned ${llmRes.status}` });
        return;
      }
      const data = (await llmRes.json()) as {
        choices?: Array<{
          message?: {
            tool_calls?: Array<{ function?: { arguments?: string } }>;
          };
        }>;
      };
      const argsRaw =
        data.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
      if (!argsRaw) {
        res
          .status(500)
          .json({ success: false, error: "LLM returned no tool call" });
        return;
      }
      const args = JSON.parse(argsRaw) as {
        schema_json?: string;
        template?: string;
        notes?: string;
      };
      const template = (args.template ?? "").trim();
      const notes = (args.notes ?? "").trim();

      // Server-side sanity checks — catch generator mistakes before the user
      // pastes a broken contract into the agent config.
      const warnings: string[] = [];
      let schemaOut = "";
      if (!wantMarkdownOnly) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(args.schema_json ?? "");
        } catch {
          res
            .status(422)
            .json({
              success: false,
              error:
                "Generator produced an invalid JSON schema — try rephrasing the description",
            });
          return;
        }
        if (
          !parsed ||
          typeof parsed !== "object" ||
          Array.isArray(parsed) ||
          (parsed as Record<string, unknown>)["type"] !== "object"
        ) {
          res
            .status(422)
            .json({
              success: false,
              error:
                "Generated schema is not an object-typed JSON Schema — try rephrasing",
            });
          return;
        }
        schemaOut = JSON.stringify(parsed, null, 2);
        const props =
          (parsed as { properties?: Record<string, unknown> }).properties ?? {};
        for (const ph of templatePlaceholders(template)) {
          if (!(ph in props))
            warnings.push(
              `Template references {{${ph}}} which is not a top-level schema property`,
            );
        }
      }
      if (/```/.test(template))
        warnings.push(
          "Template contains triple backticks — remove them before saving",
        );

      res.json({
        success: true,
        data: { schema: schemaOut, template, notes, warnings },
      });
    } catch (err) {
      clog.error("[generate-output-format] Failed:", err);
      res
        .status(500)
        .json({ success: false, error: "Failed to generate output format" });
    }
  },
);

// ── Suggest tools for an agent (called by xyne-claw-auth) ────────────────
// Given the agent's intent (a short description or full system prompt) and a
// catalog of available tools, ask the LLM to pick a small, sensible default
// set. The endpoint is intentionally side-effect-free: it just returns a
// proposal and the UI renders it as a diff for the user to accept.

router.post("/suggest-tools", validateS2SKey, async (req, res: Response) => {
  const { intent, catalog } = req.body as {
    intent?: string;
    catalog?: {
      subagents: Array<{ name: string; description: string }>;
      integrations: Array<{
        slug: string;
        label: string;
        readTools: Array<{
          name: string;
          description: string;
          riskLevel: string;
        }>;
        writeTools: Array<{
          name: string;
          description: string;
          riskLevel: string;
        }>;
      }>;
    };
  };

  if (!intent || typeof intent !== "string" || intent.trim().length === 0) {
    res.status(400).json({ success: false, error: "intent is required" });
    return;
  }
  if (!catalog || typeof catalog !== "object") {
    res.status(400).json({ success: false, error: "catalog is required" });
    return;
  }

  // Compress the catalog into a token-cheap form. Tool descriptions are
  // truncated; an LLM doesn't need 500 chars per tool to recognise intent.
  const truncate = (s: string, n: number) => {
    const trimmed = (s ?? "").trim();
    return trimmed.length <= n ? trimmed : trimmed.slice(0, n - 1) + "…";
  };

  const subagentList = (catalog.subagents ?? [])
    .map((s) => `- ${s.name}: ${truncate(s.description, 120)}`)
    .join("\n");

  const integrationBlocks = (catalog.integrations ?? [])
    .map((i) => {
      const readLines = i.readTools
        .map(
          (t) =>
            `    - ${t.name}${t.description ? ": " + truncate(t.description, 100) : ""}`,
        )
        .join("\n");
      const writeLines = i.writeTools
        .map(
          (t) =>
            `    - ${t.name} [${t.riskLevel}]${t.description ? ": " + truncate(t.description, 100) : ""}`,
        )
        .join("\n");
      return [
        `## ${i.label} (slug: ${i.slug})`,
        readLines ? `  read tools:\n${readLines}` : "",
        writeLines ? `  write tools:\n${writeLines}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");

  const userMessage = [
    "Select an appropriate, minimal set of tools for this agent based on its purpose.",
    "",
    "Agent intent / system prompt:",
    "---",
    intent,
    "---",
    "",
    "Available subagents (specialists this agent can delegate to):",
    subagentList || "(none)",
    "",
    "Available integrations and their tools:",
    integrationBlocks || "(none)",
    "",
    "Rules:",
    "- Be conservative. Prefer read-only tools. Only include write/destructive tools when the intent clearly demands them.",
    "- Prefer subagents (delegation) over a long list of raw integration tools when a matching specialist exists.",
    "- Aim for under 15 individual tools across all integrations unless intent demands more.",
    "- For each pick, give a one-sentence reason citing what in the intent justifies it.",
    "",
    "Return a strict JSON object matching this shape (no prose, no markdown wrapping):",
    `{
  "subagents": ["subagent-name", ...],
  "integrations": [
    { "slug": "integration-slug", "readTools": ["tool_name", ...], "writeTools": ["tool_name", ...] },
    ...
  ],
  "reasoning": { "subagent-or-tool-name": "one-sentence why", ... }
}`,
  ].join("\n");

  try {
    const llmRes = await fetch(`${LITELLM.url}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LITELLM.apiKey}`,
      },
      body: JSON.stringify({
        model: LITELLM.model,
        messages: [
          {
            role: "system",
            content:
              "You select tools for AI agents. You return ONLY a JSON object — no prose, no markdown fences. Be conservative and prefer read-only tools.",
          },
          { role: "user", content: userMessage },
        ],
        // Response is a small JSON object; cap is mainly a safety bound.
        max_tokens: 2000,
        temperature: 0.2,
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.timeout(45_000),
    });

    if (!llmRes.ok) {
      res
        .status(500)
        .json({ success: false, error: `LLM returned ${llmRes.status}` });
      return;
    }

    const data = (await llmRes.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = data.choices?.[0]?.message?.content?.trim() ?? "";
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      res.status(502).json({ success: false, error: "LLM returned non-JSON" });
      return;
    }

    res.json({ success: true, data: parsed });
  } catch (err) {
    clog.error("[suggest-tools] Failed:", err);
    res.status(500).json({ success: false, error: "Failed to suggest tools" });
  }
});

export { router as runRouter };
