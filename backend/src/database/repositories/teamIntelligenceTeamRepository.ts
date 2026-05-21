import { db } from '@/database/client';

export interface TeamBulletsDateRangeFilters {
  from: Date;
  to: Date;
  teamName: string;
  page: number;
  limit: number;
}

export interface TeamBulletsDateRangeResult {
  from: string;
  to: string;
  teamName: string;
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  bullets: Record<string, unknown>[];
}

export interface TeamPrByDateFilters {
  from: Date;
  to: Date;
  prId: number;
}

export interface TeamPrMatch {
  userEmail: string;
  userName: string;
  teamName: string | null;
  reportDate: string;
  pullRequest: Record<string, unknown>;
}

export interface TeamPrByDateResult {
  from: string;
  to: string;
  prId: number;
  total: number;
  matches: TeamPrMatch[];
}

export interface TeamUsageSummaryFilters {
  from: Date;
  to: Date;
  teamName: string;
}

export interface TeamAiUsageAggregate {
  total_tokens: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_spend: number;
  currency: string;
}

export interface TeamUsageSummaryResult {
  from: string;
  to: string;
  teamName: string;
  totalPrCount: number;
  totalCommitCount: number;
  aiUsages: TeamAiUsageAggregate;
}

class TeamIntelligenceTeamRepository {
  async getTeamBulletsByDate(filters: TeamBulletsDateRangeFilters): Promise<TeamBulletsDateRangeResult> {
    const { from, to, teamName, page, limit } = filters;

    const rangeStart = new Date(from);
    rangeStart.setUTCHours(0, 0, 0, 0);

    const rangeEnd = new Date(to);
    rangeEnd.setUTCHours(23, 59, 59, 999);

    const teamSummaries = await db.teamIntelligenceTeamSummary.findMany({
      where: {
        reportDate: { gte: rangeStart, lte: rangeEnd },
        teamName: {
          equals: teamName,
          mode: 'insensitive',
        },
      },
      orderBy: [{ reportDate: 'desc' }, { createdAt: 'desc' }],
      select: {
        teamName: true,
        reportDate: true,
        provenance: true,
      },
    });

    const bullets: Record<string, unknown>[] = [];

    for (const teamSummary of teamSummaries) {
      const provenance = teamSummary.provenance as Record<string, unknown> | null;
      const provenanceBullets = provenance?.bullets;

      if (!Array.isArray(provenanceBullets)) {
        continue;
      }

      for (const bullet of provenanceBullets) {
        if (bullet && typeof bullet === 'object' && !Array.isArray(bullet)) {
          bullets.push({
            teamName: teamSummary.teamName,
            reportDate: teamSummary.reportDate.toISOString().slice(0, 10),
            ...(bullet as Record<string, unknown>),
          });
        }
      }
    }

    const total = bullets.length;
    const totalPages = total === 0 ? 0 : Math.ceil(total / limit);
    const start = (page - 1) * limit;
    const end = start + limit;
    const paginatedBullets = bullets.slice(start, end);

    return {
      from: rangeStart.toISOString().slice(0, 10),
      to: rangeEnd.toISOString().slice(0, 10),
      teamName,
      page,
      limit,
      total,
      totalPages,
      bullets: paginatedBullets,
    };
  }

  async getPrByDate(filters: TeamPrByDateFilters): Promise<TeamPrByDateResult> {
    const { from, to, prId } = filters;

    const rangeStart = new Date(from);
    rangeStart.setUTCHours(0, 0, 0, 0);

    const rangeEnd = new Date(to);
    rangeEnd.setUTCHours(23, 59, 59, 999);

    const userIngestions = await db.teamIntelligenceUserIngestion.findMany({
      where: {
        reportDate: { gte: rangeStart, lte: rangeEnd },
      },
      orderBy: [{ reportDate: 'desc' }, { updatedAt: 'desc' }],
      select: {
        userEmail: true,
        userName: true,
        teamName: true,
        reportDate: true,
        pullRequests: true,
      },
    });

    const matches: TeamPrMatch[] = [];

    for (const ingestion of userIngestions) {
      const pullRequests = Array.isArray(ingestion.pullRequests)
        ? (ingestion.pullRequests as Array<Record<string, unknown>>)
        : [];

      for (const pr of pullRequests) {
        const prIdValue = pr.prId;
        if (typeof prIdValue !== 'number' || prIdValue !== prId) {
          continue;
        }

        matches.push({
          userEmail: ingestion.userEmail,
          userName: ingestion.userName,
          teamName: ingestion.teamName,
          reportDate: ingestion.reportDate.toISOString().slice(0, 10),
          pullRequest: {
            ...pr,
            userEmail: ingestion.userEmail,
            userName: ingestion.userName,
          },
        });
      }
    }

    return {
      from: rangeStart.toISOString().slice(0, 10),
      to: rangeEnd.toISOString().slice(0, 10),
      prId,
      total: matches.length,
      matches,
    };
  }

  async getTeamUsageSummary(filters: TeamUsageSummaryFilters): Promise<TeamUsageSummaryResult> {
    const { from, to, teamName } = filters;

    const rangeStart = new Date(from);
    rangeStart.setUTCHours(0, 0, 0, 0);

    const rangeEnd = new Date(to);
    rangeEnd.setUTCHours(23, 59, 59, 999);

    const userIngestions = await db.teamIntelligenceUserIngestion.findMany({
      where: {
        reportDate: { gte: rangeStart, lte: rangeEnd },
        teamName: {
          equals: teamName,
          mode: 'insensitive',
        },
      },
      select: {
        pullRequests: true,
        aiUsage: true,
      },
    });

    const aiUsages: TeamAiUsageAggregate = {
      total_tokens: 0,
      prompt_tokens: 0,
      completion_tokens: 0,
      total_spend: 0,
      currency: 'USD',
    };

    let totalPrCount = 0;
    let totalCommitCount = 0;

    for (const user of userIngestions) {
      const prs = Array.isArray(user.pullRequests)
        ? (user.pullRequests as Array<{ commits?: Array<Record<string, unknown>> }> )
        : [];

      totalPrCount += prs.length;

      for (const pr of prs) {
        const commits = Array.isArray(pr.commits) ? pr.commits : [];
        totalCommitCount += commits.length;
      }

      const usage = user.aiUsage as Partial<TeamAiUsageAggregate> | null;
      if (usage && typeof usage === 'object') {
        aiUsages.total_tokens += Number(usage.total_tokens ?? 0);
        aiUsages.prompt_tokens += Number(usage.prompt_tokens ?? 0);
        aiUsages.completion_tokens += Number(usage.completion_tokens ?? 0);
        aiUsages.total_spend += Number(usage.total_spend ?? 0);
        if (typeof usage.currency === 'string' && usage.currency.trim()) {
          aiUsages.currency = usage.currency.trim();
        }
      }
    }

    aiUsages.total_spend = Math.round(aiUsages.total_spend * 1_000_000) / 1_000_000;

    return {
      from: rangeStart.toISOString().slice(0, 10),
      to: rangeEnd.toISOString().slice(0, 10),
      teamName,
      totalPrCount,
      totalCommitCount,
      aiUsages,
    };
  }
}

export const teamIntelligenceTeamRepository = new TeamIntelligenceTeamRepository();
