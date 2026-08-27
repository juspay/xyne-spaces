import { Router, type Request, type Response } from "express";
import { errMsg } from "../lib/errors.js";
import { agentRunRepository, agentRepository } from "../repositories/index.js";
import { getRequesterId, getOrgId, getAgentEditAccess, isClawAdmin , requireRequester} from "../middleware/agent-acl.js";
import { requireS2S } from "../middleware/require-auth.js";
import { renderClaudeCodeJsonl, renderMarkdown, renderClaudeProjectZip, type SessionExportRun } from "../lib/session-export.js";
import { prisma } from "../db.js";
import { CONFIG } from "../config.js";
import { decrypt } from "../crypto.js";
import { spacesAppFetch } from "../lib/spaces-api.js";
import { getDmChannelForUserAndApp } from "../lib/spaces-db.js";
import { gcsService } from "../services/storageService.js";
import { asyncHandler, ok, badRequest, unauthorized, forbidden, notFound } from "../lib/http.js";

import { createLogger } from "../logger.js";
const log = createLogger("runs");

const router = Router();

function decryptStoredToken(stored: string): string | null {
  const [ciphertext, iv, authTag] = stored.split(":");
  if (!ciphertext || !iv || !authTag) return null;
  return decrypt(ciphertext, iv, authTag, CONFIG.encryptionKey);
}

function truncateForShare(value: string, maxChars: number, note: string): string {
  return value.length <= maxChars ? value : `${value.slice(0, maxChars)}\n\n_${note}_`;
}

function quoteMarkdown(value: string): string {
  return value.split(/\r?\n/).map((line) => `> ${line}`).join("\n");
}

// GET /runs — list runs for the requesting user
router.get("/", asyncHandler(async (req: Request, res: Response) => {
  const userId = requireRequester(req);
  const status = typeof req.query["status"] === "string" ? req.query["status"] : undefined;
  const conversationId = typeof req.query["conversationId"] === "string" ? req.query["conversationId"] : undefined;
  const agentSlug = typeof req.query["agentSlug"] === "string" ? req.query["agentSlug"] : undefined;
  const limit = typeof req.query["limit"] === "string" ? Math.min(parseInt(req.query["limit"], 10) || 50, 200) : 50;

  // "All Runs": every user's runs of a single agent, ACL-filtered
  // (your own always; other users' only when usedUserToken=false). Requires
  // an agentSlug (scoped to one agent) and claw-admin or contributor access.
  const scopeAll = req.query["scope"] === "all";
  if (scopeAll) {
    if (!agentSlug) throw badRequest("agentSlug is required for scope=all");
    const orgId = getOrgId(req);
    if (!orgId) {
      log.warn(`[runs/all] orgId is required userId=${userId} agentSlug=${agentSlug}`);
      throw badRequest("orgId is required");
    }
    const access = await getAgentEditAccess(userId, agentSlug, orgId);
    if (!access) {
      log.warn(`[runs/all] agent org-scoped miss userId=${userId} agentSlug=${agentSlug} orgId=${orgId}`);
      throw notFound("Agent not found");
    }
    const admin = await isClawAdmin(userId);
    if (!admin && !access.canEdit) {
      log.warn(`[runs/all] denied userId=${userId} agentSlug=${agentSlug} orgId=${orgId}`);
      throw forbidden("Only admins, the owner, or contributors can view all runs for this agent");
    }
    const allRuns = await agentRunRepository.listAllForAgent(agentSlug, access.agent.orgId, userId, {
      ...(status ? { status } : {}),
      ...(conversationId ? { conversationId } : {}),
      limit,
    });
    ok(res, allRuns);
    return;
  }

  const runs = await agentRunRepository.listByUser(userId, {
    ...(status ? { status } : {}),
    ...(conversationId ? { conversationId } : {}),
    ...(agentSlug ? { agentSlug } : {}),
    limit,
  });
  ok(res, runs);
}));

// GET /runs/light — minimal-payload variant for the v3 home page.
//
// Returns ONLY sessionId/agentSlug/status/triggerSource/startedAt/completedAt
// per row. Skips the heavy fields (toolInvocations, task, result) that
// dominate the response size for full listRuns. Use this for the home page
// chart + sessions tile; full listRuns is still the right call for the
// Control Center (which actually renders tool invocations).
//
// Query params:
//   - sinceDays: number 1-90, defaults 7 — filters by startedAt >= now - days
//   - limit: number 1-500, defaults 500 — defensive ceiling
//   - status / agentSlug — optional pass-through filters
//
// Must be declared BEFORE /:sessionId so the literal path takes precedence.
router.get("/light", asyncHandler(async (req: Request, res: Response) => {
  const userId = requireRequester(req);
  const sinceDaysRaw = typeof req.query["sinceDays"] === "string" ? parseInt(req.query["sinceDays"], 10) : NaN;
  const sinceDays = Number.isFinite(sinceDaysRaw) ? Math.min(Math.max(sinceDaysRaw, 1), 90) : 7;
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
  const limit = typeof req.query["limit"] === "string"
    ? Math.min(Math.max(parseInt(req.query["limit"], 10) || 500, 1), 500)
    : 500;
  const status = typeof req.query["status"] === "string" ? req.query["status"] : undefined;
  const agentSlug = typeof req.query["agentSlug"] === "string" ? req.query["agentSlug"] : undefined;
  const conversationId = typeof req.query["conversationId"] === "string" ? req.query["conversationId"] : undefined;
  const runs = await agentRunRepository.listByUserLight(userId, {
    since,
    limit,
    ...(status ? { status } : {}),
    ...(agentSlug ? { agentSlug } : {}),
    ...(conversationId ? { conversationId } : {}),
  });
  ok(res, runs);
}));

// GET /runs/search — content search over the requester's OWN runs.
//
// Case-insensitive substring match on the task text ("find the session where
// I asked the architect to create memory" → one call instead of paging
// /runs/light and grepping spill files). Scoped hard to the authenticated
// user — searching other users' runs is deliberately not offered here.
//
// Query params:
//   - q: required search text (min 2 chars)
//   - agentSlug: optional agent filter
//   - limit: 1-50, defaults 20
//
// Each row is the light projection plus a `snippet`: ±120 chars of task text
// around the first match, so the client can show WHY it matched without
// shipping multi-KB task bodies.
//
// Must be declared BEFORE /:sessionId so the literal path takes precedence.
router.get("/search", asyncHandler(async (req: Request, res: Response) => {
  const userId = requireRequester(req);
  const q = typeof req.query["q"] === "string" ? req.query["q"].trim() : "";
  if (q.length < 2) throw badRequest("q (min 2 chars) is required");
  const agentSlug = typeof req.query["agentSlug"] === "string" ? req.query["agentSlug"] : undefined;
  const limit = typeof req.query["limit"] === "string"
    ? Math.min(Math.max(parseInt(req.query["limit"], 10) || 20, 1), 50)
    : 20;
  const rows = await agentRunRepository.searchByUser(userId, q, {
    ...(agentSlug ? { agentSlug } : {}),
    limit,
  });
  const data = rows.map(({ task, ...rest }) => {
    const at = task.toLowerCase().indexOf(q.toLowerCase());
    const start = Math.max(0, at - 120);
    const end = Math.min(task.length, at + q.length + 120);
    return {
      ...rest,
      snippet: `${start > 0 ? "…" : ""}${task.slice(start, end)}${end < task.length ? "…" : ""}`,
    };
  });
  ok(res, data);
}));

// GET /runs/by-agent/:slug — cross-user run history for one agent.
//
// Powers the `get-agent-runs` system tool. S2S-gated so it's only reachable
// from inside the cluster (claw-pod custom tools call it with the shared
// x-s2s-key), not from public clients. No per-user auth — any agent can ask
// about any agent's run history, by design (stats are openly inspectable).
//
// Query params:
//   - sinceDays: 1-365, defaults 30
//   - limit: 1-200, defaults 50
//   - status: optional filter (running / completed / failed / cancelled)
//
// Must be declared BEFORE /:sessionId so the literal path takes precedence.
router.get("/by-agent/:slug", requireS2S, async (req: Request<{ slug: string }>, res: Response) => {
  try {
    const slug = req.params.slug;
    if (!slug || typeof slug !== "string") {
      res.status(400).json({ success: false, error: "slug is required" });
      return;
    }
    const sinceDaysRaw = typeof req.query["sinceDays"] === "string" ? parseInt(req.query["sinceDays"], 10) : NaN;
    const sinceDays = Number.isFinite(sinceDaysRaw) ? Math.min(Math.max(sinceDaysRaw, 1), 365) : 30;
    const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
    const limit = typeof req.query["limit"] === "string"
      ? Math.min(Math.max(parseInt(req.query["limit"], 10) || 50, 1), 200)
      : 50;
    const status = typeof req.query["status"] === "string" ? req.query["status"] : undefined;
    const requesterId = getRequesterId(req);
    let orgId = getOrgId(req)
      ?? (requesterId
        ? (await prisma.user.findUnique({ where: { id: requesterId }, select: { orgId: true } }))?.orgId
        : undefined);
    // S2S-key-only callers (the runtime's get-agent-runs tool sends no
    // x-user-id) have no derivable org — resolve the agent by slug with the
    // single-match-or-fail rule instead (loud 404 on cross-org ambiguity),
    // same pattern as GET /agents/:slug.
    if (!orgId) {
      const matches = await prisma.agent.findMany({ where: { slug }, select: { orgId: true }, take: 2 });
      if (matches.length === 1) {
        orgId = matches[0]!.orgId;
      } else if (matches.length > 1) {
        log.error(`[runs/by-agent] ambiguous slug across orgs; refusing (slug=${slug})`);
      }
    }
    if (!orgId) {
      log.warn(`[runs/by-agent] orgId is required requesterId=${requesterId ?? "none"} slug=${slug}`);
      res.status(400).json({ success: false, error: "orgId is required" });
      return;
    }

    // Existence check — return 404 instead of empty array so the agent can
    // distinguish "this agent doesn't exist" (typo) from "no recent runs"
    // (real but quiet agent).
    const agent = await agentRepository.findBySlug(slug, orgId);
    if (!agent) {
      log.warn(`[runs/by-agent] agent org-scoped miss slug=${slug} orgId=${orgId ?? "none"} requesterId=${requesterId ?? "none"}`);
      res.status(404).json({ success: false, error: `agent "${slug}" not found` });
      return;
    }

    const runs = await agentRunRepository.listByAgentSlug(slug, orgId, {
      since,
      limit,
      ...(status ? { status } : {}),
    });

    res.json({
      success: true,
      data: {
        agentSlug: slug,
        agentName: agent.name,
        sinceDays,
        limit,
        ...(status ? { statusFilter: status } : {}),
        totalReturned: runs.length,
        runs,
      },
    });
  } catch (err) {
    log.error("[runs] /by-agent error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// GET /runs/session/export — download a full session (thread + agent) as Claude Code .jsonl or markdown.
// Must be declared BEFORE /:sessionId so the literal path takes precedence.
router.get("/session/export", async (req: Request, res: Response) => {
  try {
    const userId = getRequesterId(req);
    if (!userId) {
      res.status(401).json({ success: false, error: "Unauthorized" });
      return;
    }
    const conversationId = typeof req.query["conversationId"] === "string" ? req.query["conversationId"] : undefined;
    const agentSlug = typeof req.query["agentSlug"] === "string" ? req.query["agentSlug"] : undefined;
    const format = typeof req.query["format"] === "string" ? req.query["format"] : "claude-code";
    if (!conversationId || !agentSlug) {
      res.status(400).json({ success: false, error: "conversationId and agentSlug are required" });
      return;
    }
    if (format !== "claude-code" && format !== "markdown" && format !== "claude-project") {
      res.status(400).json({ success: false, error: "format must be 'claude-code', 'markdown', or 'claude-project'" });
      return;
    }

    // Fetch all runs in the session, oldest first. listByUser already enforces userId ownership.
    const runs = await agentRunRepository.listByUser(userId, { conversationId, agentSlug, limit: 200 });
    if (runs.length === 0) {
      res.status(404).json({ success: false, error: "No runs found for this session" });
      return;
    }
    const ordered = runs.slice().sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());

    const exportRuns: SessionExportRun[] = ordered.map((r) => ({
      sessionId: r.sessionId,
      agentSlug: r.agentSlug,
      task: r.task,
      result: r.result,
      error: r.error,
      status: r.status,
      startedAt: r.startedAt,
      completedAt: r.completedAt,
      toolInvocations: Array.isArray(r.toolInvocations) ? (r.toolInvocations as unknown as SessionExportRun["toolInvocations"]) : null,
    }));

    // Use latest run's sessionId as the canonical file id — matches what users see in the drawer.
    const canonicalSessionId = ordered[ordered.length - 1]!.sessionId;

    if (format === "markdown") {
      const body = renderMarkdown(exportRuns, { agentSlug, conversationId });
      res.setHeader("Content-Type", "text/markdown; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${canonicalSessionId}.md"`);
      res.send(body);
      return;
    }

    if (format === "claude-project") {
      // Full zip bundle: CLAUDE.md (agent prompt) + .claude/agents/*.md (subagents) + .claude/skills/*.md (attached skills) + session jsonl + README
      const agentRow = await agentRepository.findBySlugWithRelations(agentSlug, getOrgId(req));
      if (!agentRow) {
        log.warn(`[runs/export] agent org-scoped miss slug=${agentSlug} orgId=${getOrgId(req) ?? "none"} conversationId=${conversationId ?? "none"}`);
        res.status(404).json({ success: false, error: "Agent not found" });
        return;
      }
      const skills = (agentRow.skills ?? []).map((as) => ({
        slug: as.skill.slug,
        name: as.skill.name,
        description: as.skill.description ?? "",
        content: as.skill.content ?? "",
        // Ship the skill's bundled files (scripts/, assets, …) too. Without
        // this the SKILL.md loaded but its `scripts/` folder was silently
        // dropped on the top-level /run path — only the subagent/callable
        // resolvers included files — so a skill that shells out to its own
        // scripts appeared "loaded" but its scripts never materialized in the
        // session. Mirrors subagent-resolver.ts.
        ...((as.skill.files?.length ?? 0) > 0
          ? {
              files: as.skill.files.map((f) => ({
                relativePath: f.relativePath,
                content: f.content,
                contentType: f.contentType ?? undefined,
              })),
            }
          : {}),
      }));
      const zipBuffer = await renderClaudeProjectZip({
        agent: {
          slug: agentRow.slug,
          name: agentRow.name,
          description: agentRow.description ?? "",
          systemPrompt: agentRow.systemPrompt ?? "",
        },
        skills,
        runs: exportRuns,
        sessionId: canonicalSessionId,
      });
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="${canonicalSessionId}.zip"`);
      res.send(zipBuffer);
      return;
    }

    // claude-code jsonl
    const body = renderClaudeCodeJsonl(exportRuns, canonicalSessionId);
    res.setHeader("Content-Type", "application/jsonl; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${canonicalSessionId}.jsonl"`);
    res.send(body);
  } catch (err) {
    log.error("[runs] session export error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// GET /runs/:sessionId — single run detail
router.get("/:sessionId", async (req: Request<{ sessionId: string }>, res: Response) => {
  try {
    const userId = getRequesterId(req);
    if (!userId) {
      res.status(401).json({ success: false, error: "Unauthorized" });
      return;
    }
    const run = await agentRunRepository.findBySessionId(req.params.sessionId);
    if (!run) {
      res.status(404).json({ success: false, error: "Run not found" });
      return;
    }
    if (run.userId !== userId) {
      res.status(403).json({ success: false, error: "Forbidden" });
      return;
    }
    res.json({ success: true, data: run });
  } catch (err) {
    log.error("[runs] get error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// POST /runs/:sessionId/share — promote an offline CLI session into Spaces.
router.post("/:sessionId/share", async (req: Request<{ sessionId: string }>, res: Response) => {
  const { sessionId } = req.params;
  try {
    const requesterId = getRequesterId(req);
    if (!requesterId) {
      res.status(401).json({ success: false, error: "Unauthorized" });
      return;
    }

    const run = await prisma.agentRun.findUnique({ where: { sessionId } });
    if (!run) {
      res.status(404).json({ success: false, error: "Run not found" });
      return;
    }
    if (run.userId !== requesterId) {
      res.status(403).json({ success: false, error: "Forbidden" });
      return;
    }

    const body = (req.body ?? {}) as { channelId?: unknown; deliverTo?: unknown };
    const channelId = typeof body.channelId === "string" && body.channelId.trim()
      ? body.channelId.trim()
      : undefined;
    const deliverTo = body.deliverTo;
    if (!channelId && deliverTo !== "dm") {
      res.status(400).json({ success: false, error: "channelId or deliverTo='dm' is required" });
      return;
    }
    if (deliverTo !== undefined && deliverTo !== "dm") {
      res.status(400).json({ success: false, error: "deliverTo must be 'dm'" });
      return;
    }

    const agent = await prisma.agent.findUnique({
      where: { orgId_slug: { orgId: run.orgId, slug: run.agentSlug } },
      select: {
        name: true,
        spacesAppToken: true,
        spacesAppUserId: true,
        spacesAppId: true,
      },
    });
    if (!agent?.spacesAppToken || !agent.spacesAppUserId || !agent.spacesAppId) {
      res.status(409).json({
        success: false,
        error: `Agent "${run.agentSlug}" has no Xyne Spaces app identity`,
      });
      return;
    }

    const appToken = decryptStoredToken(agent.spacesAppToken);
    if (!appToken) {
      res.status(409).json({
        success: false,
        error: `Agent "${run.agentSlug}" has an invalid Xyne Spaces app identity`,
      });
      return;
    }

    let targetChannelId = channelId;
    if (!targetChannelId && deliverTo === "dm") {
      targetChannelId = await getDmChannelForUserAndApp(requesterId, agent.spacesAppId) ?? undefined;
      if (!targetChannelId) {
        res.status(409).json({
          success: false,
          error: `Could not resolve an existing Xyne Spaces DM with agent "${run.agentSlug}"`,
        });
        return;
      }
    }

    const result = truncateForShare(run.result ?? "(Session completed with no result.)", 4_000, "Result truncated for sharing");
    const originalTask = truncateForShare(run.task, 500, "Original task truncated");
    const markdownText = [
      `↪️ Continuing a session started offline with ${agent.name}`,
      result,
      quoteMarkdown(`Original task\n${originalTask}`),
    ].join("\n\n");

    const postResult = (await spacesAppFetch("/chat/postMessage", {
      channelId: targetChannelId,
      markdownText,
      userId: agent.spacesAppUserId,
      metadata: { contentFormat: "markdown" },
    }, appToken)) as { conversationId?: string; messageId?: string };
    const newConversationId = postResult.conversationId;
    const messageId = postResult.messageId;
    if (!newConversationId || !messageId) {
      throw new Error("Spaces postMessage response did not include conversationId and messageId");
    }

    let continuity = false;
    if (!run.conversationId) {
      log.warn(`[runs/share] no source conversation sessionId=${sessionId} agent=${run.agentSlug}`);
    } else {
      const sourcePrefix = `claw-sessions/${run.conversationId}_${run.agentSlug}/`;
      const destinationPrefix = `claw-sessions/${newConversationId}_${run.agentSlug}/`;
      try {
        const sourceObjects = (await gcsService.listFiles(sourcePrefix)).filter((name) => {
          const relativePath = name.slice(sourcePrefix.length);
          return relativePath.length > 0 && !relativePath.startsWith("debug/");
        });
        if (sourceObjects.length === 0) {
          log.warn(`[runs/share] session archive missing sessionId=${sessionId} source=${sourcePrefix}`);
        } else {
          for (const sourceObject of sourceObjects) {
            const relativePath = sourceObject.slice(sourcePrefix.length);
            const content = await gcsService.getFileBuffer(sourceObject);
            const metadata = await gcsService.getMetadata(sourceObject);
            await gcsService.uploadFile(
              content,
              `${destinationPrefix}${relativePath}`,
              metadata.contentType ?? "application/octet-stream",
            );
          }
          continuity = true;
        }
      } catch (err) {
        log.warn(
          `[runs/share] continuity copy failed sessionId=${sessionId} agent=${run.agentSlug}: ${errMsg(err)}`,
        );
      }
    }

    log.info(
      `[runs/share] shared sessionId=${sessionId} agent=${run.agentSlug} target=${deliverTo === "dm" && !channelId ? "dm:" : "channel:"}${targetChannelId} by-user=${requesterId} continuity=${continuity}`,
    );
    res.json({
      success: true,
      data: {
        channelId: targetChannelId,
        conversationId: newConversationId,
        messageId,
        continuity,
      },
    });
  } catch (err) {
    log.error(`[runs/share] error sessionId=${sessionId}:`, err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// POST /runs/by-message/:chatMessageId/rate — thumbs up/down + optional comment,
// keyed by the assistant ChatMessage id (available to the client the instant a
// turn completes, unlike the run sessionId which lags behind a /messages fetch).
router.post(
  "/by-message/:chatMessageId/rate",
  async (req: Request<{ chatMessageId: string }>, res: Response) => {
    try {
      const userId = getRequesterId(req);
      if (!userId) {
        res.status(401).json({ success: false, error: "Unauthorized" });
        return;
      }
      const { rating, comment } = req.body as { rating?: string; comment?: string | null };
      if (rating !== "up" && rating !== "down") {
        res.status(400).json({ success: false, error: "rating must be 'up' or 'down'" });
        return;
      }
      const result = await agentRunRepository.rateByChatMessageId(
        req.params.chatMessageId,
        userId,
        rating,
        comment ?? null,
      );
      if (result.count === 0) {
        res.status(404).json({ success: false, error: "Run not found for message" });
        return;
      }
      res.json({ success: true });
    } catch (err) {
      log.error("[runs] rate-by-message error:", err);
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  },
);

// POST /runs/:sessionId/rate — thumbs up/down + optional comment
router.post("/:sessionId/rate", async (req: Request<{ sessionId: string }>, res: Response) => {
  try {
    const userId = getRequesterId(req);
    if (!userId) {
      res.status(401).json({ success: false, error: "Unauthorized" });
      return;
    }
    const { rating, comment } = req.body as { rating?: string; comment?: string | null };
    if (rating !== "up" && rating !== "down") {
      res.status(400).json({ success: false, error: "rating must be 'up' or 'down'" });
      return;
    }
    const run = await agentRunRepository.findBySessionId(req.params.sessionId);
    if (!run) {
      res.status(404).json({ success: false, error: "Run not found" });
      return;
    }
    if (run.userId !== userId) {
      res.status(403).json({ success: false, error: "Forbidden" });
      return;
    }
    await agentRunRepository.rate(req.params.sessionId, userId, rating, comment ?? null);
    res.json({ success: true });
  } catch (err) {
    log.error("[runs] rate error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

export const runsRouter = router;
