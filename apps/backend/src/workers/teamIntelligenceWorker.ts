import Bull from 'bull';
import { Prisma } from '@prisma/client';
import { TeamIntelligenceBatchStatus, TeamIntelligenceUserIngestionStatus } from '@xyne/shared';
import { logger } from '@/utils/logger';
import { teamIntelligenceQueue } from '@/team-intelligence/queue';
import { teamIntelligenceTeamSummaryQueue } from '@/team-intelligence/team-summary.queue';
import { teamIntelligenceOrgSummaryQueue } from '@/team-intelligence/org-summary.queue';
import { teamIntelligenceRepository } from '@/team-intelligence/repositories/team-intelligence.repository';
import { teamIntelligenceSummaryService } from '@/team-intelligence/services/team-intelligence-summary.service';
import { teamIntelligenceTeamSummaryService } from '@/team-intelligence/services/team-intelligence-team-summary.service';
import { teamIntelligenceOrgSummaryService } from '@/team-intelligence/services/team-intelligence-org-summary.service';
import { teamIntelligenceContentStorageService } from '@/team-intelligence/services/team-intelligence-content-storage.service';
import { mettleTeamGoalsService } from '@/services/mettleTeamGoalsService';
import type {
  TeamIntelligenceOrgSummaryQueuedJobData,
  TeamIntelligenceQueuedJobData,
  TeamIntelligenceTeamSummaryQueuedJobData,
} from '@/team-intelligence/types';
import type { TeamIntelligenceTeamAggregationPayload } from '@/team-intelligence/user-summary.schema';
import {
  TeamIntelligenceContinuityStateSchema,
  type TeamIntelligenceContinuityState,
} from '@/team-intelligence/team-leadership-summary.schema';
import type { TeamIntelligenceOrgAggregationPayload } from '@/team-intelligence/team-leadership-summary.schema';
import {
  TeamIntelligenceOrgContinuityStateSchema,
  type TeamIntelligenceOrgContinuityState,
} from '@/team-intelligence/org-leadership-summary.schema';
import { config as appConfig } from '@/config/env';
import { db } from '@/database/client';

class TeamIntelligenceWorker {
  private isInitialized = false;
  private readonly staleJobThresholdMs = 2 * 60 * 1000;

  private isFinalAttempt(job: Bull.Job): boolean {
    const configuredAttempts = job.opts.attempts ?? 1;
    // Bull increments attemptsMade only after the processor throws.
    return job.attemptsMade + 1 >= configuredAttempts;
  }

  private isQueueStateRecoverable(state: string | null): boolean {
    return state === null || state === 'failed' || state === 'completed';
  }

  private isStaleTimestamp(timestamp: Date | null | undefined): boolean {
    if (!timestamp) {
      return true;
    }

    return Date.now() - timestamp.getTime() >= this.staleJobThresholdMs;
  }

  private async removeRecoverableExistingJob(existingJob: Bull.Job | null, state: string | null): Promise<boolean> {
    if (!existingJob || !state) {
      return false;
    }

    if (state === 'failed' || state === 'completed' || state === 'active') {
      await existingJob.remove().catch(() => undefined);
      return true;
    }

    return false;
  }

  async start(): Promise<void> {
    if (this.isInitialized) return;

    await teamIntelligenceQueue.initialize();
    await teamIntelligenceTeamSummaryQueue.initialize();
    await teamIntelligenceOrgSummaryQueue.initialize();

    const queue = teamIntelligenceQueue.getQueue();
    const teamQueue = teamIntelligenceTeamSummaryQueue.getQueue();
    const orgQueue = teamIntelligenceOrgSummaryQueue.getQueue();
    if (!queue || !teamQueue || !orgQueue) {
      throw new Error('[TEAM-INTEL-WORKER] Queue not available after initialization');
    }

    const userJobConcurrency = appConfig.teamIntelligence.userJobConcurrency;
    const teamJobConcurrency = appConfig.teamIntelligence.teamJobConcurrency;
    const orgJobConcurrency = appConfig.teamIntelligence.orgJobConcurrency;

    queue.process('ingest-user', userJobConcurrency, async (job: Bull.Job<TeamIntelligenceQueuedJobData>) => {
      return this.processJob(job);
    });

    teamQueue.process('summarize-team', teamJobConcurrency, async (job: Bull.Job<TeamIntelligenceTeamSummaryQueuedJobData>) => {
      return this.processTeamSummaryJob(job);
    });

    orgQueue.process('summarize-org', orgJobConcurrency, async (job: Bull.Job<TeamIntelligenceOrgSummaryQueuedJobData>) => {
      return this.processOrgSummaryJob(job);
    });

    await this.recoverInterruptedJobs();

    this.isInitialized = true;
    logger.info('[TEAM-INTEL-WORKER] Started, ready to process jobs', {
      userJobConcurrency,
      teamJobConcurrency,
      orgJobConcurrency,
      userSectionConcurrency: appConfig.teamIntelligence.userSectionConcurrency || 'default',
      teamSectionConcurrency: appConfig.teamIntelligence.teamSectionConcurrency || 'default',
      orgSectionConcurrency: appConfig.teamIntelligence.orgSectionConcurrency || 'default',
      fallbackSectionConcurrency: appConfig.teamIntelligence.sectionConcurrency || 'default',
    });
  }

  private async recoverInterruptedJobs(): Promise<void> {
    await this.recoverUserJobs();
    await this.recoverTeamSummaryJobs();
    await this.recoverOrgSummaryJobs();
  }

  private async recoverUserJobs(): Promise<void> {
    const pendingUsers = await teamIntelligenceRepository.findUsersByStatuses([
      TeamIntelligenceUserIngestionStatus.QUEUED,
      TeamIntelligenceUserIngestionStatus.PROCESSING,
    ]);

    if (pendingUsers.length === 0) {
      return;
    }

    const queue = teamIntelligenceQueue.getQueue();
    if (!queue) {
      throw new Error('[TEAM-INTEL-WORKER] User queue unavailable during recovery');
    }

    let recoveredCount = 0;
    const recoveredUserIds: string[] = [];
    const recoveredBatchIds = new Set<string>();
    const now = new Date();

    const recoveryChecks = await Promise.all(
      pendingUsers.map(async (user) => {
        const existingJob = await queue.getJob(user.id);
        const existingState = existingJob ? await existingJob.getState() : null;
        return { user, existingJob, existingState };
      })
    );

    for (const { user, existingJob, existingState } of recoveryChecks) {
      const shouldRecoverStaleActive = existingState === 'active' && this.isStaleTimestamp(user.startedAt);
      if (!this.isQueueStateRecoverable(existingState) && !shouldRecoverStaleActive) {
        continue;
      }

      await this.removeRecoverableExistingJob(existingJob, existingState);

      const enqueueResult = await teamIntelligenceQueue.enqueueUserIngestionJob({
        batchId: user.batchId,
        userIngestionId: user.id,
        reportDate: user.reportDate.toISOString().slice(0, 10),
        userEmail: user.userEmail,
        userName: user.userName,
        teamId: user.teamId,
        teamName: user.teamName,
        source: user.source,
        orgId: user.orgId ?? '',
      });

      if (enqueueResult.enqueued || enqueueResult.duplicateJobState === 'waiting' || enqueueResult.duplicateJobState === 'delayed' || enqueueResult.duplicateJobState === 'paused') {
        recoveredUserIds.push(user.id);
        recoveredBatchIds.add(user.batchId);
        recoveredCount += 1;
      }
    }

    if (recoveredUserIds.length > 0) {
      await teamIntelligenceRepository.updateUserStatuses(recoveredUserIds, {
        processingStatus: TeamIntelligenceUserIngestionStatus.QUEUED,
        queuedAt: now,
        startedAt: null,
        completedAt: null,
        failedAt: null,
        errorMessage: null,
      });
    }

    if (recoveredBatchIds.size > 0) {
      await Promise.all(
        [...recoveredBatchIds].map((batchId) =>
          teamIntelligenceRepository.updateBatchStatus(batchId, {
            status: TeamIntelligenceBatchStatus.PROCESSING,
            errorMessage: null,
          })
        )
      );
    }

    if (recoveredCount > 0) {
      logger.warn(`[TEAM-INTEL-WORKER] Recovered ${recoveredCount} interrupted user ingestion job(s)`);
    }
  }

  private async recoverTeamSummaryJobs(): Promise<void> {
    const pendingTeamSummaries = await teamIntelligenceRepository.findTeamSummariesByStatuses([
      TeamIntelligenceBatchStatus.RECEIVED,
      TeamIntelligenceBatchStatus.QUEUED,
      TeamIntelligenceBatchStatus.PROCESSING,
    ]);

    if (pendingTeamSummaries.length === 0) {
      return;
    }

    const queue = teamIntelligenceTeamSummaryQueue.getQueue();
    if (!queue) {
      throw new Error('[TEAM-INTEL-WORKER] Team summary queue unavailable during recovery');
    }

    let recoveredCount = 0;
    const recoveredTeamSummaryIds: string[] = [];
    const recoveredBatchIds = new Set<string>();
    const now = new Date();

    const recoveryChecks = await Promise.all(
      pendingTeamSummaries.map(async (teamSummary) => {
        const existingJob = await queue.getJob(teamSummary.id);
        const existingState = existingJob ? await existingJob.getState() : null;
        return { teamSummary, existingJob, existingState };
      })
    );

    for (const { teamSummary, existingJob, existingState } of recoveryChecks) {
      const shouldRecoverStaleActive = existingState === 'active' && this.isStaleTimestamp(teamSummary.startedAt);
      if (!this.isQueueStateRecoverable(existingState) && !shouldRecoverStaleActive) {
        continue;
      }

      await this.removeRecoverableExistingJob(existingJob, existingState);

      const enqueueResult = await teamIntelligenceTeamSummaryQueue.enqueueTeamSummaryJob({
        batchId: teamSummary.batchId,
        teamSummaryId: teamSummary.id,
        reportDate: teamSummary.reportDate.toISOString().slice(0, 10),
        teamId: teamSummary.teamId,
        teamName: teamSummary.teamName,
        source: teamSummary.source,
        orgId: teamSummary.orgId ?? '',
      });

      if (enqueueResult.enqueued || enqueueResult.duplicateJobState === 'waiting' || enqueueResult.duplicateJobState === 'delayed' || enqueueResult.duplicateJobState === 'paused') {
        recoveredTeamSummaryIds.push(teamSummary.id);
        recoveredBatchIds.add(teamSummary.batchId);
        recoveredCount += 1;
      }
    }

    if (recoveredTeamSummaryIds.length > 0) {
      await teamIntelligenceRepository.updateTeamSummaryStatuses(recoveredTeamSummaryIds, {
        status: TeamIntelligenceBatchStatus.QUEUED,
        queuedAt: now,
        startedAt: null,
        completedAt: null,
        failedAt: null,
        errorMessage: null,
      });
    }

    if (recoveredBatchIds.size > 0) {
      await Promise.all(
        [...recoveredBatchIds].map((batchId) =>
          teamIntelligenceRepository.updateBatchStatus(batchId, {
            status: TeamIntelligenceBatchStatus.PROCESSING,
            errorMessage: null,
          })
        )
      );
    }

    if (recoveredCount > 0) {
      logger.warn(`[TEAM-INTEL-WORKER] Recovered ${recoveredCount} interrupted team summary job(s)`);
    }
  }

  private async recoverOrgSummaryJobs(): Promise<void> {
    const pendingOrgSummaries = await teamIntelligenceRepository.findOrgSummariesByStatuses([
      TeamIntelligenceBatchStatus.RECEIVED,
      TeamIntelligenceBatchStatus.QUEUED,
      TeamIntelligenceBatchStatus.PROCESSING,
    ]);

    if (pendingOrgSummaries.length === 0) {
      return;
    }

    const queue = teamIntelligenceOrgSummaryQueue.getQueue();
    if (!queue) {
      throw new Error('[TEAM-INTEL-WORKER] Org summary queue unavailable during recovery');
    }

    let recoveredCount = 0;
    const recoveredOrgSummaryIds: string[] = [];
    const recoveredBatchIds = new Set<string>();
    const now = new Date();

    const recoveryChecks = await Promise.all(
      pendingOrgSummaries.map(async (orgSummary) => {
        const existingJob = await queue.getJob(orgSummary.id);
        const existingState = existingJob ? await existingJob.getState() : null;
        return { orgSummary, existingJob, existingState };
      })
    );

    for (const { orgSummary, existingJob, existingState } of recoveryChecks) {
      const shouldRecoverStaleActive = existingState === 'active' && this.isStaleTimestamp(orgSummary.startedAt);
      if (!this.isQueueStateRecoverable(existingState) && !shouldRecoverStaleActive) {
        continue;
      }

      await this.removeRecoverableExistingJob(existingJob, existingState);

      const enqueueResult = await teamIntelligenceOrgSummaryQueue.enqueueOrgSummaryJob({
        batchId: orgSummary.batchId,
        orgSummaryId: orgSummary.id,
        reportDate: orgSummary.reportDate.toISOString().slice(0, 10),
        source: orgSummary.source,
        orgId: orgSummary.orgId ?? '',
      });

      if (enqueueResult.enqueued || enqueueResult.duplicateJobState === 'waiting' || enqueueResult.duplicateJobState === 'delayed' || enqueueResult.duplicateJobState === 'paused') {
        recoveredOrgSummaryIds.push(orgSummary.id);
        recoveredBatchIds.add(orgSummary.batchId);
        recoveredCount += 1;
      }
    }

    if (recoveredOrgSummaryIds.length > 0) {
      await teamIntelligenceRepository.updateOrgSummaryStatuses(recoveredOrgSummaryIds, {
        status: TeamIntelligenceBatchStatus.QUEUED,
        queuedAt: now,
        startedAt: null,
        completedAt: null,
        failedAt: null,
        errorMessage: null,
      });
    }

    if (recoveredBatchIds.size > 0) {
      await Promise.all(
        [...recoveredBatchIds].map((batchId) =>
          teamIntelligenceRepository.updateBatchStatus(batchId, {
            status: TeamIntelligenceBatchStatus.PROCESSING,
            errorMessage: null,
          })
        )
      );
    }

    if (recoveredCount > 0) {
      logger.warn(`[TEAM-INTEL-WORKER] Recovered ${recoveredCount} interrupted org summary job(s)`);
    }
  }

  private async processJob(job: Bull.Job<TeamIntelligenceQueuedJobData>): Promise<void> {
    const { batchId, userIngestionId, userEmail } = job.data;
    const startedAt = new Date();

    logger.info(
      `[TEAM-INTEL-WORKER] Processing job ${job.id} batchId=${batchId} userIngestionId=${userIngestionId} userEmail=${userEmail}`
    );

    const userIngestion = await teamIntelligenceRepository.updateUserStatus(userIngestionId, {
      processingStatus: TeamIntelligenceUserIngestionStatus.PROCESSING,
      startedAt,
      errorMessage: null,
      failedAt: null,
    });
    if (!userIngestion) {
      logger.warn(
        `[TEAM-INTEL-WORKER] Discarding stale user job ${job.id}; ingestion ${userIngestionId} no longer exists`
      );
      return;
    }

    const batch = await teamIntelligenceRepository.updateBatchStatus(batchId, {
      status: TeamIntelligenceBatchStatus.PROCESSING,
      errorMessage: null,
    });
    if (!batch) {
      logger.warn(
        `[TEAM-INTEL-WORKER] Discarding stale user job ${job.id}; batch ${batchId} no longer exists`
      );
      return;
    }

    try {
      const userContent = await teamIntelligenceContentStorageService.hydrateJsonPayload<{
        pullRequests?: unknown[];
        soloCommits?: unknown[];
      }>(null, userIngestion.contentUrl);

      const generated = await teamIntelligenceSummaryService.generate({
        batchId,
        userIngestionId,
        pullRequests: userContent?.pullRequests ?? [],
        soloCommits: userContent?.soloCommits ?? [],
        aiUsage: userIngestion.aiUsage,
        userEmail: userIngestion.userEmail,
        userName: userIngestion.userName,
        teamId: userIngestion.teamId,
        teamName: userIngestion.teamName,
        source: userIngestion.source,
        orgId: userIngestion.orgId,
        reportDate: userIngestion.reportDate,
      });

      const contentPointer = await teamIntelligenceContentStorageService.storeJsonPayload({
        entityType: 'user-summary',
        entityId: userIngestion.id,
        contentType: 'raw-payload',
        payload: {
          pullRequests: generated.pullRequests,
          soloCommits: generated.soloCommits,
          employeeSummary: generated.employeeSummary,
          userSummary: generated.userSummary,
          teamAggregationPayload: generated.teamAggregationPayload,
          sourceData: generated.sourceData,
          summaryMetadata: generated.summaryMetadata,
        },
      });

      const completedUser = await teamIntelligenceRepository.updateUserIngestionSummary(userIngestionId, {
        contentUrl: contentPointer.contentUrl,
        contentSize: contentPointer.contentSize,
        contentChecksum: contentPointer.contentChecksum,
        processingStatus: TeamIntelligenceUserIngestionStatus.COMPLETED,
        completedAt: new Date(),
        failedAt: null,
        errorMessage: null,
      });
      if (!completedUser) {
        logger.warn(
          `[TEAM-INTEL-WORKER] User ingestion ${userIngestionId} was removed while job ${job.id} was running; discarding result`
        );
        return;
      }

      await this.triggerTeamSummariesForBatchIfReady({
        batchId,
        reportDate: userIngestion.reportDate,
        source: userIngestion.source,
        orgId: userIngestion.orgId ?? '',
      });

      await this.reconcileBatchStatus(batchId);

      logger.info(
        `[TEAM-INTEL-WORKER] Completed job ${job.id} batchId=${batchId} userIngestionId=${userIngestionId} userEmail=${userEmail}`
      );
    } catch (error) {
      if (this.isFinalAttempt(job)) {
        await this.handleJobFailure(job.data, error);
      } else {
        logger.warn(
          `[TEAM-INTEL-WORKER] User job ${job.id} failed attempt ${job.attemptsMade + 1}; keeping it non-terminal for retry`
        );
      }
      throw error;
    }
  }

  private async handleJobFailure(data: TeamIntelligenceQueuedJobData, error: unknown): Promise<void> {
    const failedUser = await teamIntelligenceRepository.updateUserStatus(data.userIngestionId, {
      processingStatus: TeamIntelligenceUserIngestionStatus.FAILED,
      failedAt: new Date(),
      errorMessage: error instanceof Error ? error.message : 'Unknown processing error',
    });
    if (!failedUser) {
      return;
    }

    await this.triggerTeamSummariesForBatchIfReady({
      batchId: data.batchId,
      reportDate: new Date(`${data.reportDate}T00:00:00.000Z`),
      source: data.source,
      orgId: data.orgId,
    });

    await this.reconcileBatchStatus(data.batchId);
  }

  private async processTeamSummaryJob(job: Bull.Job<TeamIntelligenceTeamSummaryQueuedJobData>): Promise<void> {
    const { batchId, teamSummaryId, teamId, teamName } = job.data;
    const startedAt = new Date();

    logger.info(
      `[TEAM-INTEL-WORKER] Processing team summary job ${job.id} batchId=${batchId} teamSummaryId=${teamSummaryId} teamId=${teamId ?? 'null'} teamName=${teamName}`
    );

    const teamSummary = await teamIntelligenceRepository.updateTeamSummaryStatus(teamSummaryId, {
      status: TeamIntelligenceBatchStatus.PROCESSING,
      startedAt,
      errorMessage: null,
      failedAt: null,
    });
    if (!teamSummary) {
      logger.warn(
        `[TEAM-INTEL-WORKER] Discarding stale team summary job ${job.id}; summary ${teamSummaryId} no longer exists`
      );
      return;
    }

    try {
      if (!teamSummary.teamId) {
        throw new Error(`Team summary ${teamSummaryId} is missing teamId`);
      }
      const teamId = teamSummary.teamId;

      const teamUsers = await teamIntelligenceRepository.findUsersByBatchAndTeam(batchId, teamId);
      const completedUsers = teamUsers.filter(
        (user) => user.processingStatus === TeamIntelligenceUserIngestionStatus.COMPLETED
      );

      if (completedUsers.length === 0) {
        throw new Error(`No completed users found for team=${teamSummary.teamName} batchId=${batchId}`);
      }

      const members = await Promise.all(completedUsers.map(async (user) => {
        const userContent = await teamIntelligenceContentStorageService.hydrateJsonPayload<{
          teamAggregationPayload?: TeamIntelligenceTeamAggregationPayload;
        }>(null, user.contentUrl);
        if (!userContent?.teamAggregationPayload) {
          throw new Error(
            `Completed user ${user.id} is missing teamAggregationPayload; reprocess the user summary`
          );
        }
        if (
          userContent.teamAggregationPayload.userIngestionId !== user.id ||
          userContent.teamAggregationPayload.user.teamId !== teamId
        ) {
          throw new Error(
            `User ${user.id} team aggregation identity does not match team=${teamId}`
          );
        }
        return userContent.teamAggregationPayload;
      }));

      const previousTeamSummary =
        await teamIntelligenceRepository.findPreviousCompletedTeamSummary(
          teamId,
          teamSummary.reportDate
        );
      let previousContinuityState: TeamIntelligenceContinuityState | null = null;
      const previousAgeDays = previousTeamSummary
        ? Math.floor(
            (teamSummary.reportDate.getTime() - previousTeamSummary.reportDate.getTime()) /
              (24 * 60 * 60 * 1000)
          )
        : null;
      if (
        previousTeamSummary?.contentUrl &&
        previousAgeDays !== null &&
        previousAgeDays > 0 &&
        previousAgeDays <= 14
      ) {
        const previousContent = await teamIntelligenceContentStorageService.hydrateJsonPayload<{
          continuityState?: unknown;
        }>(null, previousTeamSummary.contentUrl);
        const previousState = TeamIntelligenceContinuityStateSchema.safeParse(
          previousContent?.continuityState
        );
        if (previousState.success) {
          previousContinuityState = previousState.data;
        } else if (previousContent?.continuityState) {
          throw new Error(
            `Previous continuity state is invalid for teamId=${teamId} previousSummaryId=${previousTeamSummary.id}: ${previousState.error.message}`
          );
        }
      }

      const teamGoals = await mettleTeamGoalsService.fetchActiveTeamGoals(teamId);

      const generated = await teamIntelligenceTeamSummaryService.generate({
        batchId,
        teamSummaryId,
        reportDate: teamSummary.reportDate.toISOString().slice(0, 10),
        teamId,
        teamName: teamSummary.teamName,
        source: teamSummary.source,
        members,
        teamGoals,
        previousContinuityState,
        processingCoverage: {
          expectedMembers: teamUsers.length,
          completedUserSummaries: completedUsers.length,
          failedUserSummaries: teamUsers.length - completedUsers.length,
          missingMembers: teamUsers
            .filter((user) => user.processingStatus !== TeamIntelligenceUserIngestionStatus.COMPLETED)
            .map((user) => ({
              userEmail: user.userEmail,
              reason: user.errorMessage ?? `USER_SUMMARY_${user.processingStatus}`,
            })),
        },
      });

      const teamContentPointer = await teamIntelligenceContentStorageService.storeJsonPayload({
        entityType: 'team-summary',
        entityId: teamSummaryId,
        contentType: 'summary-text',
        payload: {
          summaryText: generated.summaryText,
          summaryMetadata: generated.summaryMetadata,
          provenance: generated.provenance,
          teamSummary: generated.teamSummary,
          continuityState: generated.continuityState,
          orgAggregationPayload: generated.orgAggregationPayload,
        },
      });

      const completedTeamSummary = await teamIntelligenceRepository.updateTeamSummaryResult(teamSummaryId, {
        contentUrl: teamContentPointer.contentUrl,
        contentSize: teamContentPointer.contentSize,
        contentChecksum: teamContentPointer.contentChecksum,
        totalUsers: teamSummary.totalUsers,
        completedUsers: teamSummary.completedUsers,
        failedUsers: teamSummary.failedUsers,
        status: TeamIntelligenceBatchStatus.COMPLETED,
        completedAt: new Date(),
        failedAt: null,
        errorMessage: null,
      });
      if (!completedTeamSummary) {
        logger.warn(
          `[TEAM-INTEL-WORKER] Team summary ${teamSummaryId} was removed while job ${job.id} was running; discarding result`
        );
        return;
      }

      logger.info(
        `[TEAM-INTEL-WORKER] Completed team summary job ${job.id} batchId=${batchId} teamSummaryId=${teamSummaryId} teamId=${teamId} teamName=${teamName}`
      );

      await this.triggerOrgSummaryIfReady({
        batchId,
        reportDate: teamSummary.reportDate,
        source: teamSummary.source,
        orgId: job.data.orgId,
      });
    } catch (error) {
      if (this.isFinalAttempt(job)) {
        await this.handleTeamSummaryJobFailure(job.data, error);
      } else {
        logger.warn(
          `[TEAM-INTEL-WORKER] Team summary job ${job.id} failed attempt ${job.attemptsMade + 1}; keeping it non-terminal for retry`
        );
      }
      throw error;
    }
  }

  private async handleTeamSummaryJobFailure(
    data: TeamIntelligenceTeamSummaryQueuedJobData,
    error: unknown
  ): Promise<void> {
    const failedTeamSummary = await teamIntelligenceRepository.updateTeamSummaryStatus(data.teamSummaryId, {
      status: TeamIntelligenceBatchStatus.FAILED,
      failedAt: new Date(),
      errorMessage: error instanceof Error ? error.message : 'Unknown team summary processing error',
    });
    if (!failedTeamSummary) {
      return;
    }

    await this.triggerOrgSummaryIfReady({
      batchId: data.batchId,
      reportDate: new Date(`${data.reportDate}T00:00:00.000Z`),
      source: data.source,
      orgId: data.orgId,
    });
  }

  private async processOrgSummaryJob(job: Bull.Job<TeamIntelligenceOrgSummaryQueuedJobData>): Promise<void> {
    const { batchId, orgSummaryId } = job.data;
    const startedAt = new Date();

    logger.info(
      `[TEAM-INTEL-WORKER] Processing org summary job ${job.id} batchId=${batchId} orgSummaryId=${orgSummaryId}`
    );

    const orgSummary = await teamIntelligenceRepository.updateOrgSummaryStatus(orgSummaryId, {
      status: TeamIntelligenceBatchStatus.PROCESSING,
      startedAt,
      errorMessage: null,
      failedAt: null,
    });
    if (!orgSummary) {
      logger.warn(
        `[TEAM-INTEL-WORKER] Discarding stale org summary job ${job.id}; summary ${orgSummaryId} no longer exists`
      );
      return;
    }

    try {
      const teamSummaries = await teamIntelligenceRepository.findTeamSummariesByBatchId(batchId);
      const completedOnly = teamSummaries.filter(
        (teamSummary) => teamSummary.status === TeamIntelligenceBatchStatus.COMPLETED
      );

      if (completedOnly.length === 0) {
        throw new Error(`No completed team summaries found for batchId=${batchId}`);
      }

      const orgId = orgSummary.orgId?.trim() || null;

      // Resolve the organization identity for the summary. orgId is stamped on
      // the org summary record at ingestion time. When unavailable (legacy records
      // created before this migration), fall back to a generic org identity.
      let organization: { id: string; name: string };
      if (orgId) {
        const org = await db.organization.findUnique({
          where: { orgId },
          select: { name: true },
        });
        organization = {
          id: orgId,
          name: org?.name ?? 'Organization',
        };
      } else {
        logger.warn(
          `[TEAM-INTEL-WORKER] No orgId for org summary ${orgSummaryId}; falling back to generic org identity`
        );
        organization = {
          id: appConfig.superposition.orgId || 'unknown',
          name: 'Organization',
        };
      }

      const teamPayloads = await Promise.all(
        completedOnly.map(async (teamSummary) => {
          const teamContent =
            await teamIntelligenceContentStorageService.hydrateJsonPayload<{
              orgAggregationPayload?: TeamIntelligenceOrgAggregationPayload;
            }>(null, teamSummary.contentUrl);
          const payload = teamContent?.orgAggregationPayload;
          if (!payload) {
            throw new Error(
              `Completed team summary ${teamSummary.id} has no organization aggregation payload`
            );
          }
          if (
            payload.teamSummaryId !== teamSummary.id ||
            payload.team.id !== teamSummary.teamId ||
            payload.reportDate !== teamSummary.reportDate.toISOString().slice(0, 10)
          ) {
            throw new Error(
              `Organization aggregation payload identity does not match team summary ${teamSummary.id}`
            );
          }
          return payload;
        })
      );

      let previousContinuityState: TeamIntelligenceOrgContinuityState | null = null;
      const previousOrgSummary = orgId
        ? await teamIntelligenceRepository.findPreviousCompletedOrgSummary(
            orgId,
            orgSummary.reportDate
          )
        : null;
      if (previousOrgSummary?.contentUrl) {
        const ageInDays = Math.floor(
          (orgSummary.reportDate.getTime() - previousOrgSummary.reportDate.getTime()) /
            (24 * 60 * 60 * 1000)
        );
        if (ageInDays >= 1 && ageInDays <= 14) {
          const previousContent =
            await teamIntelligenceContentStorageService.hydrateJsonPayload<{
              continuityState?: unknown;
            }>(null, previousOrgSummary.contentUrl);
          if (previousContent?.continuityState !== undefined) {
            const parsedContinuity =
              TeamIntelligenceOrgContinuityStateSchema.safeParse(
                previousContent.continuityState
              );
            if (!parsedContinuity.success) {
              throw new Error(
                `Previous organization continuity state ${previousOrgSummary.id} is invalid: ${parsedContinuity.error.message}`
              );
            }
            previousContinuityState = parsedContinuity.data;
          }
        }
      }

      const missingTeams = teamSummaries
        .filter(
          (teamSummary) =>
            teamSummary.status !== TeamIntelligenceBatchStatus.COMPLETED
        )
        .map((teamSummary) => ({
          teamId: teamSummary.teamId ?? `unassigned:${teamSummary.id}`,
          teamName: teamSummary.teamName,
          reason:
            teamSummary.errorMessage ??
            `Team summary ended with status ${teamSummary.status}`,
        }));

      const generated = await teamIntelligenceOrgSummaryService.generate({
        batchId,
        reportDate: orgSummary.reportDate.toISOString().slice(0, 10),
        source: orgSummary.source,
        organization,
        teams: teamPayloads,
        previousContinuityState,
        processingCoverage: {
          expectedTeams: teamSummaries.length,
          completedTeamSummaries: completedOnly.length,
          failedTeamSummaries: missingTeams.length,
          missingTeams,
        },
      });

      const orgContentPointer = await teamIntelligenceContentStorageService.storeJsonPayload({
        entityType: 'org-summary',
        entityId: orgSummaryId,
        contentType: 'summary-text',
        payload: {
          summaryText: generated.summaryText,
          summaryMetadata: generated.summaryMetadata,
          provenance: generated.provenance,
          orgSummary: generated.orgSummary,
          continuityState: generated.continuityState,
        },
      });

      const completedOrgSummary = await teamIntelligenceRepository.updateOrgSummaryResult(orgSummaryId, {
        contentUrl: orgContentPointer.contentUrl,
        contentSize: orgContentPointer.contentSize,
        contentChecksum: orgContentPointer.contentChecksum,
        totalTeams: orgSummary.totalTeams,
        completedTeams: orgSummary.completedTeams,
        failedTeams: orgSummary.failedTeams,
        status: TeamIntelligenceBatchStatus.COMPLETED,
        completedAt: new Date(),
        failedAt: null,
        errorMessage: null,
      });
      if (!completedOrgSummary) {
        logger.warn(
          `[TEAM-INTEL-WORKER] Org summary ${orgSummaryId} was removed while job ${job.id} was running; discarding result`
        );
        return;
      }

      logger.info(
        `[TEAM-INTEL-WORKER] Completed org summary job ${job.id} batchId=${batchId} orgSummaryId=${orgSummaryId}`
      );
    } catch (error) {
      if (this.isFinalAttempt(job)) {
        await this.handleOrgSummaryJobFailure(job.data, error);
      } else {
        logger.warn(
          `[TEAM-INTEL-WORKER] Org summary job ${job.id} failed attempt ${job.attemptsMade + 1}; keeping it non-terminal for retry`
        );
      }
      throw error;
    }
  }

  private async handleOrgSummaryJobFailure(
    data: TeamIntelligenceOrgSummaryQueuedJobData,
    error: unknown
  ): Promise<void> {
    const failedOrgSummary = await teamIntelligenceRepository.updateOrgSummaryStatus(data.orgSummaryId, {
      status: TeamIntelligenceBatchStatus.FAILED,
      failedAt: new Date(),
      errorMessage: error instanceof Error ? error.message : 'Unknown org summary processing error',
    });
    if (!failedOrgSummary) {
      return;
    }
  }

  private async triggerTeamSummaryIfReady(input: {
    batchId: string;
    reportDate: Date;
    teamId: string | null;
    teamName: string | null;
    source: string;
    orgId: string;
  }): Promise<void> {
    const teamName = input.teamName?.trim() || 'No Team';
    const teamId = input.teamId?.trim() || null;
    if (!teamId) {
      logger.warn('[TEAM-INTEL-WORKER] Skipping team summary trigger because teamId is missing', {
        batchId: input.batchId,
        teamName,
        reportDate: input.reportDate.toISOString().slice(0, 10),
      });
      return;
    }

    const progress = await teamIntelligenceRepository.getTeamProgress(input.batchId, teamId);
    const terminalUsers = progress.completedUsers + progress.failedUsers;

    if (progress.totalUsers === 0 || terminalUsers !== progress.totalUsers) {
      return;
    }

    let teamSummary = await teamIntelligenceRepository.findTeamSummaryByBatchAndTeam(input.batchId, teamId);
    if (!teamSummary) {
      try {
        teamSummary = await teamIntelligenceRepository.createTeamSummary({
          orgId: input.orgId || null,
          batchId: input.batchId,
          reportDate: input.reportDate,
          source: input.source,
          teamId,
          teamName,
          idempotencyKey: `team-intelligence-team:${input.batchId}:${teamId}:${input.reportDate.toISOString().slice(0, 10)}`,
          totalUsers: progress.totalUsers,
          completedUsers: progress.completedUsers,
          failedUsers: progress.failedUsers,
          status: progress.completedUsers > 0 ? TeamIntelligenceBatchStatus.RECEIVED : TeamIntelligenceBatchStatus.FAILED,
          errorMessage: progress.completedUsers === 0 ? 'No completed users available for team summary generation' : null,
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          teamSummary = await teamIntelligenceRepository.findTeamSummaryByBatchAndTeam(input.batchId, teamId);
          if (!teamSummary) {
            throw error;
          }
        } else {
          throw error;
        }
      }
    } else if (
      teamSummary.status === TeamIntelligenceBatchStatus.COMPLETED ||
      teamSummary.status === TeamIntelligenceBatchStatus.PROCESSING ||
      teamSummary.status === TeamIntelligenceBatchStatus.QUEUED
    ) {
      return;
    } else {
      teamSummary = await teamIntelligenceRepository.updateTeamSummaryStatus(teamSummary.id, {
        teamName,
        totalUsers: progress.totalUsers,
        completedUsers: progress.completedUsers,
        failedUsers: progress.failedUsers,
        status: progress.completedUsers > 0 ? TeamIntelligenceBatchStatus.RECEIVED : TeamIntelligenceBatchStatus.FAILED,
        errorMessage: progress.completedUsers === 0 ? 'No completed users available for team summary generation' : null,
      });
    }

    if (!teamSummary) {
      // Record was removed (e.g. table truncated while a stale job was queued).
      logger.warn(
        `[TEAM-INTEL-WORKER] Team summary record vanished during trigger batchId=${input.batchId} teamId=${teamId}; skipping`
      );
      return;
    }

    if (progress.completedUsers === 0) {
      return;
    }

    const enqueueResult = await teamIntelligenceTeamSummaryQueue.enqueueTeamSummaryJob({
      batchId: input.batchId,
      teamSummaryId: teamSummary.id,
      reportDate: input.reportDate.toISOString().slice(0, 10),
      teamId,
      teamName,
      source: input.source,
      orgId: input.orgId,
    });

    if (enqueueResult.enqueued || enqueueResult.duplicateJobState) {
      await teamIntelligenceRepository.updateTeamSummaryStatus(teamSummary.id, {
        totalUsers: progress.totalUsers,
        completedUsers: progress.completedUsers,
        failedUsers: progress.failedUsers,
        status: TeamIntelligenceBatchStatus.QUEUED,
        queueJobId: enqueueResult.jobId,
        queuedAt: new Date(),
        errorMessage: null,
      });
    }
  }

  private async triggerTeamSummariesForBatchIfReady(input: {
    batchId: string;
    reportDate: Date;
    source: string;
    orgId: string;
  }): Promise<void> {
    const batchProgress = await teamIntelligenceRepository.getBatchProgress(input.batchId);
    const terminalUsers = batchProgress.completedUsers + batchProgress.failedUsers;

    if (batchProgress.totalUsers === 0 || terminalUsers !== batchProgress.totalUsers) {
      return;
    }

    const users = await teamIntelligenceRepository.findUsersByBatchId(input.batchId);
    const teams = new Map<string, { teamId: string; teamName: string }>();
    for (const user of users) {
      const teamId = user.teamId?.trim();
      if (!teamId || teams.has(teamId)) {
        continue;
      }
      teams.set(teamId, {
        teamId,
        teamName: user.teamName?.trim() || 'No Team',
      });
    }

    logger.info('[TEAM-INTEL-WORKER] Batch users terminal; triggering ready team summaries', {
      batchId: input.batchId,
      totalUsers: batchProgress.totalUsers,
      completedUsers: batchProgress.completedUsers,
      failedUsers: batchProgress.failedUsers,
      teamCount: teams.size,
    });

    await Promise.all(
      [...teams.values()].map((team) =>
        this.triggerTeamSummaryIfReady({
          batchId: input.batchId,
          reportDate: input.reportDate,
          teamId: team.teamId,
          teamName: team.teamName,
          source: input.source,
          orgId: input.orgId,
        })
      )
    );
  }

  private async triggerOrgSummaryIfReady(input: {
    batchId: string;
    reportDate: Date;
    source: string;
    orgId: string;
  }): Promise<void> {
    const batchProgress = await teamIntelligenceRepository.getBatchProgress(input.batchId);
    const terminalUsers = batchProgress.completedUsers + batchProgress.failedUsers;
    if (batchProgress.totalUsers === 0 || terminalUsers !== batchProgress.totalUsers) {
      return;
    }

    const progress = await teamIntelligenceRepository.getOrgProgress(input.batchId);
    const terminalTeams = progress.completedTeams + progress.failedTeams;

    if (progress.totalTeams === 0 || terminalTeams !== progress.totalTeams) {
      return;
    }

    let orgSummary = await teamIntelligenceRepository.findOrgSummaryByBatchId(input.batchId);
    if (!orgSummary) {
      orgSummary = await teamIntelligenceRepository.createOrgSummary({
        orgId: input.orgId || null,
        batchId: input.batchId,
        reportDate: input.reportDate,
        source: input.source,
        idempotencyKey: `team-intelligence-org:${input.batchId}:${input.reportDate.toISOString().slice(0, 10)}`,
        totalTeams: progress.totalTeams,
        completedTeams: progress.completedTeams,
        failedTeams: progress.failedTeams,
        status: progress.completedTeams > 0 ? TeamIntelligenceBatchStatus.RECEIVED : TeamIntelligenceBatchStatus.FAILED,
        errorMessage: progress.completedTeams === 0 ? 'No completed team summaries available for org summary generation' : null,
      });
    } else if (
      orgSummary.status === TeamIntelligenceBatchStatus.COMPLETED ||
      orgSummary.status === TeamIntelligenceBatchStatus.PROCESSING ||
      orgSummary.status === TeamIntelligenceBatchStatus.QUEUED
    ) {
      return;
    } else {
      orgSummary = await teamIntelligenceRepository.updateOrgSummaryStatus(orgSummary.id, {
        totalTeams: progress.totalTeams,
        completedTeams: progress.completedTeams,
        failedTeams: progress.failedTeams,
        status: progress.completedTeams > 0 ? TeamIntelligenceBatchStatus.RECEIVED : TeamIntelligenceBatchStatus.FAILED,
        errorMessage: progress.completedTeams === 0 ? 'No completed team summaries available for org summary generation' : null,
      });
    }

    if (!orgSummary) {
      // Record was removed (e.g. table truncated while a stale job was queued).
      logger.warn(
        `[TEAM-INTEL-WORKER] Org summary record vanished during trigger batchId=${input.batchId}; skipping`
      );
      return;
    }

    if (progress.completedTeams === 0) {
      return;
    }

    const enqueueResult = await teamIntelligenceOrgSummaryQueue.enqueueOrgSummaryJob({
      batchId: input.batchId,
      orgSummaryId: orgSummary.id,
      reportDate: input.reportDate.toISOString().slice(0, 10),
      source: input.source,
      orgId: input.orgId,
    });

    if (enqueueResult.enqueued || enqueueResult.duplicateJobState) {
      await teamIntelligenceRepository.updateOrgSummaryStatus(orgSummary.id, {
        totalTeams: progress.totalTeams,
        completedTeams: progress.completedTeams,
        failedTeams: progress.failedTeams,
        status: TeamIntelligenceBatchStatus.QUEUED,
        queueJobId: enqueueResult.jobId,
        queuedAt: new Date(),
        errorMessage: null,
      });
    }
  }

  private async reconcileBatchStatus(batchId: string): Promise<void> {
    const progress = await teamIntelligenceRepository.getBatchProgress(batchId);
    const completedOrFailedUsers = progress.completedUsers + progress.failedUsers;
    const allFinished = progress.totalUsers > 0 && completedOrFailedUsers === progress.totalUsers;

    if (!allFinished) {
      await teamIntelligenceRepository.updateBatchStatus(batchId, {
        status: TeamIntelligenceBatchStatus.PROCESSING,
        failedUsers: progress.failedUsers,
        queuedUsers: progress.totalUsers - progress.failedUsers,
        errorMessage: progress.failedUsers > 0 ? 'Some team intelligence summaries failed during processing' : null,
      });
      return;
    }

    const completedAt = new Date();

    if (progress.failedUsers === 0) {
      await teamIntelligenceRepository.updateBatchStatus(batchId, {
        status: TeamIntelligenceBatchStatus.COMPLETED,
        queuedUsers: progress.totalUsers,
        failedUsers: 0,
        completedAt,
        errorMessage: null,
      });
      return;
    }

    if (progress.completedUsers === 0) {
      await teamIntelligenceRepository.updateBatchStatus(batchId, {
        status: TeamIntelligenceBatchStatus.FAILED,
        queuedUsers: 0,
        failedUsers: progress.failedUsers,
        completedAt,
        errorMessage: 'All team intelligence summaries failed during processing',
      });
      return;
    }

    await teamIntelligenceRepository.updateBatchStatus(batchId, {
      status: TeamIntelligenceBatchStatus.COMPLETED,
      queuedUsers: progress.completedUsers,
      failedUsers: progress.failedUsers,
      completedAt,
      errorMessage: `Completed with partial failures (${progress.failedUsers}/${progress.totalUsers})`,
    });
  }

  async shutdown(): Promise<void> {
    await teamIntelligenceQueue.close();
    await teamIntelligenceTeamSummaryQueue.close();
    await teamIntelligenceOrgSummaryQueue.close();
    this.isInitialized = false;
    logger.info('[TEAM-INTEL-WORKER] Shut down');
  }
}

export const teamIntelligenceWorker = new TeamIntelligenceWorker();
