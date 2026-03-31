import { redisService } from '@/services/redisService';
import type {
  JiraMigrationExecuteInput,
  JiraMigrationExecuteResult,
  JiraMigrationIssueResult,
} from '@/services/jiraMigrationImportService';

export type JiraMigrationJobStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface JiraMigrationJobProgress {
  jobId: string;
  status: JiraMigrationJobStatus;
  jiraProjectKey: string;
  targetProjectId: string;
  targetBoardId: string;
  targetChannelId: string;
  issueKeys?: string[];
  totalIssues: number | null;
  processedIssues: number;
  importedTickets: number;
  skippedTickets: number;
  importedComments: number;
  skippedComments: number;
  importedAttachments: number;
  skippedAttachments: number;
  currentIssueKey: string | null;
  currentStep: string | null;
  warnings: string[];
  issueResults: JiraMigrationIssueResult[];
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
  errorMessage?: string;
  result?: JiraMigrationExecuteResult;
}

const TTL_SECONDS = 60 * 60 * 24 * 7;

class JiraMigrationProgressService {
  private buildKey(jobId: string): string {
    return `jira:migration:job:${jobId}`;
  }

  async createJob(jobId: string, input: JiraMigrationExecuteInput): Promise<JiraMigrationJobProgress> {
    const progress: JiraMigrationJobProgress = {
      jobId,
      status: 'queued',
      jiraProjectKey: input.jiraProjectKey.trim().toUpperCase(),
      targetProjectId: input.targetProjectId,
      targetBoardId: input.targetBoardId,
      targetChannelId: input.targetChannelId,
      ...(input.issueKeys ? { issueKeys: input.issueKeys } : {}),
      totalIssues: null,
      processedIssues: 0,
      importedTickets: 0,
      skippedTickets: 0,
      importedComments: 0,
      skippedComments: 0,
      importedAttachments: 0,
      skippedAttachments: 0,
      currentIssueKey: null,
      currentStep: 'queued',
      warnings: [],
      issueResults: [],
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: null,
    };

    await this.setProgress(progress);
    return progress;
  }

  async getJob(jobId: string): Promise<JiraMigrationJobProgress | null> {
    const data = await redisService.getClient().get(this.buildKey(jobId));
    if (!data) return null;
    return JSON.parse(data) as JiraMigrationJobProgress;
  }

  async setProgress(progress: JiraMigrationJobProgress): Promise<void> {
    const next = {
      ...progress,
      updatedAt: new Date().toISOString(),
    };

    await redisService
      .getClient()
      .set(this.buildKey(progress.jobId), JSON.stringify(next), 'EX', TTL_SECONDS);
  }

  async patchJob(
    jobId: string,
    patch: Partial<JiraMigrationJobProgress>,
  ): Promise<JiraMigrationJobProgress | null> {
    const current = await this.getJob(jobId);
    if (!current) return null;

    const next: JiraMigrationJobProgress = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    };

    await this.setProgress(next);
    return next;
  }

  async upsertIssueResult(
    jobId: string,
    issueResult: JiraMigrationIssueResult,
  ): Promise<JiraMigrationJobProgress | null> {
    const current = await this.getJob(jobId);
    if (!current) return null;

    const existingIndex = current.issueResults.findIndex(result => result.issueKey === issueResult.issueKey);
    const nextIssueResults = [...current.issueResults];

    if (existingIndex === -1) {
      nextIssueResults.push(issueResult);
    } else {
      nextIssueResults[existingIndex] = issueResult;
    }

    return this.patchJob(jobId, { issueResults: nextIssueResults });
  }
}

export const jiraMigrationProgressService = new JiraMigrationProgressService();
