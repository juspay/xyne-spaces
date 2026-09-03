import { Request, Response } from 'express';
import { DatabaseClient } from '../database/client';
import { logger } from '../utils/logger';

const db = DatabaseClient.getInstance();

export class PrAnalyticsController {
  async getBotCommitAnalytics(req: Request, res: Response): Promise<void> {
    try {
      const workspaceId = req.headers['x-workspace-id'] as string;
      const days = parseInt(req.query.days as string) || 7;

      if (!workspaceId) {
        res.status(400).json({ error: 'x-workspace-id header is required' });
        return;
      }

      const windowEnd = new Date();
      const windowStart = new Date(windowEnd.getTime() - days * 24 * 60 * 60 * 1000);

      // Get per-agent statistics for merged PRs that had bot commits
      const agentStats = await db.$queryRaw<
        Array<{
          agent_slug: string;
          merged_prs: bigint;
          total_commits: bigint;
        }>
      >`
        SELECT
          c."agentSlug" as agent_slug,
          COUNT(DISTINCT pr.id)::bigint as merged_prs,
          COUNT(c.id)::bigint as total_commits
        FROM commits c
        INNER JOIN pull_requests pr ON c."pullRequestId" = pr.id
        WHERE c."agentSlug" IS NOT NULL
          AND pr.status = 'MERGED'
          AND pr."commitAnalysisStatus" = 'COMPLETED'
          AND pr."date" >= ${windowStart}
          AND pr."date" < ${windowEnd}
          AND pr."workspaceId" = ${workspaceId}
        GROUP BY c."agentSlug"
        ORDER BY merged_prs DESC, total_commits DESC
      `;

      // Get PR analysis status counts
      const analysisStatus = await db.$queryRaw<
        Array<{
          commitAnalysisStatus: string | null;
          count: bigint;
        }>
      >`
        SELECT
          "commitAnalysisStatus",
          COUNT(*)::bigint as count
        FROM "pull_requests"
        WHERE "date" >= ${windowStart}
          AND "date" < ${windowEnd}
          AND "workspaceId" = ${workspaceId}
        GROUP BY "commitAnalysisStatus"
      `;

      // Process results
      const rows = agentStats.map((r) => ({
        agentSlug: r.agent_slug,
        mergedPRs: Number(r.merged_prs),
        totalCommits: Number(r.total_commits),
      }));

      const totalAnalyzed = analysisStatus
        .filter((r) => r.commitAnalysisStatus === 'COMPLETED')
        .reduce((sum, r) => sum + Number(r.count), 0);

      const totalPending = analysisStatus
        .filter((r) => r.commitAnalysisStatus === 'PENDING')
        .reduce((sum, r) => sum + Number(r.count), 0);

      const totalFailed = analysisStatus
        .filter((r) => r.commitAnalysisStatus === 'FAILED')
        .reduce((sum, r) => sum + Number(r.count), 0);

      res.json({
        rows,
        totalAnalyzed,
        totalPending,
        totalFailed,
      });
    } catch (error) {
      logger.error('[PrAnalyticsController] Error fetching bot commit analytics:', error);
      res.status(500).json({ error: 'Failed to fetch bot commit analytics' });
    }
  }
}
