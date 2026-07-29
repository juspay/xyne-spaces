import { createReadStream } from 'fs';
import { mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { createHash, randomUUID } from 'crypto';
import { DatabaseClient } from '@/database/client';
import { gcsService } from '@/services/gcsService';
import { logger } from '@/utils/logger';
import { whatsAppMigrationProgressService } from '@/services/whatsappMigrationProgressService';
import { redisService } from '@/services/redisService';
import {
  whatsAppMigrationService,
  type WhatsAppMigrationPreviewResult,
  type WhatsAppMigrationExecuteInput,
} from '@/services/whatsappMigrationService';
import {
  whatsAppBulkMigrationStageService,
  type WhatsAppBulkStagedFile,
} from '@/services/whatsappBulkMigrationStageService';
import type { WhatsAppNameEmailMapping } from '@/services/whatsapp/userResolver';

const db = DatabaseClient.getInstance();

export interface StageWhatsAppArchiveInput {
  workspaceId: string;
  uploaderUserId: string;
  file: Express.Multer.File;
}

export interface StartWhatsAppBulkJobInput {
  stagedFileId: string;
  targetChannelId: string;
}

export interface StartedWhatsAppBulkJob {
  jobId: string;
  stagedFileId: string;
  originalName: string;
  targetChannelId: string;
}

export interface WhatsAppBulkJobValidationResult {
  stagedFileId: string;
  originalName: string;
  targetChannelId: string;
  preview: WhatsAppMigrationPreviewResult;
}

class WhatsAppBulkMigrationService {
  private static readonly PREVIEW_APPROVAL_TTL_SECONDS = 60 * 60 * 24;

  private buildStagingPath(workspaceId: string, stagedFileId: string, originalName: string): string {
    const extensionMatch = originalName.match(/(\.[a-zA-Z0-9]+)$/);
    const extension = extensionMatch?.[1]?.toLowerCase() || '.zip';
    return `whatsapp-migrations/staging/${workspaceId}/${stagedFileId}${extension}`;
  }

  private buildPreviewApprovalPayload(
    jobs: StartWhatsAppBulkJobInput[],
    mappings: WhatsAppNameEmailMapping[],
  ): string {
    const normalizedJobs = [...jobs]
      .map(job => ({
        stagedFileId: job.stagedFileId.trim(),
        targetChannelId: job.targetChannelId.trim(),
      }))
      .sort((a, b) => a.stagedFileId.localeCompare(b.stagedFileId));

    const normalizedMappings = [...mappings]
      .map(mapping => ({
        whatsappName: mapping.whatsappName.trim(),
        email: mapping.email.trim().toLowerCase(),
      }))
      .sort((a, b) =>
        a.whatsappName.localeCompare(b.whatsappName) || a.email.localeCompare(b.email),
      );

    return JSON.stringify({
      jobs: normalizedJobs,
      mappings: normalizedMappings,
    });
  }

  private buildPreviewApprovalKey(
    workspaceId: string,
    jobs: StartWhatsAppBulkJobInput[],
    mappings: WhatsAppNameEmailMapping[],
  ): string {
    const fingerprint = createHash('sha256')
      .update(this.buildPreviewApprovalPayload(jobs, mappings))
      .digest('hex');
    return `whatsapp:bulk:preview-approved:${workspaceId}:${fingerprint}`;
  }

  async recordPreviewApproval(params: {
    workspaceId: string;
    jobs: StartWhatsAppBulkJobInput[];
    mappings: WhatsAppNameEmailMapping[];
  }): Promise<void> {
    const key = this.buildPreviewApprovalKey(params.workspaceId, params.jobs, params.mappings);
    const value = JSON.stringify({
      approvedAt: new Date().toISOString(),
      stagedFileIds: params.jobs.map(job => job.stagedFileId),
    });

    await redisService
      .getClient()
      .set(key, value, 'EX', WhatsAppBulkMigrationService.PREVIEW_APPROVAL_TTL_SECONDS);
  }

  async hasPreviewApproval(params: {
    workspaceId: string;
    jobs: StartWhatsAppBulkJobInput[];
    mappings: WhatsAppNameEmailMapping[];
  }): Promise<boolean> {
    const key = this.buildPreviewApprovalKey(params.workspaceId, params.jobs, params.mappings);
    const value = await redisService.getClient().get(key);
    return Boolean(value);
  }

  async clearPreviewApproval(params: {
    workspaceId: string;
    jobs: StartWhatsAppBulkJobInput[];
    mappings: WhatsAppNameEmailMapping[];
  }): Promise<void> {
    const key = this.buildPreviewApprovalKey(params.workspaceId, params.jobs, params.mappings);
    await redisService.getClient().del(key);
  }

  private async downloadStagedArchiveToTemp(stagedFile: WhatsAppBulkStagedFile): Promise<string> {
    const downloadDir = join(tmpdir(), 'xyne-whatsapp-bulk-downloads');
    await mkdir(downloadDir, { recursive: true });

    const localPath = join(downloadDir, `${stagedFile.stagedFileId}-${stagedFile.originalName.replace(/[^a-zA-Z0-9._-]+/g, '-')}`);
    await gcsService.downloadFile(stagedFile.gcsPath, localPath);
    return localPath;
  }

  async stageArchive(input: StageWhatsAppArchiveInput): Promise<WhatsAppBulkStagedFile> {
    const stagedFileId = randomUUID();
    const gcsPath = this.buildStagingPath(input.workspaceId, stagedFileId, input.file.originalname);
    const stream = createReadStream(input.file.path);

    const upload = await gcsService.uploadStreamToPath(stream, {
      path: gcsPath,
      contentType: input.file.mimetype || 'application/zip',
      metadata: {
        originalName: input.file.originalname,
        workspaceId: input.workspaceId,
        uploadedBy: input.uploaderUserId,
        stagedFileId,
      },
    });

    return whatsAppBulkMigrationStageService.create({
      stagedFileId,
      workspaceId: input.workspaceId,
      uploaderUserId: input.uploaderUserId,
      originalName: input.file.originalname,
      gcsPath: upload.gcsPath,
      size: upload.size || input.file.size,
    });
  }

  async validateJobs(
    workspaceId: string,
    jobs: StartWhatsAppBulkJobInput[],
  ): Promise<WhatsAppBulkStagedFile[]> {
    const stagedFiles: WhatsAppBulkStagedFile[] = [];

    for (const job of jobs) {
      const stagedFile = await whatsAppBulkMigrationStageService.get(job.stagedFileId);
      if (!stagedFile) {
        throw new Error(`Staged file not found: ${job.stagedFileId}`);
      }
      if (stagedFile.workspaceId !== workspaceId) {
        throw new Error(`Staged file ${stagedFile.originalName} does not belong to your workspace`);
      }

      const channel = await db.channel.findUnique({
        where: { id: job.targetChannelId },
        select: { id: true, projectId: true, workspaceId: true, scopeType: true },
      });

      if (!channel) {
        throw new Error(`Target channel not found for ${stagedFile.originalName}`);
      }
      if (channel.workspaceId !== workspaceId) {
        throw new Error(`Target channel does not belong to your workspace for ${stagedFile.originalName}`);
      }

      stagedFiles.push(stagedFile);
    }

    return stagedFiles;
  }

  async previewBulkJobs(params: {
    workspaceId: string;
    jobs: StartWhatsAppBulkJobInput[];
    mappings: WhatsAppNameEmailMapping[];
  }): Promise<WhatsAppBulkJobValidationResult[]> {
    const stagedFiles = await this.validateJobs(params.workspaceId, params.jobs);
    const results: WhatsAppBulkJobValidationResult[] = [];

    for (let index = 0; index < params.jobs.length; index += 1) {
      const job = params.jobs[index];
      const stagedFile = stagedFiles[index];
      if (!job || !stagedFile) continue;

      let archivePath: string | null = null;
      try {
        // eslint-disable-next-line no-await-in-loop
        archivePath = await this.downloadStagedArchiveToTemp(stagedFile);
        // eslint-disable-next-line no-await-in-loop
        const preview = await whatsAppMigrationService.preview({
          archivePath,
          archiveOriginalName: stagedFile.originalName,
          workspaceId: params.workspaceId,
          mappings: params.mappings,
        });

        results.push({
          stagedFileId: stagedFile.stagedFileId,
          originalName: stagedFile.originalName,
          targetChannelId: job.targetChannelId,
          preview,
        });
      } finally {
        if (archivePath) {
          // eslint-disable-next-line no-await-in-loop
          await rm(archivePath, { force: true }).catch(() => undefined);
        }
      }
    }

    return results;
  }

  async startBulkJobs(params: {
    actorUserId: string;
    workspaceId: string;
    jobs: StartWhatsAppBulkJobInput[];
    mappings: WhatsAppNameEmailMapping[];
    createMissingUsers: boolean;
  }): Promise<StartedWhatsAppBulkJob[]> {
    const stagedFiles = await this.validateJobs(params.workspaceId, params.jobs);
    const startedJobs: StartedWhatsAppBulkJob[] = [];

    for (let index = 0; index < params.jobs.length; index += 1) {
      const job = params.jobs[index];
      const stagedFile = stagedFiles[index];
      if (!job || !stagedFile) continue;

      const jobId = randomUUID();
      await whatsAppMigrationProgressService.createJob(jobId, {
        targetChannelId: job.targetChannelId,
        chatName: null,
      });

      startedJobs.push({
        jobId,
        stagedFileId: stagedFile.stagedFileId,
        originalName: stagedFile.originalName,
        targetChannelId: job.targetChannelId,
      });
    }

    void (async () => {
      for (let index = 0; index < startedJobs.length; index += 1) {
        const started = startedJobs[index];
        const job = params.jobs[index];
        const stagedFile = stagedFiles[index];
        if (!started || !job || !stagedFile) continue;

        let archivePath: string | null = null;
        try {
          // eslint-disable-next-line no-await-in-loop
          archivePath = await this.downloadStagedArchiveToTemp(stagedFile);
          const executeInput: WhatsAppMigrationExecuteInput = {
            archivePath,
            archiveOriginalName: stagedFile.originalName,
            targetChannelId: job.targetChannelId,
            mappings: params.mappings,
            actorUserId: params.actorUserId,
            workspaceId: params.workspaceId,
            createMissingUsers: params.createMissingUsers,
          };

          // eslint-disable-next-line no-await-in-loop
          await whatsAppMigrationService.execute(started.jobId, executeInput);
          // eslint-disable-next-line no-await-in-loop
          await whatsAppBulkMigrationStageService.markConsumed(stagedFile.stagedFileId);
        } catch (error) {
          logger.error('[WhatsAppBulkMigration] Bulk execution failed for job', error, {
            jobId: started.jobId,
            stagedFileId: stagedFile.stagedFileId,
            originalName: stagedFile.originalName,
          });
          // eslint-disable-next-line no-await-in-loop
          await whatsAppMigrationProgressService.patchJob(started.jobId, {
            status: 'failed',
            phase: 'failed',
            completedAt: new Date().toISOString(),
            errorMessage: error instanceof Error ? error.message : 'Bulk migration failed',
          });
        } finally {
          if (archivePath) {
            // The single importer also removes the file; force removes make double cleanup harmless.
            // eslint-disable-next-line no-await-in-loop
            await rm(archivePath, { force: true }).catch(() => undefined);
          }
        }
      }
    })();

    return startedJobs;
  }
}

export const whatsAppBulkMigrationService = new WhatsAppBulkMigrationService();
