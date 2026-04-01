import { Prisma, TeamIntelligenceReportStatus } from '@prisma/client';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { teamIntelligenceAccessService } from './accessService';
import { teamIntelligenceAggregationService } from './aggregationService';
import { generateTeamIntelligenceReport } from '@/agents/team-intelligence-report';
import type {
  CreateTeamIntelligenceReportInput,
  TeamIntelligenceSerializedReport,
  TeamIntelligenceReportSourceSummary,
} from './types';

const reportLogger = logger.child({ module: 'team-intelligence-report-service' });

export type TeamIntelligenceRequester = {
  userId: string;
  appRole?: 'admin' | 'user';
};

const MAX_LOOKBACK_DAYS = 180;

const coerceTimeRange = (input: {
  startTime?: string;
  endTime?: string;
}): { start: Date; end: Date } => {
  const end = input.endTime ? new Date(input.endTime) : new Date();
  const start = input.startTime
    ? new Date(input.startTime)
    : new Date(end.getTime() - 14 * 24 * 60 * 60 * 1000);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error('Invalid startTime/endTime');
  }

  if (start > end) {
    throw new Error('Invalid time range: startTime must be before endTime');
  }

  const lookbackMs = end.getTime() - start.getTime();
  if (lookbackMs > MAX_LOOKBACK_DAYS * 24 * 60 * 60 * 1000) {
    throw new Error(`Time range exceeds the maximum ${MAX_LOOKBACK_DAYS}-day window`);
  }

  return { start, end };
};

export class TeamIntelligenceReportService {
  async createReportRequest(
    requester: TeamIntelligenceRequester,
    input: CreateTeamIntelligenceReportInput
  ) {
    if (!input.orgId?.trim()) {
      throw new Error('orgId is required');
    }

    const scope = await teamIntelligenceAccessService.assertCanAccessOrgScope(
      requester.userId,
      requester.appRole,
      input.orgId
    );
    const members = await teamIntelligenceAccessService.resolveRequestedMembers(
      input.orgId,
      input.userIds
    );
    const timeRange = coerceTimeRange(input);
    const sourceSummary = {
      orgName: scope.orgName,
      requestedByRole: scope.requesterRole,
      requestedUserCount: members.length,
      ...(typeof input.limitPerUser === 'number' ? { perUserLimit: input.limitPerUser } : {}),
    };

    if (members.length === 0) {
      throw new Error('No team members found for the requested scope');
    }

    const report = await db.teamIntelligenceReport.create({
      data: {
        orgId: input.orgId,
        requestedByUserId: requester.userId,
        status: TeamIntelligenceReportStatus.PENDING,
        timeRangeStart: timeRange.start,
        timeRangeEnd: timeRange.end,
        includeTranscripts: Boolean(input.includeTranscripts),
        teamMemberIds: members.map(member => member.userId),
        sourceSummary: sourceSummary as unknown as Prisma.InputJsonValue,
      },
    });

    reportLogger.info('[TEAM_INTELLIGENCE] Report request created', {
      reportId: report.id,
      orgId: input.orgId,
      requestedByUserId: requester.userId,
      memberCount: members.length,
      includeTranscripts: Boolean(input.includeTranscripts),
    });

    return report;
  }

  async listReports(requester: TeamIntelligenceRequester, orgId: string) {
    await teamIntelligenceAccessService.assertCanAccessOrgScope(
      requester.userId,
      requester.appRole,
      orgId
    );

    const reports = await db.teamIntelligenceReport.findMany({
      where: { orgId },
      orderBy: { createdAt: 'desc' },
      take: 25,
    });

    return reports.map(report => this.serializeReport(report));
  }

  async getReportById(
    requester: TeamIntelligenceRequester,
    reportId: string
  ): Promise<TeamIntelligenceSerializedReport> {
    const report = await db.teamIntelligenceReport.findUnique({
      where: { id: reportId },
    });

    if (!report) {
      throw new Error('Report not found');
    }

    await teamIntelligenceAccessService.assertCanAccessOrgScope(
      requester.userId,
      requester.appRole,
      report.orgId
    );

    return this.serializeReport(report);
  }

  async createAndProcessReportNow(
    requester: TeamIntelligenceRequester,
    input: CreateTeamIntelligenceReportInput
  ): Promise<TeamIntelligenceSerializedReport> {
    const report = await this.createReportRequest(requester, input);
    await this.processReport(report.id);
    return this.getReportById(requester, report.id);
  }

  async processReport(reportId: string): Promise<void> {
    const report = await db.teamIntelligenceReport.findUnique({
      where: { id: reportId },
    });

    if (!report) {
      throw new Error('Report not found');
    }

    await db.teamIntelligenceReport.update({
      where: { id: reportId },
      data: {
        status: TeamIntelligenceReportStatus.PROCESSING,
        error: null,
      },
    });

    try {
      const members = await teamIntelligenceAccessService.resolveRequestedMembers(
        report.orgId,
        report.teamMemberIds
      );

      const aggregated = await teamIntelligenceAggregationService.aggregate({
        orgId: report.orgId,
        members,
        startTime: report.timeRangeStart.toISOString(),
        endTime: report.timeRangeEnd.toISOString(),
        includeTranscripts: report.includeTranscripts,
        limitPerUser: this.extractPerUserLimit(report.sourceSummary),
      });

      const generated = await generateTeamIntelligenceReport(aggregated);
      const sourceSummary: TeamIntelligenceReportSourceSummary = {
        totalMembers: aggregated.meta.totalMembers,
        totalEmails: aggregated.meta.totalEmails,
        totalTranscripts: aggregated.meta.totalTranscripts,
        perUserLimit: aggregated.meta.perUserLimit,
      };

      await db.teamIntelligenceReport.update({
        where: { id: reportId },
        data: {
          status: TeamIntelligenceReportStatus.COMPLETED,
          sourceSummary: sourceSummary as unknown as Prisma.InputJsonValue,
          reportJson: generated as unknown as Prisma.InputJsonValue,
          reportMarkdown: generated.markdown,
          completedAt: new Date(),
          error: null,
        },
      });

      reportLogger.info('[TEAM_INTELLIGENCE] Report completed', {
        reportId,
        orgId: report.orgId,
      });
    } catch (error) {
      reportLogger.error('[TEAM_INTELLIGENCE] Report generation failed', {
        reportId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      await db.teamIntelligenceReport.update({
        where: { id: reportId },
        data: {
          status: TeamIntelligenceReportStatus.FAILED,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      });

      throw error;
    }
  }

  private extractPerUserLimit(sourceSummary: unknown): number | undefined {
    if (!sourceSummary || typeof sourceSummary !== 'object') {
      return undefined;
    }

    const rawLimit = (sourceSummary as Record<string, unknown>).perUserLimit;
    return typeof rawLimit === 'number' && Number.isFinite(rawLimit)
      ? rawLimit
      : undefined;
  }

  private serializeReport(
    report: Awaited<ReturnType<typeof db.teamIntelligenceReport.findUniqueOrThrow>>
  ): TeamIntelligenceSerializedReport {
    return {
      id: report.id,
      orgId: report.orgId,
      requestedByUserId: report.requestedByUserId,
      status: report.status,
      timeRangeStart: report.timeRangeStart.toISOString(),
      timeRangeEnd: report.timeRangeEnd.toISOString(),
      includeTranscripts: report.includeTranscripts,
      teamMemberIds: report.teamMemberIds,
      sourceSummary: report.sourceSummary,
      report: report.reportJson,
      markdown: report.reportMarkdown,
      error: report.error,
      completedAt: report.completedAt?.toISOString() || null,
      createdAt: report.createdAt.toISOString(),
      updatedAt: report.updatedAt.toISOString(),
    };
  }
}

export const teamIntelligenceReportService = new TeamIntelligenceReportService();
