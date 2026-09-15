import { db } from '@/database/client';
import { teamIntelligenceContentStorageService } from '@/team-intelligence/services/team-intelligence-content-storage.service';
import {
  TeamIntelligenceOrgLeadershipSummarySchema,
  type TeamIntelligenceOrgLeadershipSummary,
} from '@/team-intelligence/org-leadership-summary.schema';
import { logger } from '@/utils/logger';

export interface OrgSummaryDateRangeFilters {
  from: Date;
  to: Date;
  orgId?: string | null;
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
  prTotal: string[];
  aiUsages: AiUsageAggregate;
}

export interface OrgBulletsByDateFilters {
  from: Date;
  to: Date;
  page: number;
  limit: number;
  orgId?: string | null;
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
  orgId?: string | null;
}

export interface OrgTeamAggregate {
  teamId: string;
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

export interface OrgLeadershipSnapshotsResult {
  from: string;
  to: string;
  snapshots: Array<{
    id: string;
    batchId: string;
    reportDate: string;
    source: string;
    completedAt: string | null;
    summary: TeamIntelligenceOrgLeadershipSummary;
  }>;
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

// Default concurrency for hydrating stored JSON payloads. Extracted from magic numbers.
const DEFAULT_HYDRATION_CONCURRENCY = 8;

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
  private async mapWithConcurrency<T, U>(
    items: T[],
    fn: (item: T) => Promise<U>,
    concurrency = DEFAULT_HYDRATION_CONCURRENCY,
  ): Promise<(U | null)[]> {
    const results: (U | null)[] = new Array(items.length).fill(null);
    let idx = 0;

    const worker = async () => {
      while (idx < items.length) {
        const i = idx++;
        if (i >= items.length) break;
        try {
          results[i] = await fn(items[i]);
        } catch (err) {
          try {
            logger.warn('[TEAM-INTEL] mapWithConcurrency worker failed', {
              index: i,
              itemType: typeof items[i],
              error: err,
            });
          } catch {
            // Swallow logging errors to avoid interfering with main flow
          }
          results[i] = null;
        }
      }
    };

    const workers: Promise<void>[] = [];
    const workerCount = Math.min(concurrency, items.length);
    for (let w = 0; w < workerCount; w++) {
      workers.push(worker());
    }

    await Promise.all(workers);
    return results;
  }

  /**
   * Returns org summaries list + aggregated merged PRs + aggregated AI usage
   * for all batches whose reportDate falls within [from, to] (inclusive).
   */
  async getDashboardSummary(filters: OrgSummaryDateRangeFilters): Promise<OrgDashboardSummary> {
    const { from, to, orgId } = filters;

    // Extend to to end-of-day so the "to" date is fully inclusive
    const toEndOfDay = new Date(to);
    toEndOfDay.setUTCHours(23, 59, 59, 999);

    const [orgSummaries, userIngestions] = await Promise.all([
      db.teamIntelligenceOrgSummaryV2.findMany({
        where: {
          reportDate: { gte: from, lte: toEndOfDay },
          ...(orgId ? { orgId } : {}),
        },
        orderBy: { reportDate: 'desc' },
        select: {
          contentUrl: true,
        },
      }),
      db.teamIntelligenceUserIngestionV2.findMany({
        where: {
          reportDate: { gte: from, lte: toEndOfDay },
          ...(orgId ? { orgId } : {}),
        },
        select: {
          contentUrl: true,
          aiUsage: true,
        },
      }),
    ]);

    const orgSummary: string[] = [];
    const prTotal: string[] = [];

    const orgContents = await this.mapWithConcurrency(
      orgSummaries,
      async (org) =>
        teamIntelligenceContentStorageService.hydrateJsonPayload<{
          summaryText?: unknown[];
        }>(null, org.contentUrl),
      DEFAULT_HYDRATION_CONCURRENCY,
    );

    for (const content of orgContents) {
      const summaries = content?.summaryText as unknown;
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

    const userContents = await this.mapWithConcurrency(
      userIngestions,
      async (user) =>
        teamIntelligenceContentStorageService.hydrateJsonPayload<{
          pullRequests?: unknown[];
        }>(null, user.contentUrl),
      DEFAULT_HYDRATION_CONCURRENCY,
    );

    for (let i = 0; i < userIngestions.length; i++) {
      const user = userIngestions[i];
      const content = userContents[i] ?? null;
      const prs = (content?.pullRequests ?? []) as Array<{
        prState?: string;
        prSummary?: string;
        prTitle?: string;
      }>;

      if (Array.isArray(prs)) {
        for (const pr of prs) {
          const summary =
            typeof pr.prSummary === 'string' && pr.prSummary.trim()
              ? pr.prSummary.trim()
              : typeof pr.prTitle === 'string' && pr.prTitle.trim()
                ? pr.prTitle.trim()
                : '';

          if (summary) {
            prTotal.push(summary);
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

    return { orgSummary, prTotal, aiUsages: aiAgg };
  }

  async getOrgLeadershipSnapshotsByDate(filters: {
    orgId: string;
    from: Date;
    to: Date;
  }): Promise<OrgLeadershipSnapshotsResult> {
    const { orgId, from, to } = filters;
    const toEndOfDay = new Date(to);
    toEndOfDay.setUTCHours(23, 59, 59, 999);

    const rows = await db.teamIntelligenceOrgSummaryV2.findMany({
      where: {
        orgId,
        reportDate: { gte: from, lte: toEndOfDay },
        status: 'COMPLETED',
        contentUrl: { not: null },
      },
      orderBy: [{ reportDate: 'desc' }, { completedAt: 'desc' }],
      select: {
        id: true,
        batchId: true,
        reportDate: true,
        source: true,
        completedAt: true,
        contentUrl: true,
      },
    });

    const hydrated = await this.mapWithConcurrency(
      rows,
      async (row) => {
        const content =
          await teamIntelligenceContentStorageService.hydrateJsonPayload<{
            orgSummary?: unknown;
          }>(null, row.contentUrl);
        const parsed = TeamIntelligenceOrgLeadershipSummarySchema.safeParse(
          content?.orgSummary
        );
        if (!parsed.success) {
          logger.warn(
            '[TEAM-INTEL] Ignoring completed org summary with invalid structured content',
            {
              orgSummaryId: row.id,
              error: parsed.error.message,
            }
          );
          return null;
        }
        return {
          id: row.id,
          batchId: row.batchId,
          reportDate: row.reportDate.toISOString().slice(0, 10),
          source: row.source,
          completedAt: row.completedAt?.toISOString() ?? null,
          summary: parsed.data,
        };
      },
      DEFAULT_HYDRATION_CONCURRENCY
    );

    return {
      from: from.toISOString().slice(0, 10),
      to: toEndOfDay.toISOString().slice(0, 10),
      snapshots: hydrated.filter(
        (
          snapshot
        ): snapshot is NonNullable<(typeof hydrated)[number]> =>
          snapshot !== null
      ),
    };
  }

  /**
   * Returns all provenance.bullets from org summaries for a date range,
   * flattened into a single array and paginated.
   */
  async getOrgBulletsByDate(filters: OrgBulletsByDateFilters): Promise<OrgBulletsByDateResult> {
    const { from, to, page, limit, orgId } = filters;

    const rangeStart = new Date(from);
    rangeStart.setUTCHours(0, 0, 0, 0);

    const rangeEnd = new Date(to);
    rangeEnd.setUTCHours(23, 59, 59, 999);

    const orgSummaries = await db.teamIntelligenceOrgSummaryV2.findMany({
      where: {
        reportDate: { gte: rangeStart, lte: rangeEnd },
        ...(orgId ? { orgId } : {}),
      },
      orderBy: [{ reportDate: 'desc' }, { createdAt: 'desc' }],
      select: {
        contentUrl: true,
      },
    });

    const allBullets: Record<string, unknown>[] = [];

    for (const orgSummary of orgSummaries) {
      const content = await teamIntelligenceContentStorageService.hydrateJsonPayload<{
        provenance?: Record<string, unknown>;
      }>(null, orgSummary.contentUrl);
      const provenance = content?.provenance ?? null;
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
    const { from, to, orgId } = filters;

    const rangeStart = new Date(from);
    rangeStart.setUTCHours(0, 0, 0, 0);

    const rangeEnd = new Date(to);
    rangeEnd.setUTCHours(23, 59, 59, 999);

    const [teamSummaries, userIngestions] = await Promise.all([
      db.teamIntelligenceTeamSummaryV2.findMany({
        where: {
          reportDate: { gte: rangeStart, lte: rangeEnd },
          ...(orgId ? { orgId } : {}),
        },
        orderBy: [{ teamName: 'asc' }, { reportDate: 'asc' }],
        select: {
          teamId: true,
          teamName: true,
          contentUrl: true,
        },
      }),
      db.teamIntelligenceUserIngestionV2.findMany({
        where: {
          reportDate: { gte: rangeStart, lte: rangeEnd },
          ...(orgId ? { orgId } : {}),
        },
        orderBy: [{ teamName: 'asc' }, { userEmail: 'asc' }],
        select: {
          teamId: true,
          teamName: true,
          contentUrl: true,
        },
      }),
    ]);

    const aggregateMap = new Map<string, OrgTeamAggregate>();

    const getOrCreateTeam = (teamId: string, teamName: string): OrgTeamAggregate => {
      const existing = aggregateMap.get(teamId);
      if (existing) {
        if (teamName) {
          existing.teamName = teamName;
        }
        return existing;
      }

      const created: OrgTeamAggregate = {
        teamId,
        teamName,
        summaryText: [],
        prCount: 0,
        commitCount: 0,
      };
      aggregateMap.set(teamId, created);
      return created;
    };

    const teamContents = await this.mapWithConcurrency(
      teamSummaries,
      async (teamSummary) =>
        teamIntelligenceContentStorageService.hydrateJsonPayload<{
          summaryText?: unknown[];
        }>(null, teamSummary.contentUrl),
      DEFAULT_HYDRATION_CONCURRENCY,
    );

    for (let i = 0; i < teamSummaries.length; i++) {
      const teamSummary = teamSummaries[i];
      const teamId = typeof teamSummary.teamId === 'string' ? teamSummary.teamId.trim() : '';
      const teamName = teamSummary.teamName.trim();
      if (!teamId) {
        continue;
      }

      const aggregate = getOrCreateTeam(teamId, teamName || 'No Team');
      const content = teamContents[i] ?? null;
      const summaries = content?.summaryText as unknown;
      if (Array.isArray(summaries)) {
        for (const summary of summaries) {
          if (typeof summary === 'string' && summary.trim()) {
            aggregate.summaryText.push(summary.trim());
          }
        }
      }
    }

    const userContents = await this.mapWithConcurrency(
      userIngestions,
      async (user) =>
        teamIntelligenceContentStorageService.hydrateJsonPayload<{
          pullRequests?: unknown[];
        }>(null, user.contentUrl),
      DEFAULT_HYDRATION_CONCURRENCY,
    );

    for (let i = 0; i < userIngestions.length; i++) {
      const user = userIngestions[i];
      const teamId = typeof user.teamId === 'string' ? user.teamId.trim() : '';
      const teamName = typeof user.teamName === 'string' ? user.teamName.trim() : '';
      if (!teamId) {
        continue;
      }

      const aggregate = getOrCreateTeam(teamId, teamName || 'No Team');
      const content = userContents[i] ?? null;
      const prs = Array.isArray(content?.pullRequests)
        ? (content!.pullRequests as Array<{
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

  async getOrgChannelRecaps({
    from,
    to,
    page,
    limit,
    workspaceId,
  }: {
    from: Date;
    to: Date;
    page: number;
    limit: number;
    workspaceId: string;
  }) {
    const rangeStart = new Date(from);
    rangeStart.setUTCHours(0, 0, 0, 0);

    const rangeEnd = new Date(to);
    rangeEnd.setUTCHours(23, 59, 59, 999);

    const now = new Date();

    // Fetch workspace channels first so tickets can be scoped by channelId
    const channels = await db.channel.findMany({
      where: { workspaceId },
      select: { id: true, name: true },
    });
    const workspaceChannelIds = channels.map((c) => c.id);

    const [total, recaps, ticketRecords] = await Promise.all([
      db.recap.count({
        where: {
          workspaceId,
          entityType: 'CHANNEL',
          recapDate: { gte: rangeStart, lte: rangeEnd },
        },
      }),
      db.recap.findMany({
        where: {
          workspaceId,
          entityType: 'CHANNEL',
          recapDate: { gte: rangeStart, lte: rangeEnd },
        },
        orderBy: [{ recapDate: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          entityId: true,
          recapDate: true,
          summary: true,
          userId: true,
        },
      }),
      workspaceChannelIds.length > 0
        ? db.ticket.findMany({
            where: {
              channelId: { in: workspaceChannelIds },
              createdAt: { gte: rangeStart, lte: rangeEnd },
            },
            select: { statusV2: true, eta: true },
          })
        : Promise.resolve([]),
    ]);

    const channelNameById = new Map(channels.map((c) => [c.id, c.name]));

    const ticketMetrics = {
      totalCount: ticketRecords.length,
      solvedCount: ticketRecords.filter((t) => t.statusV2 === 'COMPLETED').length,
      todoCount: ticketRecords.filter((t) => t.statusV2 === 'TODO').length,
      startedCount: ticketRecords.filter((t) => t.statusV2 === 'STARTED').length,
      pausedCount: ticketRecords.filter((t) => t.statusV2 === 'PAUSED').length,
      cancelledCount: ticketRecords.filter((t) => t.statusV2 === 'CANCELLED').length,
      overdueCount: ticketRecords.filter(
        (t) =>
          t.eta !== null &&
          t.eta < now &&
          (t.statusV2 === 'TODO' || t.statusV2 === 'STARTED' || t.statusV2 === 'PAUSED'),
      ).length,
    };

    const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

    return {
      from: rangeStart.toISOString().slice(0, 10),
      to: rangeEnd.toISOString().slice(0, 10),
      page,
      limit,
      total,
      totalPages,
      recaps: recaps.map((recap) => ({
        id: recap.id,
        channelId: recap.entityId,
        recapDate: recap.recapDate.toISOString().slice(0, 10),
        summary: recap.summary,
        userId: recap.userId,
        channelName: channelNameById.get(recap.entityId) ?? recap.entityId,
      })),
      ticketMetrics,
    };
  }
}

export const teamIntelligenceOrgRepository = new TeamIntelligenceOrgRepository();
