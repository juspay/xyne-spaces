/**
 * Claw agent runs triggered from inside an artifact app.
 *
 * An app is a React project running in a bundler-origin iframe with no cookies
 * and no network. It cannot call an agent itself; it asks the dashboard, which
 * calls this router as the viewer. Three properties are load-bearing:
 *
 *  - **The run is DETACHED.** We dispatch with `detached: true` and return the
 *    ids immediately. Nothing holds a connection open, so closing the app,
 *    switching threads or reloading the tab cannot kill a run that takes the
 *    usual 200-420s. This is the same dispatch scheduled jobs and Slack use.
 *
 *  - **Persistence is INHERITED, not reimplemented.** `callbackUrl` and
 *    `progressUrl` point at agent-chat's own internal handlers, so an app run
 *    gets the identical machinery a chat turn gets: answer-so-far persisted on a
 *    ~1s debounce, tool invocations merged under an advisory lock, the terminal
 *    write guarded by a Redis SETNX, and every event republished on the live
 *    bus. Those handlers already read `assistantMessageId` from the query string
 *    because a callback may land on a pod that never held the SSE — a dispatch
 *    with no SSE consumer at all is just the limiting case of that.
 *
 *  - **Resync needs no client state.** The conversation id is a pure function of
 *    (app, viewer, runKey), so a reopened app finds work it started an hour ago
 *    by asking for that key, and attaches to the existing /live stream.
 *
 * The agent ACL here is deliberately STRICTER than `/run` and `/agent-chat`,
 * which check only org + enabled. App code is model-authored and publishable, so
 * an unvalidated slug from it is not comparable to a human typing one. We use
 * the same predicate agent-to-agent delegation uses — a callee cannot be invoked
 * unless the running user could invoke it directly.
 */

import { Router, type Request, type Response } from "express";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { prisma } from "../db.js";
import { CONFIG } from "../config.js";
import { redisService } from "../redis.js";
import { getRequesterId, getOrgId, isClawAdmin } from "../middleware/agent-acl.js";
import { getWorkspaceIdForUser } from "../lib/spaces-db.js";
import { visibleAgentWhereForRunningUser } from "../lib/callable-agent-resolver.js";
import { resolveAgentProviderConfigs } from "../lib/agent-provider-config.js";
import { resolveFastMode } from "../lib/fast-mode.js";
import { agentRunRepository, chatMessageRepository, chatAttachmentRepository } from "../repositories/index.js";
import { createLogger } from "../logger.js";

const log = createLogger("artifact-app-agents");
export const artifactAppAgentsRouter: Router = Router();

const VISIBILITY_WORKSPACE = "WORKSPACE";

const MAX_PROMPT_CHARS = 8000;
const RUN_KEY_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** Runs a viewer may start per hour, across every app. Cost guard, not a
 *  permission: a run costs ~3 orders of magnitude more than a write. */
const RUNS_PER_HOUR = 30;
const RATE_WINDOW_SECONDS = 3600;

/** Statuses that mean "this key is busy". A second run on a busy key is refused
 *  rather than queued — it would otherwise race the first into the runtime's
 *  session lock. */
const ACTIVE_STATUSES = ["pending", "running"];

/** How long a run may sit with no session id before we call the dispatch dead. */
const STALE_DISPATCH_MS = 2 * 60 * 1000;

/**
 * How long a run may claim to be "running" before we stop believing it.
 *
 * A run's terminal status arrives on a callback. If that callback never lands —
 * pod restart mid-run, a crash, a dropped request — the row stays "running"
 * forever and, without this, its key would be permanently unusable with no way
 * out but a manual DB edit. Reuses the horizon the run-recovery worker already
 * treats a run as lost at, so the two agree.
 */
const STUCK_RUN_MS = CONFIG.runRecoveryTimeoutMs;

/**
 * Conversation id for a run. Stable per (app, viewer, key) so repeat runs
 * continue ONE thread and /live + /messages both attach to it.
 *
 * The `app_` prefix is load-bearing twice over: the runtime keys its recursion
 * guard off it, and `GET /agent-chat/:slug/conversations` filters it out so app
 * threads never surface in the user's chat history. The user id is hashed
 * because this string is not private — it reaches the browser and the claw log.
 */
function conversationIdFor(ownerKey: string, userId: string, runKey: string): string {
  const who = createHash("sha256").update(userId).digest("hex").slice(0, 12);
  return `app_${ownerKey}_${who}_${runKey}`;
}

const runBody = z.object({
  appId: z.string().min(1).optional(),
  attachmentId: z.string().min(1).optional(),
  prompt: z.string().trim().min(1).max(MAX_PROMPT_CHARS),
  agentSlug: z.string().trim().min(1).optional(),
  key: z.string().trim().regex(RUN_KEY_RE).optional(),
});

function badRequest(res: Response, parsed: z.ZodSafeParseError<unknown>): void {
  res.status(400).json({ success: false, error: "ValidationError", details: parsed.error.flatten() });
}

/**
 * Rate limit keyed on the VIEWER, not the app or the IP: the cost lands on
 * whoever's identity the run executes under, and one person hopping between apps
 * is the same spend as one app in a loop. Mirrors routes/cli-auth.ts.
 */
async function overQuota(userId: string): Promise<boolean> {
  try {
    const redis = redisService.getConnection();
    const key = `artifact-app-agents:rate:${userId}`;
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, RATE_WINDOW_SECONDS);
    return count > RUNS_PER_HOUR;
  } catch (err) {
    // Redis down must not take the feature down; the other limits still hold.
    log.warn(`rate limit check failed for ${userId}: ${String(err)}`);
    return false;
  }
}

interface AppContext {
  /** Identifies the app in the conversation id and in run attribution. */
  ownerKey: string;
  appId: string | null;
  attachmentId: string | null;
  workspaceId: string;
  /** Agents the app itself declared. Empty = the app expressed no preference. */
  declaredAgents: string[];
}

function declaredAgentsFrom(manifest: unknown): string[] {
  const agents = (manifest as { agents?: unknown } | null)?.agents;
  if (!Array.isArray(agents)) return [];
  return agents.filter((a): a is string => typeof a === "string" && a.trim().length > 0);
}

/**
 * Resolve the app the caller is asking about, enforcing the SAME read rule as
 * `GET /artifact-apps/:id/payload`: the owner, or anyone in the workspace once
 * published. A non-owner is matched against the PINNED version, so a viewer
 * cannot reach agents declared only in an unpublished draft.
 *
 * An unsaved chat artifact is addressed by its attachment instead, which only
 * its uploader can read.
 */
async function resolveAppContext(
  input: { appId?: string | undefined; attachmentId?: string | undefined },
  requesterId: string,
): Promise<{ ok: true; ctx: AppContext } | { ok: false; status: number; error: string }> {
  if (input.appId) {
    const app = await prisma.artifactApp.findUnique({ where: { id: input.appId } });
    if (!app || app.isArchived) return { ok: false, status: 404, error: "App not found" };

    const isOwner = app.ownerUserId === requesterId;
    if (!isOwner) {
      const workspaceId = await getWorkspaceIdForUser(requesterId, "artifact-app-agents");
      const sameWorkspace = workspaceId !== null && workspaceId === app.workspaceId;
      if (!sameWorkspace || app.visibility !== VISIBILITY_WORKSPACE) {
        return { ok: false, status: 403, error: "Forbidden" };
      }
    }

    const version = isOwner
      ? await prisma.artifactAppVersion.findFirst({
          where: { appId: app.id },
          orderBy: { versionNumber: "desc" },
          select: { manifest: true },
        })
      : app.publishedVersionId
        ? await prisma.artifactAppVersion.findUnique({
            where: { id: app.publishedVersionId },
            select: { manifest: true },
          })
        : null;

    return {
      ok: true,
      ctx: {
        ownerKey: app.id,
        appId: app.id,
        attachmentId: null,
        workspaceId: app.workspaceId,
        declaredAgents: declaredAgentsFrom(version?.manifest ?? null),
      },
    };
  }

  if (input.attachmentId) {
    const att = await chatAttachmentRepository.findById(input.attachmentId);
    if (!att) return { ok: false, status: 404, error: "Artifact not found" };
    if (att.uploaderUserId !== requesterId) return { ok: false, status: 403, error: "Forbidden" };

    const workspaceId = await getWorkspaceIdForUser(requesterId, "artifact-app-agents");
    if (!workspaceId) return { ok: false, status: 409, error: "No Spaces workspace for this user" };

    const manifest = (att.metadata as { reactArtifact?: unknown } | null)?.reactArtifact ?? null;
    return {
      ok: true,
      ctx: {
        ownerKey: att.id,
        appId: null,
        attachmentId: att.id,
        workspaceId,
        declaredAgents: declaredAgentsFrom(manifest),
      },
    };
  }

  return { ok: false, status: 400, error: "appId or attachmentId is required" };
}

/**
 * Agents this viewer may drive from this app.
 *
 * Two independent narrowings, in this order:
 *   1. What the VIEWER can reach — the delegation predicate, never the app's word.
 *   2. What the APP asked for — a hint only. It can never widen (1).
 * A declared agent the viewer cannot reach simply is not in the result, so a
 * published app pinned to the author's personal agent degrades to "no agents
 * available" rather than to an authorization error deep in dispatch.
 */
async function listReachableAgents(
  userId: string,
  orgId: string,
  declaredAgents: string[],
): Promise<Array<{ slug: string; name: string; description: string; color: string }>> {
  const isAdmin = await isClawAdmin(userId);
  const agents = await prisma.agent.findMany({
    where: {
      AND: [
        { orgId },
        { enabled: true },
        visibleAgentWhereForRunningUser(userId, isAdmin),
        ...(declaredAgents.length > 0 ? [{ slug: { in: declaredAgents } }] : []),
      ],
    },
    select: { slug: true, name: true, description: true, color: true },
    orderBy: { name: "asc" },
  });
  return agents;
}

/** GET /agents?appId=|attachmentId= — the agent picker's source of truth. */
artifactAppAgentsRouter.get("/agents", async (req: Request, res: Response): Promise<void> => {
  const requesterId = getRequesterId(req);
  const orgId = getOrgId(req);
  if (!requesterId || !orgId) {
    res.status(401).json({ success: false, error: "Unauthorized" });
    return;
  }

  const resolved = await resolveAppContext(
    {
      appId: typeof req.query["appId"] === "string" ? req.query["appId"] : undefined,
      attachmentId: typeof req.query["attachmentId"] === "string" ? req.query["attachmentId"] : undefined,
    },
    requesterId,
  );
  if (!resolved.ok) {
    res.status(resolved.status).json({ success: false, error: resolved.error });
    return;
  }

  const agents = await listReachableAgents(requesterId, orgId, resolved.ctx.declaredAgents);
  res.json({ success: true, agents, declared: resolved.ctx.declaredAgents });
});

/** POST /runs — dispatch a detached run and return its ids immediately. */
artifactAppAgentsRouter.post("/runs", async (req: Request, res: Response): Promise<void> => {
  const requesterId = getRequesterId(req);
  const orgId = getOrgId(req);
  if (!requesterId || !orgId) {
    res.status(401).json({ success: false, error: "Unauthorized" });
    return;
  }

  const parsed = runBody.safeParse(req.body);
  if (!parsed.success) return badRequest(res, parsed);
  const { prompt, agentSlug: requestedSlug } = parsed.data;
  const runKey = parsed.data.key ?? "default";

  const resolved = await resolveAppContext(parsed.data, requesterId);
  if (!resolved.ok) {
    res.status(resolved.status).json({ success: false, error: resolved.error });
    return;
  }
  const ctx = resolved.ctx;

  // Agent choice: what the caller asked for, else what the app declared first,
  // else the viewer's first reachable agent. Every branch goes through the same
  // reachability list, so none of them can widen access.
  const reachable = await listReachableAgents(requesterId, orgId, ctx.declaredAgents);
  if (reachable.length === 0) {
    res.status(403).json({
      success: false,
      error: ctx.declaredAgents.length
        ? "This app uses an agent you do not have access to."
        : "You do not have access to any agents.",
    });
    return;
  }
  const chosen = requestedSlug ? reachable.find((a) => a.slug === requestedSlug) : reachable[0];
  if (!chosen) {
    res.status(403).json({ success: false, error: `You do not have access to the agent "${requestedSlug}".` });
    return;
  }

  const conversationId = conversationIdFor(ctx.ownerKey, requesterId, runKey);

  // One in-flight run per key. Checked before the quota is spent so a user
  // hammering a busy key does not burn their hourly allowance on refusals.
  if (await hasActiveRun(conversationId, requesterId)) {
    // Actionable, because the alternative is a dead end: the caller can always
    // cancel the in-flight run and start again.
    res.status(409).json({
      success: false,
      error: "This app is already running an agent. Wait for it to finish, or cancel it and try again.",
      code: "run_in_progress",
    });
    return;
  }

  if (await overQuota(requesterId)) {
    res.status(429).json({ success: false, error: "You have started too many agent runs recently. Try again later." });
    return;
  }

  const agentRow = await prisma.agent.findUnique({
    where: { orgId_slug: { orgId, slug: chosen.slug } },
    select: { id: true, config: true, orgId: true },
  });
  if (!agentRow) {
    res.status(404).json({ success: false, error: "Agent not found" });
    return;
  }

  const row = await prisma.artifactAppAgentRun.create({
    data: {
      workspaceId: ctx.workspaceId,
      orgId,
      ...(ctx.appId ? { appId: ctx.appId } : {}),
      ...(ctx.attachmentId ? { attachmentId: ctx.attachmentId } : {}),
      userId: requesterId,
      runKey,
      conversationId,
      agentSlug: chosen.slug,
      prompt,
      status: "pending",
    },
  });

  try {
    const dispatched = await dispatchRun({
      row,
      agentRow,
      userId: requesterId,
      prompt,
      conversationId,
      agentSlug: chosen.slug,
      artifactAppId: ctx.appId ?? ctx.attachmentId ?? "",
      runKey,
    });

    res.status(202).json({
      success: true,
      run: {
        id: row.id,
        sessionId: dispatched.sessionId,
        conversationId,
        agentSlug: chosen.slug,
        runKey,
        status: "running",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.artifactAppAgentRun
      .update({ where: { id: row.id }, data: { status: "failed", error: message } })
      .catch(() => undefined);
    log.error(`dispatch failed appRun=${row.id}: ${message}`);
    res.status(502).json({ success: false, error: "Could not start the agent." });
  }
});

async function releaseStuck(id: string, error: string): Promise<void> {
  await prisma.artifactAppAgentRun
    .update({ where: { id }, data: { status: "failed", error } })
    .catch(() => undefined);
}

/**
 * Is a run for this key genuinely still going?
 *
 * Our own `status` column is written at dispatch and never again: the run's
 * terminal state is recorded on `AgentRun` by agent-chat's callback, which knows
 * nothing about this table. Trusting our column alone therefore locks a key
 * forever after its first run.
 *
 * `AgentRun` is the source of truth, exactly as it is for the read path, so this
 * resolves against it and writes the settled status back — the row converges
 * instead of drifting further every run.
 */
async function hasActiveRun(conversationId: string, userId: string): Promise<boolean> {
  const candidates = await prisma.artifactAppAgentRun.findMany({
    where: { conversationId, userId, status: { in: ACTIVE_STATUSES } },
    select: { id: true, sessionId: true, createdAt: true },
  });
  if (candidates.length === 0) return false;

  const sessionIds = candidates.map((c) => c.sessionId).filter((s): s is string => Boolean(s));
  const runs = sessionIds.length
    ? await prisma.agentRun.findMany({
        where: { sessionId: { in: sessionIds } },
        select: { sessionId: true, status: true },
      })
    : [];
  const statusBySession = new Map(runs.map((r) => [r.sessionId, r.status]));

  let active = false;
  for (const candidate of candidates) {
    const settled = candidate.sessionId ? statusBySession.get(candidate.sessionId) : undefined;
    const ageMs = Date.now() - candidate.createdAt.getTime();

    if (settled && !ACTIVE_STATUSES.includes(settled)) {
      await prisma.artifactAppAgentRun
        .update({ where: { id: candidate.id }, data: { status: settled } })
        .catch(() => undefined);
      continue;
    }

    // No session id: dispatch died between our insert and claw accepting it.
    if (!candidate.sessionId && ageMs > STALE_DISPATCH_MS) {
      await releaseStuck(candidate.id, "Dispatch did not complete.");
      continue;
    }

    // Dispatched, but still claiming to run long past the point a run can be
    // alive — or with no AgentRun row at all, which means even `start` was lost.
    // Either way the callback is not coming, so free the key.
    if (candidate.sessionId && ageMs > STUCK_RUN_MS) {
      await releaseStuck(candidate.id, "The agent run stopped responding.");
      log.warn(`released stuck app run ${candidate.id} (session=${candidate.sessionId}, age=${Math.round(ageMs / 1000)}s)`);
      continue;
    }

    active = true;
  }
  return active;
}

/**
 * Fire the run at xyne-claw.
 *
 * Mirrors queue/scheduled-jobs-worker.ts, which is the reference implementation
 * for a detached run that carries the agent's own config and provider. The three
 * deliberate differences are noted inline.
 */
async function dispatchRun(input: {
  row: { id: string };
  agentRow: { id: string; config: unknown; orgId: string };
  userId: string;
  prompt: string;
  conversationId: string;
  agentSlug: string;
  artifactAppId: string;
  runKey: string;
}): Promise<{ sessionId: string }> {
  const { providerConfigs, providerOrder, parent: providerParent } = await resolveAgentProviderConfigs(
    input.agentRow,
    { headlessBulk: true },
  );
  const fastModeEnabled = await resolveFastMode(input.conversationId, input.agentSlug, input.agentRow.config);

  // Pre-create the two rows a chat turn creates, because we reuse agent-chat's
  // callback: the placeholder's id is what the callback finalizes, and its
  // "running" state is what /live replays as `partial` to a mid-run joiner.
  await chatMessageRepository.create({
    conversationId: input.conversationId,
    agentSlug: input.agentSlug,
    userId: input.userId,
    role: "user",
    content: input.prompt,
    status: "completed",
    orgId: input.agentRow.orgId,
  });
  const assistantMsg = await chatMessageRepository.create({
    conversationId: input.conversationId,
    agentSlug: input.agentSlug,
    userId: input.userId,
    role: "assistant",
    content: "",
    status: "running",
    orgId: input.agentRow.orgId,
  });

  const callbackId = randomUUID();
  const base = `${CONFIG.internalUrl}/claw/api/v1/internal/agent-chat/${encodeURIComponent(input.agentSlug)}/chat/${encodeURIComponent(input.conversationId)}`;
  const query = `callbackId=${callbackId}&assistantMessageId=${assistantMsg.id}`;

  const dispatchPayload = {
    userId: input.userId,
    task: input.prompt,
    agentSlug: input.agentSlug,
    orgId: input.agentRow.orgId,
    conversationId: input.conversationId,
    traceId: input.conversationId,
    callbackUrl: `${base}/callback?${query}`,
    progressUrl: `${base}/progress?${query}`,
    // Replaying a completed run instead of re-executing it, if the result
    // callback is ever lost. Keyed on the app-run row, which is unique per run.
    idempotencyKey: `artifact_app_${input.row.id}`.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 128),
    // (1) No connection is held. The run outlives the app, the dialog and the tab.
    detached: true,
    // (2) The recursion marker. xyne-claw strips create-app and schedule-task
    //     for these runs — an app must not be able to build another app or arm
    //     a cron. The conversationId "app_" prefix is the fallback signal.
    eventType: "artifact_app",
    // (3) We persist the ChatMessages and the AgentRun ourselves (with
    //     triggerSource "app"), so /internal/run must not also insert one and
    //     race us to the unique sessionId. Same opt-out agent-chat uses.
    __persistedByCaller: true,
    ...(input.agentRow.config ? { agentConfig: stripCreateApp(input.agentRow.config) } : {}),
    ...(providerParent ? { provider: providerParent } : {}),
    ...(Object.keys(providerConfigs).length > 0 ? { providerConfigs } : {}),
    ...(providerOrder.length > 1 ? { providerOrder } : {}),
    fastMode: fastModeEnabled,
  };

  const res = await fetch(`${CONFIG.internalUrl}/claw/api/v1/internal/run`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(CONFIG.xyneClawS2sKey ? { "x-s2s-key": CONFIG.xyneClawS2sKey } : {}),
    },
    body: JSON.stringify(dispatchPayload),
  });

  const body = (await res.json().catch(() => null)) as
    | { success?: boolean; sessionId?: string; error?: string }
    | null;
  if (!res.ok || !body?.success || !body.sessionId) {
    throw new Error(body?.error ?? `HTTP ${res.status}`);
  }

  await prisma.artifactAppAgentRun.update({
    where: { id: input.row.id },
    data: { sessionId: body.sessionId, status: "running" },
  });

  await agentRunRepository
    .start({
      sessionId: body.sessionId,
      userId: input.userId,
      agentSlug: input.agentSlug,
      orgId: input.agentRow.orgId,
      triggerSource: "app",
      task: input.prompt,
      conversationId: input.conversationId,
      // Attribution: what makes a run traceable back to the app that issued it
      // from the Agent Control Center.
      metadata: { artifactAppId: input.artifactAppId, runKey: input.runKey, appRunId: input.row.id },
      fastMode: fastModeEnabled,
    })
    .catch((e) => log.warn(`AgentRun.start failed: ${e instanceof Error ? e.message : String(e)}`));

  return { sessionId: body.sessionId };
}

/**
 * Remove create-app from the agent's selected custom tools before dispatch.
 *
 * This is the WEAKER half of the recursion guard and cannot stand alone: an
 * agent with no `tools` key gets every tool by default (see parseToolsConfig),
 * so there would be nothing here to filter. The authoritative guard is the
 * tool-name filter in xyne-claw's run.ts, keyed on eventType. This exists so the
 * agent is never even offered the tool in the common case.
 */
function stripCreateApp(config: unknown): unknown {
  const cfg = config as { tools?: { custom?: unknown } } | null;
  const custom = cfg?.tools?.custom;
  if (!Array.isArray(custom)) return config;
  return {
    ...(cfg as object),
    tools: {
      ...(cfg?.tools as object),
      custom: custom.filter((s) => s !== "create-app" && s !== "schedule-task"),
    },
  };
}

/** GET /runs?appId=|attachmentId=&key= — the resync read on app open. */
artifactAppAgentsRouter.get("/runs", async (req: Request, res: Response): Promise<void> => {
  const requesterId = getRequesterId(req);
  if (!requesterId) {
    res.status(401).json({ success: false, error: "Unauthorized" });
    return;
  }

  const appId = typeof req.query["appId"] === "string" ? req.query["appId"] : null;
  const attachmentId = typeof req.query["attachmentId"] === "string" ? req.query["attachmentId"] : null;
  const key = typeof req.query["key"] === "string" ? req.query["key"] : null;
  if (!appId && !attachmentId) {
    res.status(400).json({ success: false, error: "appId or attachmentId is required" });
    return;
  }

  // Scoped by userId, so this needs no app-level ACL: a viewer can only ever see
  // their own runs, and two people using one published app never see each other's.
  const rows = await prisma.artifactAppAgentRun.findMany({
    where: {
      userId: requesterId,
      ...(appId ? { appId } : {}),
      ...(attachmentId ? { attachmentId } : {}),
      ...(key ? { runKey: key } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  const runs = await hydrate(rows);
  res.json({ success: true, runs });
});

/** GET /runs/:id — one run, joined to its durable result. */
artifactAppAgentsRouter.get("/runs/:id", async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  const requesterId = getRequesterId(req);
  if (!requesterId) {
    res.status(401).json({ success: false, error: "Unauthorized" });
    return;
  }

  const row = await prisma.artifactAppAgentRun.findUnique({ where: { id: req.params.id } });
  if (!row || row.userId !== requesterId) {
    res.status(404).json({ success: false, error: "Run not found" });
    return;
  }

  const [run] = await hydrate([row]);
  res.json({ success: true, run });
});

/**
 * Join app-run rows to the durable answer.
 *
 * `AgentRun` is the source of truth for the result, status and tool calls; this
 * table only indexes them by app. Where the two disagree — an app row still
 * "running" whose AgentRun has completed, because the callback updates AgentRun
 * and not us — AgentRun wins.
 */
async function hydrate(
  rows: Array<{
    id: string;
    sessionId: string | null;
    conversationId: string;
    agentSlug: string;
    runKey: string;
    prompt: string;
    status: string;
    error: string | null;
    createdAt: Date;
  }>,
): Promise<unknown[]> {
  const sessionIds = rows.map((r) => r.sessionId).filter((s): s is string => Boolean(s));
  const agentRuns = sessionIds.length
    ? await prisma.agentRun.findMany({
        where: { sessionId: { in: sessionIds } },
        select: {
          sessionId: true,
          status: true,
          result: true,
          error: true,
          toolInvocations: true,
          currentToolLabel: true,
          completedAt: true,
        },
      })
    : [];
  const bySession = new Map(agentRuns.map((r) => [r.sessionId, r]));

  return rows.map((row) => {
    const run = row.sessionId ? bySession.get(row.sessionId) : undefined;
    return {
      id: row.id,
      sessionId: row.sessionId,
      conversationId: row.conversationId,
      agentSlug: row.agentSlug,
      runKey: row.runKey,
      prompt: row.prompt,
      status: run?.status ?? row.status,
      output: run?.result ?? null,
      error: run?.error ?? row.error,
      toolInvocations: run?.toolInvocations ?? null,
      currentToolLabel: run?.currentToolLabel ?? null,
      completedAt: run?.completedAt ?? null,
      createdAt: row.createdAt,
    };
  });
}

/** POST /runs/:id/cancel — stop a run the caller started. */
artifactAppAgentsRouter.post("/runs/:id/cancel", async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  const requesterId = getRequesterId(req);
  if (!requesterId) {
    res.status(401).json({ success: false, error: "Unauthorized" });
    return;
  }

  const row = await prisma.artifactAppAgentRun.findUnique({ where: { id: req.params.id } });
  if (!row || row.userId !== requesterId) {
    res.status(404).json({ success: false, error: "Run not found" });
    return;
  }
  if (!row.sessionId) {
    res.status(409).json({ success: false, error: "This run has not started yet." });
    return;
  }

  // claw authorizes the cancel itself on x-user-id === the run's user, so the
  // header is not decoration — it is the object-level check on the far side.
  const clawRes = await fetch(
    `${CONFIG.internalUrl}/claw/api/v1/internal/run/${encodeURIComponent(row.sessionId)}/cancel`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-user-id": requesterId,
        ...(CONFIG.xyneClawS2sKey ? { "x-s2s-key": CONFIG.xyneClawS2sKey } : {}),
      },
    },
  ).catch(() => null);

  const ok = Boolean(clawRes?.ok);
  await prisma.artifactAppAgentRun
    .update({ where: { id: row.id }, data: { status: ok ? "cancelled" : row.status } })
    .catch(() => undefined);

  if (!ok) {
    res.status(502).json({ success: false, error: "Could not cancel the run." });
    return;
  }
  res.json({ success: true, status: "cancelled" });
});
