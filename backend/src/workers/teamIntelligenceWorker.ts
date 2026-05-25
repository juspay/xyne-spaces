import Bull from 'bull';
import { Prisma } from '@prisma/client';
import {
  TeamIntelligenceBatchStatus,
  TeamIntelligenceUserIngestionStatus,
} from '@prisma/client';
import { logger } from '@/utils/logger';
import { teamIntelligenceQueue } from '@/team-intelligence/queue';
import { teamIntelligenceTeamSummaryQueue } from '@/team-intelligence/team-summary.queue';
import { teamIntelligenceOrgSummaryQueue } from '@/team-intelligence/org-summary.queue';
import { teamIntelligenceRepository } from '@/team-intelligence/repositories/team-intelligence.repository';
import { teamIntelligenceSummaryService } from '@/team-intelligence/services/team-intelligence-summary.service';
import { teamIntelligenceTeamSummaryService } from '@/team-intelligence/services/team-intelligence-team-summary.service';
import { teamIntelligenceOrgSummaryService } from '@/team-intelligence/services/team-intelligence-org-summary.service';
import type {
  TeamIntelligenceOrgSummaryQueuedJobData,
  TeamIntelligenceQueuedJobData,
  TeamIntelligenceTeamSummaryQueuedJobData,
} from '@/team-intelligence/types';

class TeamIntelligenceWorker {
  private isInitialized = false;
  private readonly staleJobThresholdMs = 2 * 60 * 1000;

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

    queue.process('ingest-user', 5, async (job: Bull.Job<TeamIntelligenceQueuedJobData>) => {
      return this.processJob(job);
    });

    teamQueue.process('summarize-team', 2, async (job: Bull.Job<TeamIntelligenceTeamSummaryQueuedJobData>) => {
      return this.processTeamSummaryJob(job);
    });

    orgQueue.process('summarize-org', 1, async (job: Bull.Job<TeamIntelligenceOrgSummaryQueuedJobData>) => {
      return this.processOrgSummaryJob(job);
    });

    queue.on('failed', async (job, err) => {
      logger.error(
        `[TEAM-INTEL-WORKER] Job ${job.id} permanently failed after ${job.attemptsMade} attempts ` +
        `batchId=${job.data.batchId} userIngestionId=${job.data.userIngestionId}:`,
        err,
      );

      await this.handleJobFailure(job.data, err);
    });

    teamQueue.on('failed', async (job, err) => {
      logger.error(
        `[TEAM-INTEL-WORKER] Team summary job ${job.id} permanently failed after ${job.attemptsMade} attempts ` +
        `batchId=${job.data.batchId} teamSummaryId=${job.data.teamSummaryId}:`,
        err,
      );

      await this.handleTeamSummaryJobFailure(job.data, err);
    });

    orgQueue.on('failed', async (job, err) => {
      logger.error(
        `[TEAM-INTEL-WORKER] Org summary job ${job.id} permanently failed after ${job.attemptsMade} attempts ` +
        `batchId=${job.data.batchId} orgSummaryId=${job.data.orgSummaryId}:`,
        err,
      );

      await this.handleOrgSummaryJobFailure(job.data, err);
    });

    await this.recoverInterruptedJobs();

    this.isInitialized = true;
    logger.info('[TEAM-INTEL-WORKER] Started, ready to process jobs');
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

    await teamIntelligenceRepository.updateUserStatus(userIngestionId, {
      processingStatus: TeamIntelligenceUserIngestionStatus.PROCESSING,
      startedAt,
      errorMessage: null,
      failedAt: null,
    });

    await teamIntelligenceRepository.updateBatchStatus(batchId, {
      status: TeamIntelligenceBatchStatus.PROCESSING,
      errorMessage: null,
    });

    try {
      const userIngestion = await teamIntelligenceRepository.findUserIngestionById(userIngestionId);
      if (!userIngestion) {
        throw new Error(`User ingestion record not found for id=${userIngestionId}`);
      }

      const generated = await teamIntelligenceSummaryService.generate({
        pullRequests: userIngestion.pullRequests,
        soloCommits: userIngestion.soloCommits,
        aiUsage: userIngestion.aiUsage,
        userName: userIngestion.userName,
        teamName: userIngestion.teamName,
        reportDate: userIngestion.reportDate,
      });

      await teamIntelligenceRepository.updateUserIngestionSummary(userIngestionId, {
        pullRequests: generated.pullRequests,
        soloCommits: generated.soloCommits,
        employeeSummary: generated.employeeSummary as Prisma.InputJsonValue,
        summaryMetadata: generated.summaryMetadata,
        processingStatus: TeamIntelligenceUserIngestionStatus.COMPLETED,
        completedAt: new Date(),
        failedAt: null,
        errorMessage: null,
      });

      await this.triggerTeamSummaryIfReady({
        batchId,
        reportDate: userIngestion.reportDate,
        teamId: userIngestion.teamId,
        teamName: userIngestion.teamName,
        source: userIngestion.source,
      });

      await this.reconcileBatchStatus(batchId);

      logger.info(
        `[TEAM-INTEL-WORKER] Completed job ${job.id} batchId=${batchId} userIngestionId=${userIngestionId} userEmail=${userEmail}`
      );
    } catch (error) {
      await this.handleJobFailure(job.data, error);
      throw error;
    }
  }

  private async handleJobFailure(data: TeamIntelligenceQueuedJobData, error: unknown): Promise<void> {
    await teamIntelligenceRepository.updateUserStatus(data.userIngestionId, {
      processingStatus: TeamIntelligenceUserIngestionStatus.FAILED,
      failedAt: new Date(),
      errorMessage: error instanceof Error ? error.message : 'Unknown processing error',
    });

    await this.triggerTeamSummaryIfReady({
      batchId: data.batchId,
      reportDate: new Date(`${data.reportDate}T00:00:00.000Z`),
      teamId: data.teamId,
      teamName: data.teamName,
      source: data.source,
    });

    await this.reconcileBatchStatus(data.batchId);
  }

  private async processTeamSummaryJob(job: Bull.Job<TeamIntelligenceTeamSummaryQueuedJobData>): Promise<void> {
    const { batchId, teamSummaryId, teamName } = job.data;
    const startedAt = new Date();

    logger.info(
      `[TEAM-INTEL-WORKER] Processing team summary job ${job.id} batchId=${batchId} teamSummaryId=${teamSummaryId} teamName=${teamName}`
    );

    await teamIntelligenceRepository.updateTeamSummaryStatus(teamSummaryId, {
      status: TeamIntelligenceBatchStatus.PROCESSING,
      startedAt,
      errorMessage: null,
      failedAt: null,
    });

    try {
      const teamSummary = await teamIntelligenceRepository.findTeamSummaryById(teamSummaryId);
      if (!teamSummary) {
        throw new Error(`Team summary record not found for id=${teamSummaryId}`);
      }

      const completedUsers = await teamIntelligenceRepository.findUsersByBatchAndTeam(
        batchId,
        teamSummary.teamId,
        teamSummary.teamName,
        [TeamIntelligenceUserIngestionStatus.COMPLETED]
      );

      if (completedUsers.length === 0) {
        throw new Error(`No completed users found for team=${teamSummary.teamName} batchId=${batchId}`);
      }

      const generated = await teamIntelligenceTeamSummaryService.generate({
        reportDate: teamSummary.reportDate.toISOString().slice(0, 10),
        teamName: teamSummary.teamName,
        source: teamSummary.source,
        users: completedUsers.map((user) => ({
          userId: user.id,
          userEmail: user.userEmail,
          userName: user.userName,
          teamId: user.teamId,
          teamName: user.teamName ?? teamSummary.teamName,
          source: user.source,
          pullRequests: user.pullRequests as unknown as [],
          soloCommits: user.soloCommits as unknown as [],
          aiUsage: user.aiUsage as unknown as null,
        })),
      });

      await teamIntelligenceRepository.updateTeamSummaryResult(teamSummaryId, {
        summaryText: generated.summaryText as Prisma.InputJsonValue,
        summaryMetadata: generated.summaryMetadata as Prisma.InputJsonValue,
        provenance: generated.provenance as unknown as Prisma.InputJsonValue,
        totalUsers: teamSummary.totalUsers,
        completedUsers: teamSummary.completedUsers,
        failedUsers: teamSummary.failedUsers,
        status: TeamIntelligenceBatchStatus.COMPLETED,
        completedAt: new Date(),
        failedAt: null,
        errorMessage: null,
      });

      logger.info(
        `[TEAM-INTEL-WORKER] Completed team summary job ${job.id} batchId=${batchId} teamSummaryId=${teamSummaryId} teamName=${teamName}`
      );

      await this.triggerOrgSummaryIfReady({
        batchId,
        reportDate: teamSummary.reportDate,
        source: teamSummary.source,
      });
    } catch (error) {
      await this.handleTeamSummaryJobFailure(job.data, error);
      throw error;
    }
  }

  private async handleTeamSummaryJobFailure(
    data: TeamIntelligenceTeamSummaryQueuedJobData,
    error: unknown
  ): Promise<void> {
    await teamIntelligenceRepository.updateTeamSummaryStatus(data.teamSummaryId, {
      status: TeamIntelligenceBatchStatus.FAILED,
      failedAt: new Date(),
      errorMessage: error instanceof Error ? error.message : 'Unknown team summary processing error',
    });

    await this.triggerOrgSummaryIfReady({
      batchId: data.batchId,
      reportDate: new Date(`${data.reportDate}T00:00:00.000Z`),
      source: data.source,
    });
  }

  private async processOrgSummaryJob(job: Bull.Job<TeamIntelligenceOrgSummaryQueuedJobData>): Promise<void> {
    const { batchId, orgSummaryId } = job.data;
    const startedAt = new Date();

    logger.info(
      `[TEAM-INTEL-WORKER] Processing org summary job ${job.id} batchId=${batchId} orgSummaryId=${orgSummaryId}`
    );

    await teamIntelligenceRepository.updateOrgSummaryStatus(orgSummaryId, {
      status: TeamIntelligenceBatchStatus.PROCESSING,
      startedAt,
      errorMessage: null,
      failedAt: null,
    });

    try {
      const orgSummary = await teamIntelligenceRepository.findOrgSummaryById(orgSummaryId);
      if (!orgSummary) {
        throw new Error(`Org summary record not found for id=${orgSummaryId}`);
      }

      const completedTeamSummaries = await teamIntelligenceRepository.findTeamSummariesByBatchId(batchId);
      const completedOnly = completedTeamSummaries.filter(
        (teamSummary) => teamSummary.status === TeamIntelligenceBatchStatus.COMPLETED
      );

      if (completedOnly.length === 0) {
        throw new Error(`No completed team summaries found for batchId=${batchId}`);
      }

      const generated = await teamIntelligenceOrgSummaryService.generate({
        reportDate: orgSummary.reportDate.toISOString().slice(0, 10),
        source: orgSummary.source,
        teamSummaries: completedOnly.map((teamSummary) => ({
          reportDate: teamSummary.reportDate.toISOString().slice(0, 10),
          teamName: teamSummary.teamName,
          source: teamSummary.source,
          summaryText: teamSummary.summaryText as unknown as string[],
          summaryMetadata: teamSummary.summaryMetadata as unknown as never,
          provenance: teamSummary.provenance as unknown as never,
        })),
      });

      await teamIntelligenceRepository.updateOrgSummaryResult(orgSummaryId, {
        summaryText: generated.summaryText as Prisma.InputJsonValue,
        summaryMetadata: generated.summaryMetadata as Prisma.InputJsonValue,
        provenance: generated.provenance as unknown as Prisma.InputJsonValue,
        totalTeams: orgSummary.totalTeams,
        completedTeams: orgSummary.completedTeams,
        failedTeams: orgSummary.failedTeams,
        status: TeamIntelligenceBatchStatus.COMPLETED,
        completedAt: new Date(),
        failedAt: null,
        errorMessage: null,
      });

      logger.info(
        `[TEAM-INTEL-WORKER] Completed org summary job ${job.id} batchId=${batchId} orgSummaryId=${orgSummaryId}`
      );
    } catch (error) {
      await this.handleOrgSummaryJobFailure(job.data, error);
      throw error;
    }
  }

  private async handleOrgSummaryJobFailure(
    data: TeamIntelligenceOrgSummaryQueuedJobData,
    error: unknown
  ): Promise<void> {
    await teamIntelligenceRepository.updateOrgSummaryStatus(data.orgSummaryId, {
      status: TeamIntelligenceBatchStatus.FAILED,
      failedAt: new Date(),
      errorMessage: error instanceof Error ? error.message : 'Unknown org summary processing error',
    });
  }

  private async triggerTeamSummaryIfReady(input: {
    batchId: string;
    reportDate: Date;
    teamId: string | null;
    teamName: string | null;
    source: string;
  }): Promise<void> {
    const teamName = input.teamName?.trim() || 'No Team';
    const teamId = input.teamId?.trim() || null;
    const progress = await teamIntelligenceRepository.getTeamProgress(input.batchId, teamId, teamName);
    const terminalUsers = progress.completedUsers + progress.failedUsers;

    if (progress.totalUsers === 0 || terminalUsers !== progress.totalUsers) {
      return;
    }

    let teamSummary = await teamIntelligenceRepository.findTeamSummaryByBatchAndTeam(input.batchId, teamId, teamName);
    if (!teamSummary) {
      teamSummary = await teamIntelligenceRepository.createTeamSummary({
        batchId: input.batchId,
        reportDate: input.reportDate,
        source: input.source,
        teamId,
        teamName,
        idempotencyKey: `team-intelligence-team:${input.batchId}:${teamId ?? 'null'}:${teamName}:${input.reportDate.toISOString().slice(0, 10)}`,
        totalUsers: progress.totalUsers,
        completedUsers: progress.completedUsers,
        failedUsers: progress.failedUsers,
        status: progress.completedUsers > 0 ? TeamIntelligenceBatchStatus.RECEIVED : TeamIntelligenceBatchStatus.FAILED,
        errorMessage: progress.completedUsers === 0 ? 'No completed users available for team summary generation' : null,
      });
    } else if (
      teamSummary.status === TeamIntelligenceBatchStatus.COMPLETED ||
      teamSummary.status === TeamIntelligenceBatchStatus.PROCESSING ||
      teamSummary.status === TeamIntelligenceBatchStatus.QUEUED
    ) {
      return;
    } else {
      teamSummary = await teamIntelligenceRepository.updateTeamSummaryStatus(teamSummary.id, {
        totalUsers: progress.totalUsers,
        completedUsers: progress.completedUsers,
        failedUsers: progress.failedUsers,
        status: progress.completedUsers > 0 ? TeamIntelligenceBatchStatus.RECEIVED : TeamIntelligenceBatchStatus.FAILED,
        errorMessage: progress.completedUsers === 0 ? 'No completed users available for team summary generation' : null,
      });
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

  private async triggerOrgSummaryIfReady(input: {
    batchId: string;
    reportDate: Date;
    source: string;
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

    if (progress.completedTeams === 0) {
      return;
    }

    const enqueueResult = await teamIntelligenceOrgSummaryQueue.enqueueOrgSummaryJob({
      batchId: input.batchId,
      orgSummaryId: orgSummary.id,
      reportDate: input.reportDate.toISOString().slice(0, 10),
      source: input.source,
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
