import { db } from '@/database/client';
import { teamIntelligenceContentStorageService } from '@/team-intelligence/services/team-intelligence-content-storage.service';
import {
  TeamIntelligenceUserSummarySchema,
  type TeamIntelligenceUserSummary,
} from '@/team-intelligence/user-summary.schema';
import { logger } from '@/utils/logger';

export interface UserDetailsDateRangeFilters {
  from: Date;
  to: Date;
  userEmail: string;
  page: number;
  limit: number;
  orgId?: string | null;
}

export interface UserOverviewDateRangeFilters {
  from: Date;
  to: Date;
  userEmail: string;
  orgId?: string | null;
}

export interface UserAiUsageAggregate {
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  cost: {
    amount: number;
    currency: string;
  };
}

const AI_USAGE_NUMERIC_KEYS = [
  'total_tokens',
  'prompt_tokens',
  'completion_tokens',
  'total_spend',
] as const;

type AiUsageNumericKey = (typeof AI_USAGE_NUMERIC_KEYS)[number];

function isAiUsageNumericKey(key: string): key is AiUsageNumericKey {
  return (AI_USAGE_NUMERIC_KEYS as readonly string[]).includes(key);
}

function transformAiUsageFormat(raw: {
  total_tokens: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_spend: number;
  currency: string;
}): UserAiUsageAggregate {
  return {
    totalTokens: raw.total_tokens,
    promptTokens: raw.prompt_tokens,
    completionTokens: raw.completion_tokens,
    cost: {
      amount: Math.round(raw.total_spend * 1_000_000) / 1_000_000,
      currency: raw.currency,
    },
  };
}

export interface UserDetailsDateRangeResult {
  from: string;
  to: string;
  userEmail: string;
  page: number;
  limit: number;
  pullRequests: {
    total: number;
    totalPages: number;
    items: Record<string, unknown>[];
  };
  soloCommits: Record<string, unknown>[];
  aiUsages: UserAiUsageAggregate;
  productivityMetrics: Record<string, number>;
  userSummaries: Record<string, unknown>[];
  teamInsights: {
    items: Record<string, unknown>[];
    keyFocusAreas: string[];
  };
}

export interface UserPullRequestsDateRangeResult {
  from: string;
  to: string;
  userEmail: string;
  page: number;
  limit: number;
  pullRequests: {
    total: number;
    totalPages: number;
    items: Record<string, unknown>[];
  };
}

export interface UserOverviewDateRangeResult {
  from: string;
  to: string;
  userEmail: string;
  soloCommits: Record<string, unknown>[];
  aiUsages: UserAiUsageAggregate;
  productivityMetrics: Record<string, number>;
  userSummaries: Record<string, unknown>[];
  teamInsights: {
    items: Record<string, unknown>[];
    keyFocusAreas: string[];
  };
  tickets: Array<{
    id: string;
    xyneId: string;
    title: string;
    statusV2: string;
    priority: string;
    createdBy: string;
    assignedTo: string | null;
    stageName: string;
    boardId: string;
    projectId: string;
    createdAt: string;
    updatedAt: string;
    closedAt: string | null;
  }>;
}

export interface UserLeadershipSnapshotsDateRangeResult {
  from: string;
  to: string;
  userEmail: string;
  snapshots: Array<{
    id: string;
    batchId: string;
    reportDate: string;
    source: string;
    completedAt: string | null;
    user: {
      email: string;
      name: string;
      teamId: string | null;
      teamName: string | null;
    };
    summary: TeamIntelligenceUserSummary;
    summaryMetadata: unknown;
  }>;
}

function paginateArray<T>(items: T[], page: number, limit: number): { total: number; totalPages: number; items: T[] } {
  const total = items.length;
  const totalPages = total === 0 ? 0 : Math.ceil(total / limit);
  const start = (page - 1) * limit;
  const end = start + limit;

  return {
    total,
    totalPages,
    items: items.slice(start, end),
  };
}

class TeamIntelligenceUserRepository {
  private async getUserIngestions(filters: UserOverviewDateRangeFilters) {
    const { from, to, userEmail, orgId } = filters;

    const rangeStart = new Date(from);
    rangeStart.setUTCHours(0, 0, 0, 0);

    const rangeEnd = new Date(to);
    rangeEnd.setUTCHours(23, 59, 59, 999);

    const ingestions = await db.teamIntelligenceUserIngestionV2.findMany({
      where: {
        reportDate: { gte: rangeStart, lte: rangeEnd },
        userEmail: {
          equals: userEmail,
          mode: 'insensitive',
        },
        ...(orgId ? { orgId } : {}),
      },
      orderBy: [{ reportDate: 'desc' }, { updatedAt: 'desc' }],
      select: {
        userEmail: true,
        teamName: true,
        reportDate: true,
        aiUsage: true,
        contentUrl: true,
      },
    });

    const hydratedIngestions = await Promise.all(
      ingestions.map(async (ingestion) => {
        const content = await teamIntelligenceContentStorageService.hydrateJsonPayload<{
          pullRequests?: unknown[];
          soloCommits?: unknown[];
          employeeSummary?: unknown[];
          userSummary?: unknown;
          summaryMetadata?: unknown;
        }>(null, ingestion.contentUrl);

        return {
          ...ingestion,
          pullRequests: Array.isArray(content?.pullRequests) ? content.pullRequests : [],
          soloCommits: Array.isArray(content?.soloCommits) ? content.soloCommits : [],
          employeeSummary: Array.isArray(content?.employeeSummary) ? content.employeeSummary : [],
          userSummary:
            content?.userSummary && typeof content.userSummary === 'object' && !Array.isArray(content.userSummary)
              ? content.userSummary
              : null,
          summaryMetadata: content?.summaryMetadata ?? null,
        };
      })
    );

    return { ingestions: hydratedIngestions, rangeStart, rangeEnd };
  }

  private buildUserAggregateData(ingestions: Array<{
    teamName: string | null;
    reportDate: Date;
    pullRequests: unknown;
    soloCommits: unknown;
    aiUsage: unknown;
    employeeSummary: unknown;
    userSummary: unknown;
    summaryMetadata: unknown;
  }>) {

    const pullRequests: Record<string, unknown>[] = [];
    const soloCommits: Record<string, unknown>[] = [];
    const teamInsights: Record<string, unknown>[] = [];
    const keyFocusAreas: string[] = [];
    const userSummaries: Record<string, unknown>[] = [];

    const rawAiUsages = {
      total_tokens: 0,
      prompt_tokens: 0,
      completion_tokens: 0,
      total_spend: 0,
      currency: 'USD',
    };

    const productivityMetrics: Record<string, number> = {};

    for (const ingestion of ingestions) {
      if (Array.isArray(ingestion.pullRequests)) {
        for (const pr of ingestion.pullRequests as Array<Record<string, unknown>>) {
          if (pr && typeof pr === 'object' && !Array.isArray(pr)) {
            pullRequests.push(pr);
          }
        }
      }

      if (Array.isArray(ingestion.soloCommits)) {
        for (const commit of ingestion.soloCommits as Array<Record<string, unknown>>) {
          if (commit && typeof commit === 'object' && !Array.isArray(commit)) {
            soloCommits.push(commit);
          }
        }
      }

      const usage = ingestion.aiUsage as Record<string, unknown> | null;
      if (usage && typeof usage === 'object' && !Array.isArray(usage)) {
        for (const [key, value] of Object.entries(usage)) {
          if (key === 'provider' || key === 'model') {
            continue;
          }

          if (key === 'currency') {
            if (typeof value === 'string' && value.trim()) {
              rawAiUsages.currency = value.trim();
            }
            continue;
          }

          if (typeof value === 'number' && Number.isFinite(value)) {
            if (isAiUsageNumericKey(key)) {
              rawAiUsages[key] += value;
            }
          }
        }
      }

      const metadata = ingestion.summaryMetadata as Record<string, unknown> | null;
      if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
        const metricsCandidate = (metadata.productivityMetrics ?? metadata.metrics) as Record<string, unknown> | undefined;
        if (metricsCandidate && typeof metricsCandidate === 'object' && !Array.isArray(metricsCandidate)) {
          for (const [key, value] of Object.entries(metricsCandidate)) {
            if (typeof value === 'number' && Number.isFinite(value)) {
              productivityMetrics[key] = (productivityMetrics[key] ?? 0) + value;
            }
          }
        }

        const metadataFocusAreas = metadata.keyFocusAreas;
        if (Array.isArray(metadataFocusAreas)) {
          for (const area of metadataFocusAreas) {
            if (typeof area === 'string' && area.trim()) {
              keyFocusAreas.push(area.trim());
            }
          }
        }

        const metadataInsights = metadata.teamInsights;
        if (Array.isArray(metadataInsights)) {
          for (const insight of metadataInsights) {
            if (!insight || typeof insight !== 'object' || Array.isArray(insight)) {
              continue;
            }

            const focusAreas = (insight as Record<string, unknown>).keyFocusAreas;
            if (!Array.isArray(focusAreas)) {
              continue;
            }

            for (const area of focusAreas) {
              if (typeof area === 'string' && area.trim()) {
                keyFocusAreas.push(area.trim());
              }
            }
          }
        }
      }

      const employeeSummary = ingestion.employeeSummary as unknown;
      if (Array.isArray(employeeSummary)) {
        for (const item of employeeSummary) {
          if (item && typeof item === 'object' && !Array.isArray(item)) {
            const summaryItem = item as Record<string, unknown>;
            const areasCandidate = summaryItem.keyFocusAreas;
            if (Array.isArray(areasCandidate)) {
              for (const area of areasCandidate) {
                if (typeof area === 'string' && area.trim()) {
                  keyFocusAreas.push(area.trim());
                }
              }
            }

            const insightText = summaryItem.insight;
            if (typeof insightText === 'string' && insightText.trim()) {
              keyFocusAreas.push(insightText.trim());
            }

            teamInsights.push(summaryItem);
            continue;
          }

          if (typeof item === 'string' && item.trim()) {
            keyFocusAreas.push(item.trim());
            teamInsights.push({
              insight: item.trim(),
              reportDate: ingestion.reportDate.toISOString().slice(0, 10),
              teamName: ingestion.teamName,
            });
          }
        }
      }

      if (ingestion.userSummary && typeof ingestion.userSummary === 'object' && !Array.isArray(ingestion.userSummary)) {
        userSummaries.push(ingestion.userSummary as Record<string, unknown>);
      }
    }

    const aiUsages = transformAiUsageFormat(rawAiUsages);

    return {
      pullRequests,
      soloCommits,
      aiUsages,
      productivityMetrics,
      userSummaries,
      teamInsights,
      keyFocusAreas,
    };
  }

  async getUserDetailsByDate(filters: UserDetailsDateRangeFilters): Promise<UserDetailsDateRangeResult> {
    const { page, limit, userEmail } = filters;
    const { ingestions, rangeStart, rangeEnd } = await this.getUserIngestions(filters);
    const aggregateData = this.buildUserAggregateData(ingestions);

    return {
      from: rangeStart.toISOString().slice(0, 10),
      to: rangeEnd.toISOString().slice(0, 10),
      userEmail,
      page,
      limit,
      pullRequests: paginateArray(aggregateData.pullRequests, page, limit),
      soloCommits: aggregateData.soloCommits,
      aiUsages: aggregateData.aiUsages,
      productivityMetrics: aggregateData.productivityMetrics,
      userSummaries: aggregateData.userSummaries,
      teamInsights: {
        items: aggregateData.teamInsights,
        keyFocusAreas: aggregateData.keyFocusAreas,
      },
    };
  }

  async getUserPullRequestsByDate(filters: UserDetailsDateRangeFilters): Promise<UserPullRequestsDateRangeResult> {
    const { page, limit, userEmail } = filters;
    const { ingestions, rangeStart, rangeEnd } = await this.getUserIngestions(filters);
    const aggregateData = this.buildUserAggregateData(ingestions);

    return {
      from: rangeStart.toISOString().slice(0, 10),
      to: rangeEnd.toISOString().slice(0, 10),
      userEmail,
      page,
      limit,
      pullRequests: paginateArray(aggregateData.pullRequests, page, limit),
    };
  }

  async getUserOverviewByDate(filters: UserOverviewDateRangeFilters): Promise<UserOverviewDateRangeResult> {
    const { userEmail, from, to } = filters;
    const { ingestions, rangeStart, rangeEnd } = await this.getUserIngestions(filters);
    const aggregateData = this.buildUserAggregateData(ingestions);

    // Find user by email to get their ID
    const user = await db.user.findFirst({
      where: { email: { equals: userEmail, mode: 'insensitive' } },
      select: { id: true },
    });

    // Fetch tickets for this user within the date range
    let tickets: Array<{
      id: string;
      xyneId: string;
      title: string;
      statusV2: string;
      priority: string;
      createdBy: string;
      assignedTo: string | null;
      stageName: string;
      boardId: string;
      projectId: string;
      createdAt: string;
      updatedAt: string;
      closedAt: string | null;
    }> = [];

    if (user) {
      const ticketRecords = await db.ticket.findMany({
        where: {
          OR: [{ createdBy: user.id }, { assignedTo: user.id }],
          createdAt: { gte: from, lte: to },
          isArchived: false,
        },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          xyneId: true,
          title: true,
          statusV2: true,
          priority: true,
          createdBy: true,
          assignedTo: true,
          stageName: true,
          boardId: true,
          projectId: true,
          createdAt: true,
          updatedAt: true,
          closedAt: true,
        },
      });

      tickets = ticketRecords.map((t) => ({
        id: t.id,
        xyneId: t.xyneId,
        title: t.title,
        statusV2: t.statusV2,
        priority: t.priority,
        createdBy: t.createdBy,
        assignedTo: t.assignedTo || null,
        stageName: t.stageName,
        boardId: t.boardId,
        projectId: t.projectId,
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.updatedAt.toISOString(),
        closedAt: t.closedAt ? t.closedAt.toISOString() : null,
      }));
    }

    return {
      from: rangeStart.toISOString().slice(0, 10),
      to: rangeEnd.toISOString().slice(0, 10),
      userEmail,
      soloCommits: aggregateData.soloCommits,
      aiUsages: aggregateData.aiUsages,
      productivityMetrics: aggregateData.productivityMetrics,
      userSummaries: aggregateData.userSummaries,
      teamInsights: {
        items: aggregateData.teamInsights,
        keyFocusAreas: aggregateData.keyFocusAreas,
      },
      tickets,
    };
  }

  async getUserLeadershipSnapshotsByDate(
    filters: UserOverviewDateRangeFilters
  ): Promise<UserLeadershipSnapshotsDateRangeResult> {
    const { from, to, userEmail, orgId } = filters;

    const rangeStart = new Date(from);
    rangeStart.setUTCHours(0, 0, 0, 0);

    const rangeEnd = new Date(to);
    rangeEnd.setUTCHours(23, 59, 59, 999);

    const rows = await db.teamIntelligenceUserIngestionV2.findMany({
      where: {
        reportDate: { gte: rangeStart, lte: rangeEnd },
        processingStatus: 'COMPLETED',
        userEmail: {
          equals: userEmail,
          mode: 'insensitive',
        },
        contentUrl: { not: null },
        ...(orgId ? { orgId } : {}),
      },
      orderBy: [{ reportDate: 'desc' }, { completedAt: 'desc' }],
      select: {
        id: true,
        batchId: true,
        reportDate: true,
        source: true,
        userEmail: true,
        userName: true,
        teamId: true,
        teamName: true,
        completedAt: true,
        contentUrl: true,
      },
    });

    const hydrated = await Promise.all(
      rows.map(async (row) => {
        const content =
          await teamIntelligenceContentStorageService.hydrateJsonPayload<{
            userSummary?: unknown;
            summaryMetadata?: unknown;
          }>(null, row.contentUrl);
        const parsed = TeamIntelligenceUserSummarySchema.safeParse(content?.userSummary);
        if (!parsed.success) {
          logger.warn(
            '[TEAM-INTEL] Ignoring completed user summary with invalid structured content',
            {
              userIngestionId: row.id,
              userEmail: row.userEmail,
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
          user: {
            email: row.userEmail,
            name: row.userName,
            teamId: row.teamId,
            teamName: row.teamName,
          },
          summary: parsed.data,
          summaryMetadata: content?.summaryMetadata ?? null,
        };
      })
    );

    return {
      from: rangeStart.toISOString().slice(0, 10),
      to: rangeEnd.toISOString().slice(0, 10),
      userEmail,
      snapshots: hydrated.filter(
        (snapshot): snapshot is NonNullable<(typeof hydrated)[number]> =>
          snapshot !== null
      ),
    };
  }

  async getUserChannelRecapsByDate({
    from,
    to,
    userEmail,
    page = 1,
    limit = 10,
  }: {
    from: Date;
    to: Date;
    userEmail: string;
    page: number;
    limit: number;
  }) {
    // Find user by email (case-insensitive)
    const user = await db.user.findFirst({
      where: {
        email: {
          equals: userEmail,
          mode: 'insensitive',
        },
      },
      select: {
        id: true,
      },
    });

    if (!user) {
      return {
        from,
        to,
        userEmail,
        page,
        limit,
        total: 0,
        totalPages: 0,
        recaps: [],
      };
    }

    // Get total count for pagination
    const total = await db.recap.count({
      where: {
        entityType: 'CHANNEL',
        userId: user.id,
        recapDate: {
          gte: from,
          lte: to,
        },
      },
    });

    // Calculate total pages
    const totalPages = Math.ceil(total / limit);

    // Get paginated recaps
    const recaps = await db.recap.findMany({
      where: {
        entityType: 'CHANNEL',
        userId: user.id,
        recapDate: {
          gte: from,
          lte: to,
        },
      },
      orderBy: {
        recapDate: 'desc',
      },
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        entityId: true,
        recapDate: true,
        summary: true,
        userId: true,
      },
    });

    return {
      from,
      to,
      userEmail,
      page,
      limit,
      total,
      totalPages,
      recaps: recaps.map((recap) => ({
        id: recap.id,
        channelId: recap.entityId,
        recapDate: recap.recapDate,
        summary: recap.summary,
        userId: recap.userId,
      })),
    };
  }
}

export const teamIntelligenceUserRepository = new TeamIntelligenceUserRepository();
