import { Router, type Request, type Response } from "express";
import { requireClawAdmin, getRequesterId, isClawAdmin } from "../middleware/agent-acl.js";
import { windowFromDays } from "../lib/time-window.js";
import { writeAuditLog } from "../lib/audit.js";
import { userRoleRepository, userRepository, auditLogRepository, agentRunRepository, agentRepository } from "../repositories/index.js";
import { prisma } from "../db.js";
import { encrypt, decrypt } from "../crypto.js";
import { CONFIG } from "../config.js";
import { evictSession } from "../mcp/runner.js";
import { getDoctorBitbucketStats } from "../services/bitbucket-stats.js";

const router = Router();

router.get("/roles", requireClawAdmin, async (_req: Request, res: Response) => {
  try {
    const roles = await userRoleRepository.listByRole("CLAW_ADMIN");
    res.json({ success: true, data: roles });
  } catch (err) {
    console.error("[admin] list roles error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

router.post("/roles", requireClawAdmin, async (req: Request, res: Response) => {
  try {
    const requesterId = getRequesterId(req)!;
    // Accept the field as `userId` (legacy) or `userIdOrEmail` (frontend
    // started passing emails too). Either is looked up first by ID then by
    // email — matches the pattern used by /subagents/:name/shares.
    const body = req.body as { userId?: string; userIdOrEmail?: string };
    const raw = (body.userIdOrEmail ?? body.userId ?? "").trim();
    if (!raw) {
      res.status(400).json({ success: false, error: "userId or email is required" });
      return;
    }

    let targetUser = await userRepository.findById(raw);
    if (!targetUser) targetUser = await userRepository.findByEmail(raw);
    if (!targetUser) {
      res.status(404).json({ success: false, error: `No user matches "${raw}"` });
      return;
    }

    const role = await userRoleRepository.upsert(targetUser.id, "CLAW_ADMIN", requesterId);
    await writeAuditLog({
      actorUserId: requesterId,
      eventType: "ROLE_GRANTED",
      targetId: targetUser.id,
      description: `CLAW_ADMIN granted to ${targetUser.email}`,
      metadata: { targetEmail: targetUser.email },
    });
    console.log(`[admin] CLAW_ADMIN granted to ${targetUser.email} by ${requesterId}`);
    res.status(201).json({ success: true, data: role });
  } catch (err) {
    console.error("[admin] grant role error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

router.delete("/roles/:userId", requireClawAdmin, async (req: Request<{ userId: string }>, res: Response) => {
  try {
    const requesterId = getRequesterId(req)!;
    const { userId } = req.params;
    if (userId === requesterId) { res.status(400).json({ success: false, error: "Cannot revoke your own CLAW_ADMIN role" }); return; }

    const targetUser = await userRepository.findById(userId);
    if (!targetUser) { res.status(404).json({ success: false, error: "User not found" }); return; }

    await userRoleRepository.delete(userId, "CLAW_ADMIN");
    await writeAuditLog({ actorUserId: requesterId, eventType: "ROLE_REVOKED", targetId: userId, description: `CLAW_ADMIN revoked from ${targetUser.email}`, metadata: { targetEmail: targetUser.email } });
    console.log(`[admin] CLAW_ADMIN revoked from ${targetUser.email} by ${requesterId}`);
    res.json({ success: true });
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err && (err as { code: string }).code === "P2025") {
      res.status(404).json({ success: false, error: "User does not have CLAW_ADMIN role" });
      return;
    }
    console.error("[admin] revoke role error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// Self-check only. The `:userId` path param is preserved for backward
// compatibility with the existing frontend helper (checkIsAdmin) but is
// IGNORED — the admin lookup is always run against the authenticated
// caller resolved by requireAuth. This prevents a non-admin from probing
// arbitrary userIds to discover who in the org is a CLAW_ADMIN.
router.get("/roles/check/:userId", async (req: Request<{ userId: string }>, res: Response) => {
  try {
    const requesterId = getRequesterId(req);
    if (!requesterId) {
      res.status(401).json({ success: false, error: "Unauthenticated" });
      return;
    }
    const admin = await isClawAdmin(requesterId);
    res.json({ success: true, data: { isAdmin: admin } });
  } catch (err) {
    console.error("[admin] check role error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

router.get("/audit-logs", requireClawAdmin, async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Number(req.query["limit"] ?? 50), 200);
    const offset = Number(req.query["offset"] ?? 0);
    const eventType = req.query["eventType"] as string | undefined;
    const targetId = req.query["targetId"] as string | undefined;
    const [logs, total] = await Promise.all([
      auditLogRepository.list({ eventType, targetId, limit, offset }),
      auditLogRepository.count({ eventType, targetId }),
    ]);
    res.json({ success: true, data: logs, total, limit, offset });
  } catch (err) {
    console.error("[admin] audit-logs error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// ── Ratings aggregation ──────────────────────────────────────────────

function cutoffFromDays(daysParam: unknown): Date | null {
  if (daysParam === "all") return null;
  const days = typeof daysParam === "string" ? parseInt(daysParam, 10) : NaN;
  if (!Number.isFinite(days) || days <= 0) return null;
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

router.get("/ratings/stats", requireClawAdmin, async (req: Request, res: Response) => {
  try {
    const cutoff = cutoffFromDays(req.query["days"] ?? "30");
    const stats = await agentRunRepository.ratingStatsByAgent(cutoff);
    res.json({ success: true, data: stats });
  } catch (err) {
    console.error("[admin] ratings/stats error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

router.get("/ratings/recent-downs", requireClawAdmin, async (req: Request, res: Response) => {
  try {
    const cutoff = cutoffFromDays(req.query["days"] ?? "30");
    const limit = Math.min(Number(req.query["limit"] ?? 50), 200);
    const rows = await agentRunRepository.recentDownRuns(cutoff, limit);
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error("[admin] ratings/recent-downs error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// ── Usage aggregation (per-agent token + run counts) ─────────────────

router.get("/usage/stats", requireClawAdmin, async (req: Request, res: Response) => {
  try {
    const cutoff = cutoffFromDays(req.query["days"] ?? "30");
    const stats = await agentRunRepository.usageStatsByAgent(cutoff);
    res.json({ success: true, data: stats });
  } catch (err) {
    console.error("[admin] usage/stats error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// ── Scheduled jobs (admin-wide view) ─────────────────────────────────

router.get("/scheduled-jobs", requireClawAdmin, async (req: Request, res: Response) => {
  try {
    const { status, agentSlug, userId } = req.query as {
      status?: string;
      agentSlug?: string;
      userId?: string;
    };
    const limit = Math.min(Number(req.query["limit"] ?? 50), 200);
    const offset = Math.max(Number(req.query["offset"] ?? 0), 0);

    const where: Record<string, unknown> = {};
    if (status) where["status"] = status;
    if (agentSlug) where["agentSlug"] = agentSlug;
    if (userId) where["userId"] = userId;

    const [rows, total] = await Promise.all([
      prisma.scheduledJob.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
      }),
      prisma.scheduledJob.count({ where }),
    ]);

    const userIds = Array.from(new Set(rows.map((r) => r.userId)));
    const users = await userRepository.findByIds(userIds);
    const userById = new Map(users.map((u) => [u.id, u]));

    res.json({
      success: true,
      data: {
        rows: rows.map((r) => ({
          ...r,
          delayMs: r.delayMs != null ? Number(r.delayMs) : null,
          user: userById.get(r.userId) ?? null,
        })),
        total,
      },
    });
  } catch (err) {
    console.error("[admin] scheduled-jobs error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// ── Global MCP credentials (admin-only fallback creds) ──────────────────────

router.get("/mcp-servers", requireClawAdmin, async (_req: Request, res: Response) => {
  try {
    const servers = await prisma.mcpServer.findMany({
      include: { globalCredentials: true },
      orderBy: { name: "asc" },
    });
    res.json({
      success: true,
      data: servers.map((s) => ({
        id: s.id,
        type: s.type,
        name: s.name,
        description: s.description,
        enabled: s.enabled,
        allowGlobalFallback: s.allowGlobalFallback,
        hasGlobalCredentials: Boolean(s.globalCredentials),
        globalCredentialsUpdatedAt: s.globalCredentials?.updatedAt ?? null,
        globalCredentialsSetByUserId: s.globalCredentials?.setByUserId ?? null,
      })),
    });
  } catch (err) {
    console.error("[admin] list mcp-servers error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

router.put("/mcp-servers/:type/global-fallback", requireClawAdmin, async (req: Request<{ type: string }>, res: Response) => {
  try {
    const requesterId = getRequesterId(req)!;
    const { allow } = req.body as { allow?: boolean };
    if (typeof allow !== "boolean") {
      res.status(400).json({ success: false, error: "allow (boolean) is required" });
      return;
    }
    const server = await prisma.mcpServer.findUnique({ where: { type: req.params.type } });
    if (!server) { res.status(404).json({ success: false, error: "MCP server not found" }); return; }

    await prisma.mcpServer.update({ where: { id: server.id }, data: { allowGlobalFallback: allow } });
    await writeAuditLog({
      actorUserId: requesterId,
      eventType: allow ? "MCP_GLOBAL_FALLBACK_ENABLED" : "MCP_GLOBAL_FALLBACK_DISABLED",
      targetId: server.id,
      description: `Global fallback ${allow ? "enabled" : "disabled"} for MCP server ${server.type}`,
    });
    res.json({ success: true, data: { type: server.type, allowGlobalFallback: allow } });
  } catch (err) {
    console.error("[admin] toggle global-fallback error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

router.put("/mcp-servers/:type/global-credentials", requireClawAdmin, async (req: Request<{ type: string }>, res: Response) => {
  try {
    const requesterId = getRequesterId(req)!;
    const { credentials } = req.body as { credentials?: Record<string, unknown> };
    if (!credentials || typeof credentials !== "object" || Array.isArray(credentials)) {
      res.status(400).json({ success: false, error: "credentials object is required" });
      return;
    }
    const server = await prisma.mcpServer.findUnique({ where: { type: req.params.type } });
    if (!server) { res.status(404).json({ success: false, error: "MCP server not found" }); return; }

    const enc = encrypt(JSON.stringify(credentials), CONFIG.encryptionKey);
    const row = await prisma.globalMcpCredentials.upsert({
      where: { mcpServerId: server.id },
      create: {
        mcpServerId: server.id,
        encryptedCreds: enc.ciphertext,
        iv: enc.iv,
        authTag: enc.authTag,
        setByUserId: requesterId,
      },
      update: {
        encryptedCreds: enc.ciphertext,
        iv: enc.iv,
        authTag: enc.authTag,
        setByUserId: requesterId,
      },
    });

    // Evict every cached MCP child whose env was baked from the OLD global
    // creds — running children belong to users who don't have personal creds
    // and were resolved via the global path. We don't track that mapping
    // explicitly, so the safe move is best-effort: nothing to do for sessions
    // not in memory; the next callTool will spawn a fresh child with new env.
    // (User-owned sessions never used these creds, so they're unaffected.)
    await evictSession("__global__", server.type).catch(() => {});

    await writeAuditLog({
      actorUserId: requesterId,
      eventType: "MCP_GLOBAL_CREDENTIALS_SET",
      targetId: server.id,
      description: `Global credentials updated for MCP server ${server.type}`,
    });

    res.json({
      success: true,
      data: {
        type: server.type,
        updatedAt: row.updatedAt,
        setByUserId: row.setByUserId,
      },
    });
  } catch (err) {
    console.error("[admin] put global-credentials error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

router.delete("/mcp-servers/:type/global-credentials", requireClawAdmin, async (req: Request<{ type: string }>, res: Response) => {
  try {
    const requesterId = getRequesterId(req)!;
    const server = await prisma.mcpServer.findUnique({
      where: { type: req.params.type },
      include: { globalCredentials: true },
    });
    if (!server) { res.status(404).json({ success: false, error: "MCP server not found" }); return; }
    if (!server.globalCredentials) { res.status(404).json({ success: false, error: "No global credentials set" }); return; }

    await prisma.globalMcpCredentials.delete({ where: { mcpServerId: server.id } });
    await writeAuditLog({
      actorUserId: requesterId,
      eventType: "MCP_GLOBAL_CREDENTIALS_REMOVED",
      targetId: server.id,
      description: `Global credentials removed for MCP server ${server.type}`,
    });
    res.json({ success: true });
  } catch (err) {
    console.error("[admin] delete global-credentials error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

router.get("/mcp-servers/:type/global-credentials", requireClawAdmin, async (req: Request<{ type: string }>, res: Response) => {
  try {
    const server = await prisma.mcpServer.findUnique({
      where: { type: req.params.type },
      include: { globalCredentials: true },
    });
    if (!server) { res.status(404).json({ success: false, error: "MCP server not found" }); return; }
    if (!server.globalCredentials) {
      res.json({ success: true, data: { type: server.type, hasCredentials: false } });
      return;
    }
    const decrypted = decrypt(
      server.globalCredentials.encryptedCreds,
      server.globalCredentials.iv,
      server.globalCredentials.authTag,
      CONFIG.encryptionKey,
    );
    const creds = JSON.parse(decrypted) as Record<string, unknown>;
    // Don't return secret values — only field names so the admin UI can show
    // "[set]" indicators. Admin sets new creds via PUT.
    res.json({
      success: true,
      data: {
        type: server.type,
        hasCredentials: true,
        credentialKeys: Object.keys(creds),
        updatedAt: server.globalCredentials.updatedAt,
        setByUserId: server.globalCredentials.setByUserId,
      },
    });
  } catch (err) {
    console.error("[admin] get global-credentials error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// ── Agent Dashboard (single payload endpoint) ───────────────────────────────

// Open to any authenticated user (not gated by requireClawAdmin) — the
// org-wide agent dashboard is meant for everyone with a Spaces login, not
// just admins. Mount-level requireAuth still applies.
router.get("/dashboard", async (req: Request, res: Response) => {
  try {
    const window = windowFromDays(req.query["days"] ?? "30");
    const cutoff = window?.start ?? null;
    const limit = Math.min(Number(req.query["topUsersLimit"] ?? 10), 50);

    const [agentStats, overview, agentRunStats, rawUserActivity, ratingStats, agentsForDashboard, skillUsage, subagentUsage] = await Promise.all([
      agentRepository.dashboardStats(),
      agentRunRepository.globalOverviewStats(cutoff),
      agentRunRepository.runStatsByAgent(cutoff),
      agentRunRepository.userActivityBreakdown(cutoff, limit),
      agentRunRepository.ratingStatsByAgent(cutoff),
      agentRepository.listForDashboard(),
      agentRepository.skillUsageByGlobalAgents(),
      agentRepository.subagentUsageByGlobalAgents(),
    ]);

    const ratingBySlug = new Map(ratingStats.map((r) => [r.agentSlug, r] as const));
    const runStatsBySlug = new Map(agentRunStats.map((r) => [r.agentSlug, r] as const));

    const buildRow = (slug: string, run: typeof agentRunStats[number] | undefined, meta: typeof agentsForDashboard[number] | undefined) => {
      const rating = ratingBySlug.get(slug);
      return {
        agentSlug: slug,
        totalRuns: run?.totalRuns ?? 0,
        uniqueUsers: run?.uniqueUsers ?? 0,
        completedRuns: run?.completedRuns ?? 0,
        failedRuns: run?.failedRuns ?? 0,
        avgDurationMs: run?.avgDurationMs ?? null,
        totalTokensIn: run?.totalTokensIn ?? 0,
        totalTokensOut: run?.totalTokensOut ?? 0,
        upCount: rating?.upCount ?? 0,
        downCount: rating?.downCount ?? 0,
        ratedCount: rating?.ratedCount ?? 0,
        negativeRate: rating?.negativeRate ?? 0,
        agentName: meta?.name ?? slug,
        agentScope: meta?.scope ?? null,
        agentEnabled: meta?.enabled ?? null,
        agentRegistered: meta?.spacesAppId != null,
        ownerEmail: meta?.owner?.email ?? null,
      };
    };

    // Only include global-scope agents; orphan slugs (deleted) appended below.
    const agentTable = agentsForDashboard
      .filter((meta) => meta.scope === "global")
      .map((meta) => buildRow(meta.slug, runStatsBySlug.get(meta.slug), meta));

    // Runs for slugs not in agents table (deleted agents, typos) — append at end.
    for (const run of agentRunStats) {
      if (!agentsForDashboard.some((a) => a.slug === run.agentSlug)) {
        agentTable.push(buildRow(run.agentSlug, run, undefined));
      }
    }

    agentTable.sort((a, b) => b.totalRuns - a.totalRuns || a.agentName.localeCompare(b.agentName));

    const agents = agentsForDashboard.map((a) => ({
      id: a.id,
      slug: a.slug,
      name: a.name,
      description: a.description,
      scope: a.scope,
      enabled: a.enabled,
      ownerUserId: a.ownerUserId,
      spacesAppId: a.spacesAppId,
      createdAt: a.createdAt,
      promotedAt: a.promotedAt,
      owner: a.owner,
      _count: a._count,
    }));

    // Build unified user activity rows: top users + per-agent breakdown (global agents only)
    const userActivityBreakdown = rawUserActivity.map((u) => {
      const agentRows = u.perAgent
        .filter((a) => {
          const meta = agentsForDashboard.find((m) => m.slug === a.agentSlug);
          return meta?.scope === "global";
        })
        .map((a) => {
        const meta = agentsForDashboard.find((m) => m.slug === a.agentSlug);
        return {
          agentSlug: a.agentSlug,
          agentName: meta?.name ?? a.agentSlug,
          agentScope: "global" as const,
          agentEnabled: meta?.enabled ?? null,
          agentRegistered: meta?.spacesAppId != null,
          owned: false,
          runCount: a.runCount,
          completedRuns: a.completedRuns,
          failedRuns: a.failedRuns,
          avgDurationMs: a.avgDurationMs,
          lastRunAt: a.lastRunAt,
          totalTokens: a.tokensIn + a.tokensOut,
        };
      });

      return {
        userId: u.userId,
        name: u.name,
        email: u.email,
        totalRuns: u.totalRuns,
        uniqueAgents: u.uniqueAgents,
        totalTokensIn: u.totalTokensIn,
        totalTokensOut: u.totalTokensOut,
        agents: agentRows,
      };
    });

    res.json({
      success: true,
      data: {
        agentStats,
        overview,
        agentTable,
        agents,
        userActivityBreakdown,
        skillUsage,
        subagentUsage,
      },
    });
  } catch (err) {
    console.error("[admin] dashboard error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// ── Project Insights ─────────────────────────────────────────────────────────

/** GET /api/v1/admin/dashboard/projects?days=all
 *  Returns distinct projects seen in agent_runs (for the dropdown). */
router.get("/dashboard/projects", async (req: Request, res: Response) => {
  try {
    const window = windowFromDays(req.query["days"] ?? "all");
    const cutoff = window?.start ?? null;
    const projects = await agentRunRepository.listProjectsForDashboard(cutoff);
    res.json({ success: true, data: projects });
  } catch (err) {
    console.error("[admin] dashboard/projects error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/** GET /api/v1/admin/dashboard/project-insights?projectId=...&days=30
 *  Returns agent usage, top users, and skill usage scoped to one project. */
router.get("/dashboard/project-insights", async (req: Request, res: Response) => {
  try {
    const projectId = req.query["projectId"] as string | undefined;
    if (!projectId) {
      res.status(400).json({ success: false, error: "projectId is required" });
      return;
    }
    const window = windowFromDays(req.query["days"] ?? "30");
    const cutoff = window?.start ?? null;

    const [agentUsage, topUsers, skillUsage, subagentUsage] = await Promise.all([
      agentRunRepository.projectAgentUsage(projectId, cutoff),
      agentRunRepository.projectTopUsers(projectId, cutoff, 10),
      agentRunRepository.projectSkillUsage(projectId, cutoff),
      agentRunRepository.projectSubagentUsage(projectId, cutoff),
    ]);

    // Enrich agent rows with name / scope / enabled from agent metadata
    const agentMeta = await agentRepository.listForDashboard();
    const metaBySlug = new Map(agentMeta.map((a) => [a.slug, a]));
    const enrichedAgentUsage = agentUsage.map((r) => ({
      ...r,
      agentName: metaBySlug.get(r.agentSlug)?.name ?? r.agentSlug,
      agentEnabled: metaBySlug.get(r.agentSlug)?.enabled ?? null,
      agentScope: (metaBySlug.get(r.agentSlug)?.scope ?? null) as "global" | "personal" | null,
    }));

    res.json({
      success: true,
      data: { projectId, agentUsage: enrichedAgentUsage, topUsers, skillUsage, subagentUsage },
    });
  } catch (err) {
    console.error("[admin] dashboard/project-insights error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// ── xyne-doctor PR / commit counts from Bitbucket ──────────────────────────
// Returns the live count of PRs and commits authored by the bot identity
// (default `john.doe@gmail.com`) in Bitbucket Server. The service caches
// for ~15 min and warms a background refresh on startup, so this endpoint is
// effectively a memory read.
// Open to any authenticated user — the dashboard renders this card for
// everyone, not just admins. Same rationale as /dashboard above.
router.get("/dashboard/bitbucket-stats", async (_req: Request, res: Response) => {
  try {
    const data = await getDoctorBitbucketStats();
    res.json({ success: true, data });
  } catch (err) {
    console.error("[admin] bitbucket-stats error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

export { router as adminRouter };