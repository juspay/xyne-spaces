import { db } from '@/database/client';
import { teamIntelligenceContentStorageService } from '@/team-intelligence/services/team-intelligence-content-storage.service';

export interface TeamBulletsDateRangeFilters {
  from: Date;
  to: Date;
  teamId: string;
  orgId?: string | null;
  page: number;
  limit: number;
}

export interface TeamBulletsDateRangeResult {
  from: string;
  to: string;
  teamId: string | null;
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
  orgId?: string | null;
}

export interface TeamPrMatch {
  userEmail: string;
  userName: string;
  teamId: string | null;
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
  teamId: string;
  orgId?: string | null;
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
  teamId: string | null;
  teamName: string;
  totalPrCount: number;
  totalCommitCount: number;
  aiUsages: TeamAiUsageAggregate;
}

export interface TeamLeadershipSnapshotsDateRangeFilters {
  from: Date;
  to: Date;
  teamId: string;
  orgId?: string | null;
}

export interface TeamLeadershipSnapshotsDateRangeResult {
  from: string;
  to: string;
  teamId: string;
  teamName: string;
  snapshots: Record<string, unknown>[];
}

export interface TeamChannelRecapChannelCandidate {
  channelId: string;
  channelName: string;
  recapCount: number;
  lastRecapDate: string | null;
}

class TeamIntelligenceTeamRepository {
  async findAllTeamNamesByTeamId(teamId: string): Promise<string[]> {
    const [summaryRows, ingestionRows] = await Promise.all([
      db.teamIntelligenceTeamSummaryV2.findMany({
        where: { teamId },
        select: { teamName: true },
        distinct: ['teamName'],
      }),
      db.teamIntelligenceUserIngestionV2.findMany({
        where: { teamId },
        select: { teamName: true },
        distinct: ['teamName'],
      }),
    ]);

    const names = new Set<string>();
    for (const row of [...summaryRows, ...ingestionRows]) {
      const name = (row.teamName ?? '').trim();
      if (name) {
        names.add(name);
      }
    }
    return [...names];
  }

  async findLatestTeamDisplayByTeamId(teamId: string, filters?: { from?: Date; to?: Date }): Promise<{ teamId: string; teamName: string } | null> {
    const rangeStart = filters?.from ? new Date(filters.from) : null;
    if (rangeStart) {
      rangeStart.setUTCHours(0, 0, 0, 0);
    }

    const rangeEnd = filters?.to ? new Date(filters.to) : null;
    if (rangeEnd) {
      rangeEnd.setUTCHours(23, 59, 59, 999);
    }

    const teamSummary = await db.teamIntelligenceTeamSummaryV2.findFirst({
      where: {
        teamId,
        ...(rangeStart && rangeEnd ? { reportDate: { gte: rangeStart, lte: rangeEnd } } : {}),
      },
      orderBy: [{ reportDate: 'desc' }, { updatedAt: 'desc' }],
      select: {
        teamId: true,
        teamName: true,
      },
    });

    if (teamSummary?.teamId && teamSummary.teamName.trim()) {
      return {
        teamId: teamSummary.teamId,
        teamName: teamSummary.teamName.trim(),
      };
    }

    const userIngestion = await db.teamIntelligenceUserIngestionV2.findFirst({
      where: {
        teamId,
        ...(rangeStart && rangeEnd ? { reportDate: { gte: rangeStart, lte: rangeEnd } } : {}),
      },
      orderBy: [{ reportDate: 'desc' }, { updatedAt: 'desc' }],
      select: {
        teamId: true,
        teamName: true,
      },
    });

    if (!userIngestion?.teamId) {
      return null;
    }

    return {
      teamId: userIngestion.teamId,
      teamName: (userIngestion.teamName ?? '').trim() || 'No Team',
    };
  }

  async getTeamBulletsByDate(filters: TeamBulletsDateRangeFilters): Promise<TeamBulletsDateRangeResult> {
    const { from, to, teamId, orgId, page, limit } = filters;

    const rangeStart = new Date(from);
    rangeStart.setUTCHours(0, 0, 0, 0);

    const rangeEnd = new Date(to);
    rangeEnd.setUTCHours(23, 59, 59, 999);

    const display = await this.findLatestTeamDisplayByTeamId(teamId, { from: rangeStart, to: rangeEnd });

    const teamSummaries = await db.teamIntelligenceTeamSummaryV2.findMany({
      where: {
        reportDate: { gte: rangeStart, lte: rangeEnd },
        teamId,
        status: 'COMPLETED',
        contentUrl: { not: null },
        ...(orgId ? { orgId } : {}),
      },
      orderBy: [{ reportDate: 'desc' }, { createdAt: 'desc' }],
      select: {
        teamId: true,
        teamName: true,
        reportDate: true,
        contentUrl: true,
      },
    });

    const bullets: Record<string, unknown>[] = [];

    for (const teamSummary of teamSummaries) {
      const content = await teamIntelligenceContentStorageService.hydrateJsonPayload<{
        provenance?: Record<string, unknown>;
      }>(null, teamSummary.contentUrl);
      const provenance = content?.provenance ?? null;
      const provenanceBullets = provenance?.bullets;

      if (!Array.isArray(provenanceBullets)) {
        continue;
      }

      for (const bullet of provenanceBullets) {
        if (bullet && typeof bullet === 'object' && !Array.isArray(bullet)) {
          bullets.push({
            teamId: teamSummary.teamId,
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
      teamId,
      teamName: display?.teamName ?? teamSummaries[0]?.teamName ?? 'No Team',
      page,
      limit,
      total,
      totalPages,
      bullets: paginatedBullets,
    };
  }

  async getTeamLeadershipSnapshotsByDate(
    filters: TeamLeadershipSnapshotsDateRangeFilters
  ): Promise<TeamLeadershipSnapshotsDateRangeResult> {
    const { from, to, teamId, orgId } = filters;
    const rangeStart = new Date(from);
    rangeStart.setUTCHours(0, 0, 0, 0);
    const rangeEnd = new Date(to);
    rangeEnd.setUTCHours(23, 59, 59, 999);

    const rows = await db.teamIntelligenceTeamSummaryV2.findMany({
      where: {
        reportDate: { gte: rangeStart, lte: rangeEnd },
        teamId,
        status: 'COMPLETED',
        contentUrl: { not: null },
        ...(orgId ? { orgId } : {}),
      },
      orderBy: [{ reportDate: 'desc' }, { updatedAt: 'desc' }],
      select: {
        id: true,
        batchId: true,
        reportDate: true,
        teamId: true,
        teamName: true,
        status: true,
        totalUsers: true,
        completedUsers: true,
        failedUsers: true,
        errorMessage: true,
        contentUrl: true,
        completedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    const snapshots = await Promise.all(rows.map(async (row) => {
      const content = await teamIntelligenceContentStorageService.hydrateJsonPayload<{
        teamSummary?: Record<string, unknown>;
        summaryMetadata?: Record<string, unknown>;
      }>(null, row.contentUrl);
      return {
        id: row.id,
        batchId: row.batchId,
        reportDate: row.reportDate.toISOString().slice(0, 10),
        teamId: row.teamId,
        teamName: row.teamName,
        status: row.status,
        processingCoverage: {
          expectedMembers: row.totalUsers,
          completedUserSummaries: row.completedUsers,
          failedUserSummaries: row.failedUsers,
        },
        errorMessage: row.errorMessage,
        summary: content?.teamSummary ?? null,
        summaryMetadata: content?.summaryMetadata ?? null,
        completedAt: row.completedAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      };
    }));

    return {
      from: rangeStart.toISOString().slice(0, 10),
      to: rangeEnd.toISOString().slice(0, 10),
      teamId,
      teamName: rows[0]?.teamName ?? 'No Team',
      snapshots,
    };
  }

  async getPrByDate(filters: TeamPrByDateFilters): Promise<TeamPrByDateResult> {
    const { from, to, prId, orgId } = filters;

    const rangeStart = new Date(from);
    rangeStart.setUTCHours(0, 0, 0, 0);

    const rangeEnd = new Date(to);
    rangeEnd.setUTCHours(23, 59, 59, 999);

    const userIngestions = await db.teamIntelligenceUserIngestionV2.findMany({
      where: {
        reportDate: { gte: rangeStart, lte: rangeEnd },
        ...(orgId ? { orgId } : {}),
      },
      orderBy: [{ reportDate: 'desc' }, { updatedAt: 'desc' }],
      select: {
        userEmail: true,
        userName: true,
        teamId: true,
        teamName: true,
        reportDate: true,
        contentUrl: true,
      },
    });

    const matches: TeamPrMatch[] = [];

    for (const ingestion of userIngestions) {
      const content = await teamIntelligenceContentStorageService.hydrateJsonPayload<{
        pullRequests?: unknown[];
      }>(null, ingestion.contentUrl);
      const pullRequests = Array.isArray(content?.pullRequests)
        ? (content.pullRequests as Array<Record<string, unknown>>)
        : [];

      for (const pr of pullRequests) {
        const prIdValue = pr.prId;
        if (typeof prIdValue !== 'number' || prIdValue !== prId) {
          continue;
        }

        matches.push({
          userEmail: ingestion.userEmail,
          userName: ingestion.userName,
          teamId: ingestion.teamId,
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
    const { from, to, teamId, orgId } = filters;

    const rangeStart = new Date(from);
    rangeStart.setUTCHours(0, 0, 0, 0);

    const rangeEnd = new Date(to);
    rangeEnd.setUTCHours(23, 59, 59, 999);

    const display = await this.findLatestTeamDisplayByTeamId(teamId, { from: rangeStart, to: rangeEnd });

    const userIngestions = await db.teamIntelligenceUserIngestionV2.findMany({
      where: {
        reportDate: { gte: rangeStart, lte: rangeEnd },
        teamId,
        ...(orgId ? { orgId } : {}),
      },
      select: {
        teamId: true,
        teamName: true,
        contentUrl: true,
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
      const content = await teamIntelligenceContentStorageService.hydrateJsonPayload<{
        pullRequests?: unknown[];
      }>(null, user.contentUrl);
      const prs = Array.isArray(content?.pullRequests)
        ? (content.pullRequests as Array<{ commits?: Array<Record<string, unknown>> }> )
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
      teamId,
      teamName: display?.teamName ?? userIngestions[0]?.teamName ?? 'No Team',
      totalPrCount,
      totalCommitCount,
      aiUsages,
    };
  }

  async getChannelRecapChannelsByDate({
    from,
    to,
    workspaceId,
  }: {
    from: Date;
    to: Date;
    workspaceId: string;
  }): Promise<TeamChannelRecapChannelCandidate[]> {
    const rangeStart = new Date(from);
    rangeStart.setUTCHours(0, 0, 0, 0);

    const rangeEnd = new Date(to);
    rangeEnd.setUTCHours(23, 59, 59, 999);

    const grouped = await db.recap.groupBy({
      by: ['entityId'],
      where: {
        workspaceId,
        entityType: 'CHANNEL',
        recapDate: {
          gte: rangeStart,
          lte: rangeEnd,
        },
      },
      _count: {
        entityId: true,
      },
      _max: {
        recapDate: true,
      },
      orderBy: {
        _count: {
          entityId: 'desc',
        },
      },
    });

    if (grouped.length === 0) {
      return [];
    }

    const channelIds = grouped.map((item) => item.entityId);
    const channels = await db.channel.findMany({
      where: {
        workspaceId,
        id: { in: channelIds },
      },
      select: {
        id: true,
        name: true,
      },
    });

    const channelNameById = new Map(channels.map((channel) => [channel.id, channel.name]));

    return grouped.map((item) => ({
      channelId: item.entityId,
      channelName: channelNameById.get(item.entityId) ?? item.entityId,
      recapCount: item._count.entityId,
      lastRecapDate: item._max.recapDate ? item._max.recapDate.toISOString().slice(0, 10) : null,
    }));
  }

  async getChannelRecapsByChannelIdsAndDate({
    from,
    to,
    channelIds,
    page,
    limit,
    workspaceId,
  }: {
    from: Date;
    to: Date;
    channelIds: string[];
    page: number;
    limit: number;
    workspaceId: string;
  }) {
    const rangeStart = new Date(from);
    rangeStart.setUTCHours(0, 0, 0, 0);

    const rangeEnd = new Date(to);
    rangeEnd.setUTCHours(23, 59, 59, 999);

    if (channelIds.length === 0) {
      return {
        from: rangeStart.toISOString().slice(0, 10),
        to: rangeEnd.toISOString().slice(0, 10),
        page,
        limit,
        total: 0,
        totalPages: 0,
        recaps: [],
        ticketMetrics: {
          totalCount: 0,
          solvedCount: 0,
          todoCount: 0,
          startedCount: 0,
          pausedCount: 0,
          cancelledCount: 0,
          overdueCount: 0,
        },
        overdueTickets: [],
      };
    }

    const [total, recaps, channels] = await Promise.all([
      db.recap.count({
        where: {
          workspaceId,
          entityType: 'CHANNEL',
          entityId: { in: channelIds },
          recapDate: { gte: rangeStart, lte: rangeEnd },
        },
      }),
      db.recap.findMany({
        where: {
          workspaceId,
          entityType: 'CHANNEL',
          entityId: { in: channelIds },
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
      db.channel.findMany({
        where: {
          workspaceId,
          id: { in: channelIds },
        },
        select: {
          id: true,
          name: true,
        },
      }),
    ]);
    const totalPages = total === 0 ? 0 : Math.ceil(total / limit);
    const channelNameById = new Map(channels.map((channel) => [channel.id, channel.name]));

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
    };
  }

  async getChannelTicketsByChannelIdsAndDate({
    from,
    to,
    channelIds,
    page,
    limit,
  }: {
    from: Date;
    to: Date;
    channelIds: string[];
    page: number;
    limit: number;
  }) {
    const rangeStart = new Date(from);
    rangeStart.setUTCHours(0, 0, 0, 0);

    const rangeEnd = new Date(to);
    rangeEnd.setUTCHours(23, 59, 59, 999);

    if (channelIds.length === 0) {
      return {
        from: rangeStart.toISOString().slice(0, 10),
        to: rangeEnd.toISOString().slice(0, 10),
        page,
        limit,
        total: 0,
        totalPages: 0,
        tickets: [],
        ticketMetrics: {
          totalCount: 0,
          solvedCount: 0,
          todoCount: 0,
          startedCount: 0,
          pausedCount: 0,
          cancelledCount: 0,
          overdueCount: 0,
        },
      };
    }

    const now = new Date();

    const [total, tickets, solvedCount, todoCount, startedCount, pausedCount, cancelledCount, overdueCount] = await Promise.all([
      db.ticket.count({
        where: {
          channelId: { in: channelIds },
          createdAt: { gte: rangeStart, lte: rangeEnd },
        },
      }),
      db.ticket.findMany({
        where: {
          channelId: { in: channelIds },
          createdAt: { gte: rangeStart, lte: rangeEnd },
        },
        orderBy: [{ createdAt: 'desc' }, { updatedAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.ticket.count({ where: { channelId: { in: channelIds }, createdAt: { gte: rangeStart, lte: rangeEnd }, statusV2: 'COMPLETED' } }),
      db.ticket.count({ where: { channelId: { in: channelIds }, createdAt: { gte: rangeStart, lte: rangeEnd }, statusV2: 'TODO' } }),
      db.ticket.count({ where: { channelId: { in: channelIds }, createdAt: { gte: rangeStart, lte: rangeEnd }, statusV2: 'STARTED' } }),
      db.ticket.count({ where: { channelId: { in: channelIds }, createdAt: { gte: rangeStart, lte: rangeEnd }, statusV2: 'PAUSED' } }),
      db.ticket.count({ where: { channelId: { in: channelIds }, createdAt: { gte: rangeStart, lte: rangeEnd }, statusV2: 'CANCELLED' } }),
      db.ticket.count({ where: { channelId: { in: channelIds }, createdAt: { gte: rangeStart, lte: rangeEnd }, eta: { lt: now }, statusV2: { in: ['TODO', 'STARTED', 'PAUSED'] } } }),
    ]);

    const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

    return {
      from: rangeStart.toISOString().slice(0, 10),
      to: rangeEnd.toISOString().slice(0, 10),
      page,
      limit,
      total,
      totalPages,
      tickets: tickets.map((ticket) => ({
        ...ticket,
        createdAt: ticket.createdAt.toISOString(),
        updatedAt: ticket.updatedAt.toISOString(),
        statusUpdatedAt: ticket.statusUpdatedAt.toISOString(),
        closedAt: ticket.closedAt ? ticket.closedAt.toISOString() : null,
        eta: ticket.eta ? ticket.eta.toISOString() : null,
        firstRespondedAt: ticket.firstRespondedAt ? ticket.firstRespondedAt.toISOString() : null,
        lastEmailAt: ticket.lastEmailAt.toISOString(),
      })),
      ticketMetrics: {
        totalCount: total,
        solvedCount,
        todoCount,
        startedCount,
        pausedCount,
        cancelledCount,
        overdueCount,
      },
    };
  }
}

export const teamIntelligenceTeamRepository = new TeamIntelligenceTeamRepository();
