import { Router, type Request, type Response } from "express";
import { requireClawAdmin, getRequesterId, isClawAdmin } from "../middleware/agent-acl.js";
import { writeAuditLog } from "../lib/audit.js";
import { userRoleRepository, userRepository, auditLogRepository, agentRunRepository } from "../repositories/index.js";
import { prisma } from "../db.js";

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
    const { userId } = req.body as { userId?: string };
    if (!userId || typeof userId !== "string" || userId.trim().length === 0) {
      res.status(400).json({ success: false, error: "userId is required" });
      return;
    }
    const targetUser = await userRepository.findById(userId.trim());
    if (!targetUser) { res.status(404).json({ success: false, error: "User not found" }); return; }

    const role = await userRoleRepository.upsert(userId.trim(), "CLAW_ADMIN", requesterId);
    await writeAuditLog({ actorUserId: requesterId, eventType: "ROLE_GRANTED", targetId: userId.trim(), description: `CLAW_ADMIN granted to ${targetUser.email}`, metadata: { targetEmail: targetUser.email } });
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

router.get("/roles/check/:userId", async (req: Request<{ userId: string }>, res: Response) => {
  try {
    const admin = await isClawAdmin(req.params.userId);
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
    const logs = await auditLogRepository.list({ eventType, targetId, limit, offset });
    res.json({ success: true, data: logs });
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

export { router as adminRouter };
