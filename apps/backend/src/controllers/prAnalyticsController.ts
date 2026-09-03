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

      // Categorize and aggregate PRs by bot attribution
      const categorizedPRs = await db.$queryRaw<
        Array<{
          category: 'bot-only' | 'human-only' | 'mixed';
          total_prs: bigint;
          merged_prs: bigint;
          rejected_prs: bigint;
        }>
      >`
        WITH categorized_prs AS (
          SELECT
            id,
            status,
            CASE
              WHEN "botCommitCount" > 0 AND "humanCommitCount" = 0 THEN 'bot-only'
              WHEN "botCommitCount" = 0 AND "humanCommitCount" > 0 THEN 'human-only'
              WHEN "botCommitCount" > 0 AND "humanCommitCount" > 0 THEN 'mixed'
            END as category
          FROM "pull_requests"
          WHERE "commitAnalysisStatus" = 'COMPLETED'
            AND "date" >= ${windowStart}
            AND "date" < ${windowEnd}
            AND "workspaceId" = ${workspaceId}
        )
        SELECT
          category,
          COUNT(*)::bigint as total_prs,
          SUM(CASE WHEN status = 'MERGED' THEN 1 ELSE 0 END)::bigint as merged_prs,
          SUM(CASE WHEN status IN ('DECLINED', 'CLOSED') THEN 1 ELSE 0 END)::bigint as rejected_prs
        FROM categorized_prs
        WHERE category IS NOT NULL
        GROUP BY category
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
      const rows = categorizedPRs.map((r) => {
        const totalPRs = Number(r.total_prs);
        const mergedPRs = Number(r.merged_prs);
        return {
          category: r.category,
          totalPRs,
          mergedPRs,
          rejectedPRs: Number(r.rejected_prs),
          mergeRate: totalPRs > 0 ? mergedPRs / totalPRs : 0,
        };
      });

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
        days,
        windowStart: windowStart.toISOString(),
        windowEnd: windowEnd.toISOString(),
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
