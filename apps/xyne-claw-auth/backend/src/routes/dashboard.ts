import { Router, type Request, type Response } from "express";
import { asyncHandler, ok, unauthorized } from "../lib/http.js";
import { getRequesterId } from "../middleware/agent-acl.js";
import { agentRunRepository, agentRepository } from "../repositories/index.js";
import { windowFromDays } from "../lib/time-window.js";

import { createLogger } from "../logger.js";
const log = createLogger("dashboard");

const router = Router();

/**
 * GET /api/v1/dashboard?days=30
 * Auth-only (no admin check). Returns a self-scoped analytics payload.
 */
router.get("/", asyncHandler(async (req: Request, res: Response) => {
  const userId = getRequesterId(req);
  if (!userId) {
    throw unauthorized();
  }

  const window = windowFromDays(req.query["days"] ?? "30");
  const cutoff = window?.start ?? null;

  const [overview, runStats, ratingStats, timeSeries, triggerSources, ownedPersonalAgents] =
    await Promise.all([
      agentRunRepository.userOverviewStats(userId, cutoff),
      agentRunRepository.runStatsByAgentForUser(userId, cutoff),
      agentRunRepository.ratingStatsByAgentForUser(userId, cutoff),
      agentRunRepository.runTimeSeriesForUser(userId, window),
      agentRunRepository.triggerSourceStatsForUser(userId, cutoff),
      agentRepository.listPersonalAgentsByOwners([userId]),
    ]);

  // Fetch ALL agent metadata (to include global agents regardless of run history)
  const allAgentMeta = await agentRepository.listForDashboard();
  const metaBySlug = new Map(allAgentMeta.map((a) => [a.slug, a]));

  const runSlugs = new Set(runStats.map((r) => r.agentSlug));
  const ownedSlugs = new Set(ownedPersonalAgents.map((a) => a.slug));
  const globalSlugs = new Set(
    allAgentMeta.filter((a) => a.scope === "global").map((a) => a.slug),
  );

  // Visible inventory = global ∪ owned-personal ∪ ran (catch-all for shared/deleted)
  const visibleSlugs = new Set<string>([...globalSlugs, ...ownedSlugs, ...runSlugs]);

  const ratingBySlug = new Map(ratingStats.map((r) => [r.agentSlug, r]));
  const runStatsBySlug = new Map(runStats.map((r) => [r.agentSlug, r]));

  const buildRow = (slug: string) => {
    const run = runStatsBySlug.get(slug);
    const rating = ratingBySlug.get(slug);
    const meta = metaBySlug.get(slug);
    const owned = ownedSlugs.has(slug);
    return {
      agentSlug: slug,
      agentName: meta?.name ?? slug,
      agentScope: (meta?.scope ?? null) as "global" | "personal" | null,
      agentEnabled: meta?.enabled ?? null,
      agentRegistered: meta?.spacesAppId != null,
      owned,
      totalRuns: run?.totalRuns ?? 0,
      completedRuns: run?.completedRuns ?? 0,
      failedRuns: run?.failedRuns ?? 0,
      avgDurationMs: run?.avgDurationMs ?? null,
      totalTokensIn: run?.totalTokensIn ?? 0,
      totalTokensOut: run?.totalTokensOut ?? 0,
      lastRunAt: run?.lastRunAt ?? null,
      upCount: rating?.upCount ?? 0,
      downCount: rating?.downCount ?? 0,
      ratedCount: rating?.ratedCount ?? 0,
      negativeRate: rating?.negativeRate ?? 0,
    };
  };

  // Build table from visible inventory (global ∪ owned ∪ ran)
  const agentTable = [...visibleSlugs].map((slug) => buildRow(slug));

  // Personal agent inventory stats for the user
  const personalAgentStats = {
    total: ownedPersonalAgents.length,
    enabled: ownedPersonalAgents.filter((a) => a.enabled).length,
    disabled: ownedPersonalAgents.filter((a) => !a.enabled).length,
    registered: ownedPersonalAgents.filter((a) => a.spacesAppId != null).length,
    notRegistered: ownedPersonalAgents.filter((a) => a.spacesAppId == null).length,
  };

  ok(res, {
    scope: "user",
    userId,
    overview,
    timeSeries,
    triggerSources,
    agentTable,
    personalAgentStats,
  });
}));

export { router as dashboardRouter };
