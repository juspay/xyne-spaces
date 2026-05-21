import { db } from '@/database/client';

export interface OrgSummaryDateRangeFilters {
  from: Date;
  to: Date;
}

export interface AiUsageAggregate {
  total_tokens: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_spend: number;
  currency: string;
}

export interface OrgDashboardSummary {
  orgSummary: string[];
  prMerged: string[];
  aiUsages: AiUsageAggregate;
}

export interface OrgBulletsByDateFilters {
  from: Date;
  to: Date;
  page: number;
  limit: number;
}

export interface OrgBulletsByDateResult {
  from: string;
  to: string;
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  bullets: Record<string, unknown>[];
}

export interface OrgTeamsDateRangeFilters {
  from: Date;
  to: Date;
}

export interface OrgTeamAggregate {
  teamName: string;
  summaryText: string[];
  prCount: number;
  commitCount: number;
}

export interface OrgTeamsDateRangeResult {
  from: string;
  to: string;
  teams: OrgTeamAggregate[];
}

const ORG_BULLET_CATEGORIES = new Set([
  'shipped',
  'achievement',
  'collaboration',
  'learning',
  'recognition',
  'learned',
  'helped',
  'milestone',
]);

function inferBulletCategory(text: string): string {
  const normalized = text.toLowerCase();

  if (/\bshipped\b|\breleased\b|\bdelivered\b|\blaunched\b/.test(normalized)) {
    return 'shipped';
  }
  if (/\bcollaborat|\bpartnered|\bcross[- ]?team|\baligned\b/.test(normalized)) {
    return 'collaboration';
  }
  if (/\blearned\b/.test(normalized)) {
    return 'learned';
  }
  if (/\blearning\b|\blearn\b|\bexplored\b/.test(normalized)) {
    return 'learning';
  }
  if (/\brecognized\b|\brecognition\b|\bawarded\b|\bpraised\b/.test(normalized)) {
    return 'recognition';
  }
  if (/\bhelped\b|\bsupported\b|\bassisted\b|\bunblocked\b/.test(normalized)) {
    return 'helped';
  }
  if (/\bmilestone\b|\bphase\b|\brollout\b|\bgo[- ]live\b/.test(normalized)) {
    return 'milestone';
  }

  return 'achievement';
}

function normalizeComparableText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

function isTitleTooSimilarToText(title: string, text: string): boolean {
  const normalizedTitle = normalizeComparableText(title);
  const normalizedText = normalizeComparableText(text);

  if (!normalizedTitle || !normalizedText) {
    return true;
  }

  return normalizedTitle === normalizedText || normalizedText.includes(normalizedTitle);
}

function buildBulletTitle(text: string): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  if (!compact) {
    return 'Team Update';
  }

  const clean = compact.replace(/[.!?]+$/g, '');
  const words = clean.split(' ').filter(Boolean);
  const concise = words.slice(0, 8).join(' ');
  return concise || 'Team Update';
}

class TeamIntelligenceOrgRepository {
  /**
   * Returns org summaries list + aggregated merged PRs + aggregated AI usage
   * for all batches whose reportDate falls within [from, to] (inclusive).
   */
  async getDashboardSummary(filters: OrgSummaryDateRangeFilters): Promise<OrgDashboardSummary> {
    const { from, to } = filters;

    // Extend to to end-of-day so the "to" date is fully inclusive
    const toEndOfDay = new Date(to);
    toEndOfDay.setUTCHours(23, 59, 59, 999);

    const [orgSummaries, userIngestions] = await Promise.all([
      db.teamIntelligenceOrgSummary.findMany({
        where: {
          reportDate: { gte: from, lte: toEndOfDay },
        },
        orderBy: { reportDate: 'desc' },
      }),
      db.teamIntelligenceUserIngestion.findMany({
        where: {
          reportDate: { gte: from, lte: toEndOfDay },
        },
        select: {
          pullRequests: true,
          aiUsage: true,
        },
      }),
    ]);

    const orgSummary: string[] = [];
    const prMerged: string[] = [];

    for (const org of orgSummaries) {
      const summaries = org.summaryText as unknown;
      if (Array.isArray(summaries)) {
        for (const summary of summaries) {
          if (typeof summary === 'string' && summary.trim()) {
            orgSummary.push(summary.trim());
          }
        }
      }
    }

    const aiAgg: AiUsageAggregate = {
      total_tokens: 0,
      prompt_tokens: 0,
      completion_tokens: 0,
      total_spend: 0,
      currency: 'USD',
    };

    for (const user of userIngestions) {
      const prs = user.pullRequests as Array<{
        prState?: string;
        prSummary?: string;
        prTitle?: string;
      }>;
      if (Array.isArray(prs)) {
        for (const pr of prs) {
          if (pr.prState !== 'merged') {
            continue;
          }

          const summary =
            typeof pr.prSummary === 'string' && pr.prSummary.trim()
              ? pr.prSummary.trim()
              : typeof pr.prTitle === 'string' && pr.prTitle.trim()
                ? pr.prTitle.trim()
                : '';

          if (summary) {
            prMerged.push(summary);
          }
        }
      }

      const usage = user.aiUsage as Partial<AiUsageAggregate> | null;
      if (usage && typeof usage === 'object') {
        aiAgg.total_tokens += Number(usage.total_tokens ?? 0);
        aiAgg.prompt_tokens += Number(usage.prompt_tokens ?? 0);
        aiAgg.completion_tokens += Number(usage.completion_tokens ?? 0);
        aiAgg.total_spend += Number(usage.total_spend ?? 0);
        if (typeof usage.currency === 'string' && usage.currency.trim()) {
          aiAgg.currency = usage.currency.trim();
        }
      }
    }

    // Round spend to 6 decimal places to avoid floating-point noise
    aiAgg.total_spend = Math.round(aiAgg.total_spend * 1_000_000) / 1_000_000;

    return { orgSummary, prMerged, aiUsages: aiAgg };
  }

  /**
   * Returns all provenance.bullets from org summaries for a date range,
   * flattened into a single array and paginated.
   */
  async getOrgBulletsByDate(filters: OrgBulletsByDateFilters): Promise<OrgBulletsByDateResult> {
    const { from, to, page, limit } = filters;

    const rangeStart = new Date(from);
    rangeStart.setUTCHours(0, 0, 0, 0);

    const rangeEnd = new Date(to);
    rangeEnd.setUTCHours(23, 59, 59, 999);

    const orgSummaries = await db.teamIntelligenceOrgSummary.findMany({
      where: {
        reportDate: { gte: rangeStart, lte: rangeEnd },
      },
      orderBy: [{ reportDate: 'desc' }, { createdAt: 'desc' }],
      select: {
        provenance: true,
      },
    });

    const allBullets: Record<string, unknown>[] = [];

    for (const orgSummary of orgSummaries) {
      const provenance = orgSummary.provenance as Record<string, unknown> | null;
      const bullets = provenance?.bullets;

      if (!Array.isArray(bullets)) {
        continue;
      }

      for (const bullet of bullets) {
        if (bullet && typeof bullet === 'object' && !Array.isArray(bullet)) {
          const bulletObj = bullet as Record<string, unknown>;
          const bulletText = typeof bulletObj.bulletText === 'string' ? bulletObj.bulletText.trim() : '';
          const rawTitle = typeof bulletObj.bulletTitle === 'string' && bulletObj.bulletTitle.trim()
            ? bulletObj.bulletTitle.trim()
            : buildBulletTitle(bulletText);
          const bulletTitle = isTitleTooSimilarToText(rawTitle, bulletText)
            ? buildBulletTitle(bulletText)
            : rawTitle;
          const bulletCatRaw = typeof bulletObj.bulletCat === 'string' ? bulletObj.bulletCat.trim().toLowerCase() : '';
          const bulletCat = ORG_BULLET_CATEGORIES.has(bulletCatRaw)
            ? bulletCatRaw
            : inferBulletCategory(bulletText);

          allBullets.push({
            ...bulletObj,
            bulletTitle,
            bulletCat,
          });
        }
      }
    }

    const total = allBullets.length;
    const totalPages = total === 0 ? 0 : Math.ceil(total / limit);
    const start = (page - 1) * limit;
    const end = start + limit;
    const bullets = allBullets.slice(start, end);

    return {
      from: rangeStart.toISOString().slice(0, 10),
      to: rangeEnd.toISOString().slice(0, 10),
      page,
      limit,
      total,
      totalPages,
      bullets,
    };
  }

  async getOrgTeamsByDate(filters: OrgTeamsDateRangeFilters): Promise<OrgTeamsDateRangeResult> {
    const { from, to } = filters;

    const rangeStart = new Date(from);
    rangeStart.setUTCHours(0, 0, 0, 0);

    const rangeEnd = new Date(to);
    rangeEnd.setUTCHours(23, 59, 59, 999);

    const [teamSummaries, userIngestions] = await Promise.all([
      db.teamIntelligenceTeamSummary.findMany({
        where: {
          reportDate: { gte: rangeStart, lte: rangeEnd },
        },
        orderBy: [{ teamName: 'asc' }, { reportDate: 'asc' }],
        select: {
          teamName: true,
          summaryText: true,
        },
      }),
      db.teamIntelligenceUserIngestion.findMany({
        where: {
          reportDate: { gte: rangeStart, lte: rangeEnd },
        },
        orderBy: [{ teamName: 'asc' }, { userEmail: 'asc' }],
        select: {
          teamName: true,
          pullRequests: true,
        },
      }),
    ]);

    const aggregateMap = new Map<string, OrgTeamAggregate>();

    const getOrCreateTeam = (teamName: string): OrgTeamAggregate => {
      const existing = aggregateMap.get(teamName);
      if (existing) {
        return existing;
      }

      const created: OrgTeamAggregate = {
        teamName,
        summaryText: [],
        prCount: 0,
        commitCount: 0,
      };
      aggregateMap.set(teamName, created);
      return created;
    };

    for (const teamSummary of teamSummaries) {
      const teamName = teamSummary.teamName.trim();
      if (!teamName) {
        continue;
      }

      const aggregate = getOrCreateTeam(teamName);
      const summaries = teamSummary.summaryText as unknown;
      if (Array.isArray(summaries)) {
        for (const summary of summaries) {
          if (typeof summary === 'string' && summary.trim()) {
            aggregate.summaryText.push(summary.trim());
          }
        }
      }
    }

    for (const user of userIngestions) {
      const teamName = typeof user.teamName === 'string' ? user.teamName.trim() : '';
      if (!teamName) {
        continue;
      }

      const aggregate = getOrCreateTeam(teamName);
      const prs = Array.isArray(user.pullRequests)
        ? (user.pullRequests as Array<{
            commits?: Array<Record<string, unknown>>;
          }>)
        : [];

      aggregate.prCount += prs.length;

      for (const pr of prs) {
        const commits = Array.isArray(pr.commits) ? pr.commits : [];
        aggregate.commitCount += commits.length;
      }
    }

    const teams = [...aggregateMap.values()].sort((left, right) => left.teamName.localeCompare(right.teamName));

    return {
      from: rangeStart.toISOString().slice(0, 10),
      to: rangeEnd.toISOString().slice(0, 10),
      teams,
    };
  }
}

export const teamIntelligenceOrgRepository = new TeamIntelligenceOrgRepository();
