import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '@/utils/logger';
import { TeamIntelligenceSyncRequestSchema } from '../validation';
import type {
  TeamIntelligenceAiUsageInput,
  TeamIntelligenceCommitInput,
  TeamIntelligenceNormalizedCommit,
  TeamIntelligenceNormalizedPullRequest,
  TeamIntelligenceNormalizedUserRecord,
  TeamIntelligencePullRequestInput,
  TeamIntelligenceSyncRequest,
  TeamIntelligenceSyncRequestMetadata,
  TeamIntelligenceUserInput,
  TeamIntelligenceIngestionResponse,
} from '../types';
import {
  teamIntelligenceRepository,
  type TeamIntelligenceBatchWithUsers,
  type CreateTeamIntelligenceBatchData,
  type CreateTeamIntelligenceUserData,
} from '../repositories/team-intelligence.repository';
import { teamIntelligenceQueue } from '../queue';
import { teamIntelligenceContentStorageService } from './team-intelligence-content-storage.service';
import { Prisma } from '@prisma/client';
import { TeamIntelligenceBatchStatus, TeamIntelligenceUserIngestionStatus } from '@xyne/shared';
import { config as appConfig } from '@/config/env';
import { db } from '@/database/client';

export class TeamIntelligenceIdempotencyConflictError extends Error {
  constructor() {
    super('Idempotency key conflict: payload does not match original request');
    this.name = 'TeamIntelligenceIdempotencyConflictError';
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function stableStringify(value: unknown): string {
  if (value === undefined) {
    return '"__undefined__"';
  }

  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(item => stableStringify(item)).join(',')}]`;
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const entries = keys.map(key => `${JSON.stringify(key)}:${stableStringify(record[key])}`);
  return `{${entries.join(',')}}`;
}

function compareStrings(left: string, right: string): number {
  return left.localeCompare(right);
}

function normalizeCommit(commit: TeamIntelligenceCommitInput): TeamIntelligenceNormalizedCommit {
  return {
    ...commit,
    ingestionId: uuidv4(),
  };
}

function normalizePullRequest(
  pullRequest: TeamIntelligencePullRequestInput
): TeamIntelligenceNormalizedPullRequest {
  return {
    ...pullRequest,
    ingestionId: uuidv4(),
    diff: pullRequest.diff
      ? {
          ...pullRequest.diff,
        }
      : {
          filesChanged: 0,
          additions: 0,
          deletions: 0,
        },
    commits: (pullRequest.commits ?? []).map(commit => normalizeCommit(commit)),
  };
}

function resolveSoloCommits(user: TeamIntelligenceUserInput): TeamIntelligenceCommitInput[] {
  const candidateValues = [user.soloCommits, user.commits, user.Commits];
  for (const value of candidateValues) {
    if (Array.isArray(value)) {
      return value;
    }
  }
  return [];
}

function resolveAiUsage(user: TeamIntelligenceUserInput): TeamIntelligenceAiUsageInput | null {
  return user.aiUsage ?? null;
}

function canonicalizeUserForHash(user: TeamIntelligenceUserInput): Record<string, unknown> {
  const pullRequests = [...(user.pullRequests ?? [])]
    .map((pullRequest) => ({
      ...pullRequest,
      commits: [...(pullRequest.commits ?? [])].sort((left, right) => {
        const leftKey = `${left.commitId}:${left.timestamp}`;
        const rightKey = `${right.commitId}:${right.timestamp}`;
        return compareStrings(leftKey, rightKey);
      }),
    }))
    .sort((left, right) => compareStrings(`${left.prId}`, `${right.prId}`));

  const soloCommits = [...resolveSoloCommits(user)].sort((left, right) => {
    const leftKey = `${left.commitId}:${left.timestamp}`;
    const rightKey = `${right.commitId}:${right.timestamp}`;
    return compareStrings(leftKey, rightKey);
  });

  return {
    userEmail: normalizeEmail(user.userEmail),
    userName: user.userName.trim(),
    teamId: user.teamId?.trim() || null,
    teamName: user.teamName?.trim() || null,
    source: (user.source ?? 'mettle').trim(),
    pullRequests,
    soloCommits,
    aiUsage: resolveAiUsage(user),
  };
}

function canonicalizeRequestForHash(request: TeamIntelligenceSyncRequest): Record<string, unknown> {
  return {
    reportDate: request.reportDate,
    source: request.source ?? 'mettle',
    users: [...request.users]
      .map(canonicalizeUserForHash)
      .sort((left, right) => compareStrings(String(left.userEmail), String(right.userEmail))),
  };
}

function buildRequestChecksum(request: TeamIntelligenceSyncRequest): string {
  const canonicalRequest = canonicalizeRequestForHash(request);
  return createHash('sha256').update(stableStringify(canonicalRequest)).digest('hex');
}

function startOfUtcDay(reportDate: string): Date {
  return new Date(`${reportDate}T00:00:00.000Z`);
}

async function resolveDefaultOrgId(): Promise<string | null> {
  const workspaceId = appConfig.defaultWorkspaceId?.trim();
  if (!workspaceId) return null;
  const mapping = await db.workspaceOrganization.findFirst({
    where: { workspaceId },
    select: { orgId: true },
  });
  return mapping?.orgId ?? null;
}

class TeamIntelligenceService {
  async getOrgSummaryByBatchId(batchId: string): Promise<{
    id: string;
    batchId: string;
    reportDate: string;
    source: string;
    summaryText: unknown;
    summaryMetadata: unknown;
    provenance: unknown;
    status: TeamIntelligenceBatchStatus;
    totalTeams: number;
    completedTeams: number;
    failedTeams: number;
    errorMessage: string | null;
    createdAt: string;
    updatedAt: string;
  } | null> {
    const orgSummary = await teamIntelligenceRepository.findOrgSummaryByBatchId(batchId);
    if (!orgSummary) {
      return null;
    }

    const hydrated = await teamIntelligenceContentStorageService.hydrateJsonPayload<{
      summaryText?: unknown;
      summaryMetadata?: unknown;
      provenance?: unknown;
    }>(null, orgSummary.contentUrl);
    const summaryText = hydrated?.summaryText ?? null;
    const summaryMetadata = hydrated?.summaryMetadata ?? null;
    const provenance = hydrated?.provenance ?? null;

    return {
      id: orgSummary.id,
      batchId: orgSummary.batchId,
      reportDate: orgSummary.reportDate.toISOString().slice(0, 10),
      source: orgSummary.source,
      summaryText,
      summaryMetadata,
      provenance,
      status: orgSummary.status as TeamIntelligenceBatchStatus,
      totalTeams: orgSummary.totalTeams,
      completedTeams: orgSummary.completedTeams,
      failedTeams: orgSummary.failedTeams,
      errorMessage: orgSummary.errorMessage,
      createdAt: orgSummary.createdAt.toISOString(),
      updatedAt: orgSummary.updatedAt.toISOString(),
    };
  }

  async ingestSyncRequest(
    request: TeamIntelligenceSyncRequest,
    metadata: TeamIntelligenceSyncRequestMetadata
  ): Promise<TeamIntelligenceIngestionResponse> {
    const parsedRequest = TeamIntelligenceSyncRequestSchema.parse(request);
    const requestChecksum = buildRequestChecksum(parsedRequest);
    const idempotencyKey = metadata.idempotencyKey.trim();
    if (!idempotencyKey) {
      throw new Error('idempotency-key header is required');
    }
    const source = (metadata.source ?? parsedRequest.source ?? 'mettle').trim() || 'mettle';
    const reportDate = startOfUtcDay(parsedRequest.reportDate);
    const orgId = await resolveDefaultOrgId();

    const existingBatch = await teamIntelligenceRepository.findBatchWithUsersByIdempotencyKey(
      idempotencyKey
    );

    if (existingBatch) {
      logger.info('[TeamIntelligenceService] Existing batch found for idempotency key', {
        batchId: existingBatch.batch.id,
        idempotencyKey,
        status: existingBatch.batch.status,
      });

      if (existingBatch.batch.requestChecksum !== requestChecksum) {
        logger.warn('[TeamIntelligenceService] Idempotency conflict detected', {
          batchId: existingBatch.batch.id,
          idempotencyKey,
          existingChecksum: existingBatch.batch.requestChecksum,
          incomingChecksum: requestChecksum,
        });
        throw new TeamIntelligenceIdempotencyConflictError();
      }

      if (existingBatch.batch.status !== TeamIntelligenceBatchStatus.COMPLETED) {
        return await this.enqueueExistingBatch(existingBatch, source, idempotencyKey, requestChecksum);
      }

      return this.mapBatchResponse(existingBatch.batch, existingBatch.users.length, 0, 0);
    }

    const normalizedUsers = parsedRequest.users.map((user) => this.normalizeUser(user, source));
    const batchContentPointer = await teamIntelligenceContentStorageService.storeJsonPayload({
      entityType: 'batch',
      entityId: idempotencyKey,
      contentType: 'request-payload',
      payload: parsedRequest,
    });

    const batchPayload: CreateTeamIntelligenceBatchData = {
      orgId,
      reportDate,
      source,
      idempotencyKey,
      requestChecksum,
      requestPayload: null,
      contentUrl: batchContentPointer.contentUrl,
      contentSize: batchContentPointer.contentSize,
      contentChecksum: batchContentPointer.contentChecksum,
      totalUsers: normalizedUsers.length,
      status: TeamIntelligenceBatchStatus.RECEIVED,
    };

    const userRows: CreateTeamIntelligenceUserData[] = await Promise.all(
      normalizedUsers.map(async (user, index) => {
        const userEntityId = `${idempotencyKey}-${user.userEmail}`;
        const userPayloadPointer = await teamIntelligenceContentStorageService.storeJsonPayload({
          entityType: 'user',
          entityId: userEntityId,
          contentType: 'raw-payload',
          payload: {
            rawPayload: parsedRequest.users[index],
            pullRequests: user.pullRequests,
            soloCommits: user.soloCommits,
          },
        });

        return {
          orgId,
          reportDate,
          source: user.source,
          userEmail: user.userEmail,
          userName: user.userName,
          teamId: user.teamId,
          teamName: user.teamName,
          aiUsage: user.aiUsage as Prisma.InputJsonValue | null,
          contentUrl: userPayloadPointer.contentUrl,
          contentSize: userPayloadPointer.contentSize,
          contentChecksum: userPayloadPointer.contentChecksum,
          processingStatus: TeamIntelligenceUserIngestionStatus.RECEIVED,
          queueJobId: uuidv4(),
        };
      })
    );

    const created = await teamIntelligenceRepository.createBatchWithUsers(batchPayload, userRows);
    return await this.enqueueExistingBatch(
      created,
      source,
      idempotencyKey,
      requestChecksum
    );
  }

  private normalizeUser(
    user: TeamIntelligenceUserInput,
    source: string
  ): TeamIntelligenceNormalizedUserRecord {
    const resolvedSource = (user.source ?? source).trim() || source;
    const pullRequests = (user.pullRequests ?? []).map((pullRequest) => normalizePullRequest(pullRequest));
    const soloCommits = resolveSoloCommits(user).map((commit) => normalizeCommit(commit));

    return {
      userEmail: normalizeEmail(user.userEmail),
      userName: user.userName.trim(),
      teamId: user.teamId?.trim() || null,
      teamName: user.teamName?.trim() || null,
      source: resolvedSource,
      pullRequests,
      soloCommits,
      aiUsage: resolveAiUsage(user),
    };
  }

  private async enqueueExistingBatch(
    batchWithUsers: TeamIntelligenceBatchWithUsers,
    source: string,
    idempotencyKey: string,
    requestChecksum: string
  ): Promise<TeamIntelligenceIngestionResponse> {
    let queuedUsers = 0;
    let failedUsers = 0;
    const now = new Date();
    const queuedUserIds: string[] = [];
    const failedUserIds: string[] = [];
    const batchOrgId = batchWithUsers.batch.orgId ?? '';

    const users = [...batchWithUsers.users].sort((left, right) =>
      compareStrings(left.userEmail, right.userEmail)
    );

    for (const user of users) {
      try {
        const enqueueResult = await teamIntelligenceQueue.enqueueUserIngestionJob({
          batchId: batchWithUsers.batch.id,
          userIngestionId: user.id,
          reportDate: batchWithUsers.batch.reportDate.toISOString().slice(0, 10),
          userEmail: user.userEmail,
          userName: user.userName,
          teamId: user.teamId,
          teamName: user.teamName,
          source,
          orgId: batchOrgId,
        });

        if (enqueueResult.enqueued || enqueueResult.duplicateJobState) {
          queuedUsers += 1;
          queuedUserIds.push(user.id);
        } else {
          failedUsers += 1;
          failedUserIds.push(user.id);
        }
      } catch (error) {
        failedUsers += 1;
        failedUserIds.push(user.id);
      }
    }

    if (queuedUserIds.length > 0) {
      await teamIntelligenceRepository.updateUserStatuses(queuedUserIds, {
        processingStatus: TeamIntelligenceUserIngestionStatus.QUEUED,
        queuedAt: now,
        errorMessage: null,
      });
    }

    if (failedUserIds.length > 0) {
      await teamIntelligenceRepository.updateUserStatuses(failedUserIds, {
        processingStatus: TeamIntelligenceUserIngestionStatus.FAILED,
        failedAt: now,
        errorMessage: 'Failed to enqueue job',
      });
    }

    const batchStatus =
      failedUsers === 0
        ? TeamIntelligenceBatchStatus.QUEUED
        : queuedUsers > 0
          ? TeamIntelligenceBatchStatus.PARTIALLY_QUEUED
          : TeamIntelligenceBatchStatus.FAILED;

    await teamIntelligenceRepository.updateBatchStatus(batchWithUsers.batch.id, {
      status: batchStatus,
      queuedUsers,
      failedUsers,
      queuedAt: queuedUsers > 0 ? now : null,
      errorMessage:
        failedUsers > 0 && queuedUsers === 0
          ? 'Unable to enqueue any team intelligence jobs'
          : failedUsers > 0
            ? 'Some team intelligence jobs failed to enqueue'
            : null,
    });

    logger.info('[TeamIntelligenceService] Batch stored and queue dispatch completed', {
      batchId: batchWithUsers.batch.id,
      idempotencyKey,
      requestChecksum,
      totalUsers: batchWithUsers.users.length,
      queuedUsers,
      failedUsers,
      status: batchStatus,
    });

    return this.mapBatchResponse(batchWithUsers.batch, batchWithUsers.users.length, queuedUsers, failedUsers, batchStatus);
  }

  private mapBatchResponse(
    batch: TeamIntelligenceBatchWithUsers['batch'],
    totalUsers: number,
    queuedUsers: number,
    failedUsers: number,
    status?: TeamIntelligenceBatchStatus
  ): TeamIntelligenceIngestionResponse {
    return {
      batchId: batch.id,
      idempotencyKey: batch.idempotencyKey,
      reportDate: batch.reportDate.toISOString().slice(0, 10),
      source: batch.source,
      totalUsers,
      queuedUsers,
      failedUsers,
      status: status ?? batch.status,
    };
  }
}

export const teamIntelligenceService = new TeamIntelligenceService();
