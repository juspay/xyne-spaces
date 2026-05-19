import { randomUUID } from 'crypto';
import { Request, Response } from 'express';
import { DatabaseClient } from '@/database/client';
import { logger } from '@/utils/logger';
import { confluenceMigrationPreviewService } from '@/services/confluenceMigrationPreviewService';
import {
  ConfluenceImportService,
  type ConfluenceImportConfig,
  type ConfluenceImportProgressUpdate,
  type ConfluenceSectionMapping,
} from '@/services/confluence/confluenceImportService';
import { confluenceMigrationProgressService } from '@/services/confluenceMigrationProgressService';

const db = DatabaseClient.getInstance();
export class ConfluenceMigrationController {
  preview = async (req: Request, res: Response): Promise<void> => {
    try {
      const { spaceKey, targetProjectId, projectId, targetChannelId, targetChannelName } = req.body as {
        spaceKey?: string;
        targetProjectId?: string;
        projectId?: string;
        targetChannelId?: string;
        targetChannelName?: string;
      };

      if (!spaceKey) {
        res.status(400).json({ error: 'spaceKey is required' });
        return;
      }

      const result = await confluenceMigrationPreviewService.preview({
        spaceKey,
        targetProjectId: targetProjectId || projectId,
        targetChannelId,
        targetChannelName,
        workspaceId: (req.user as { workspaceId?: string } | undefined)?.workspaceId,
        sectionMappings: this.normalizeSectionMappings(req.body.sectionMappings),
      });

      res.json({ success: true, data: result });
    } catch (error) {
      logger.error('Confluence migration preview failed', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to preview Confluence migration',
      });
    }
  };

  execute = async (req: Request, res: Response): Promise<void> => {
    try {
      const { spaceKey, targetProjectId, projectId, targetChannelId, targetChannelName } = req.body as {
        spaceKey?: string;
        targetProjectId?: string;
        projectId?: string;
        targetChannelId?: string;
        targetChannelName?: string;
      };
      const resolvedProjectId = targetProjectId || projectId;

      if (!spaceKey) {
        res.status(400).json({ error: 'spaceKey is required' });
        return;
      }

      const requestUser = req.user as { id?: string; workspaceId?: string } | undefined;
      const actorUserId = requestUser?.id;
      if (!actorUserId) {
        res.status(401).json({ error: 'Authenticated user required for Confluence migration' });
        return;
      }

      const input: ConfluenceImportConfig = {
        spaceKey,
        ...(resolvedProjectId ? { projectId: resolvedProjectId } : {}),
        ...(typeof targetChannelId === 'string' ? { targetChannelId } : {}),
        ...(typeof targetChannelName === 'string' ? { targetChannelName } : {}),
        ...(typeof req.body.projectName === 'string' ? { projectName: req.body.projectName } : {}),
        ...(typeof req.body.projectCode === 'string' ? { projectCode: req.body.projectCode } : {}),
        ...(requestUser?.workspaceId ? { workspaceId: requestUser.workspaceId } : {}),
        actorUserId,
        sectionMappings: this.normalizeSectionMappings(req.body.sectionMappings),
        migrateAttachments: req.body.migrateAttachments !== false,
        createProjectIfMissing: req.body.createProjectIfMissing !== false,
        createDefaultChannel: req.body.createDefaultChannel !== false,
        defaultDestination: req.body.defaultDestination === 'projectFolder' ? 'projectFolder' : 'channelFolder',
        ...(typeof req.body.frontendBaseUrl === 'string' ? { frontendBaseUrl: req.body.frontendBaseUrl } : {}),
      };

      const jobId = randomUUID();
      await confluenceMigrationProgressService.createJob(jobId, input);

      res.json({ success: true, data: { jobId } });

      void this.runMigrationJob(jobId, input);
    } catch (error) {
      logger.error('Confluence migration execution failed', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to execute Confluence migration',
      });
    }
  };

  status = async (req: Request, res: Response): Promise<void> => {
    try {
      const { jobId } = req.params as { jobId?: string };

      if (!jobId) {
        res.status(400).json({ error: 'jobId is required' });
        return;
      }

      const job = await confluenceMigrationProgressService.getJob(jobId);
      if (!job) {
        res.status(404).json({ error: 'Migration job not found' });
        return;
      }

      res.json({ success: true, data: job });
    } catch (error) {
      logger.error('Confluence migration status fetch failed', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to fetch Confluence migration status',
      });
    }
  };

  history = async (_req: Request, res: Response): Promise<void> => {
    try {
      const canvases = await db.canvas.findMany({
        where: {
          metadata: {
            path: ['externalSourceType'],
            equals: 'confluence',
          },
        },
        select: {
          id: true,
          title: true,
          projectId: true,
          channelId: true,
          folderId: true,
          viewAccessId: true,
          metadata: true,
          updatedAt: true,
        },
        orderBy: { updatedAt: 'desc' },
        take: 500,
      });

      res.json({
        success: true,
        data: canvases.map(canvas => {
          const metadata = this.asRecord(canvas.metadata);
          const confluence = this.asRecord(metadata.confluence);
          return {
            canvasId: canvas.id,
            title: canvas.title,
            projectId: canvas.projectId,
            channelId: canvas.channelId,
            folderId: canvas.folderId,
            viewAccessId: canvas.viewAccessId,
            spaceKey: confluence.spaceKey || null,
            confluencePageId: metadata.externalSourceId || confluence.pageId || null,
            externalSourceUrl: metadata.externalSourceUrl || null,
            lastImportedAt: metadata.lastImportedAt || confluence.importedAt || null,
            updatedAt: canvas.updatedAt.toISOString(),
          };
        }),
      });
    } catch (error) {
      logger.error('Confluence migration history fetch failed', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to fetch Confluence migration history',
      });
    }
  };

  private async runMigrationJob(jobId: string, input: ConfluenceImportConfig): Promise<void> {
    try {
      await confluenceMigrationProgressService.patchJob(jobId, {
        status: 'running',
        currentStep: 'starting',
        currentPageTitle: null,
      });

      const result = await new ConfluenceImportService().importSpace(
        input,
        async (update: ConfluenceImportProgressUpdate) => {
          await this.handleProgressUpdate(jobId, update);
        },
      );

      await confluenceMigrationProgressService.patchJob(jobId, {
        status: 'completed',
        currentStep: 'completed',
        currentPageTitle: null,
        completedAt: new Date().toISOString(),
        result,
        targetProjectId: result.projectId,
        ...(result.defaultChannelId ? { targetChannelId: result.defaultChannelId } : {}),
        warnings: result.warnings,
        unresolvedUsers: result.unresolvedUsers,
        pageResults: result.pageResults,
        totalPages: result.totalPages,
        processedPages: result.pageResults.length,
        createdCanvases: result.createdCanvases,
        updatedCanvases: result.updatedCanvases,
        createdFolders: result.createdFolders,
        reusedFolders: result.reusedFolders,
        migratedAttachments: result.migratedAttachments,
        reusedAttachments: result.reusedAttachments,
        failedAttachments: result.failedAttachments,
        containerPagesWithContent: result.containerPagesWithContent,
        containerCanvasesCreated: result.containerCanvasesCreated,
        containerCanvasesUpdated: result.containerCanvasesUpdated,
      });
    } catch (error) {
      logger.error('[ConfluenceMigration] Background migration job failed', error, { jobId });
      await confluenceMigrationProgressService.patchJob(jobId, {
        status: 'failed',
        currentStep: 'failed',
        completedAt: new Date().toISOString(),
        errorMessage: error instanceof Error ? error.message : 'Unknown migration error',
      });
    }
  }

  private async handleProgressUpdate(
    jobId: string,
    update: ConfluenceImportProgressUpdate,
  ): Promise<void> {
    await confluenceMigrationProgressService.patchJob(jobId, {
      status: 'running',
      totalPages: update.totalPages,
      processedPages: update.processedPages,
      createdCanvases: update.createdCanvases,
      updatedCanvases: update.updatedCanvases,
      createdFolders: update.createdFolders,
      reusedFolders: update.reusedFolders,
      migratedAttachments: update.migratedAttachments,
      reusedAttachments: update.reusedAttachments,
      failedAttachments: update.failedAttachments,
      containerPagesWithContent: update.containerPagesWithContent,
      containerCanvasesCreated: update.containerCanvasesCreated,
      containerCanvasesUpdated: update.containerCanvasesUpdated,
      currentPageTitle: update.currentPageTitle || null,
      currentStep: update.currentStep,
      warnings: update.warnings,
      unresolvedUsers: update.unresolvedUsers,
    });

    if (update.pageResult) {
      await confluenceMigrationProgressService.upsertPageResult(jobId, update.pageResult);
    }
  }

  private normalizeSectionMappings(value: unknown): Record<string, ConfluenceSectionMapping> | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return undefined;
    }

    const mappings: Record<string, ConfluenceSectionMapping> = {};
    for (const [sectionTitle, rawMapping] of Object.entries(value as Record<string, unknown>)) {
      if (!rawMapping || typeof rawMapping !== 'object' || Array.isArray(rawMapping)) {
        continue;
      }

      const mapping = rawMapping as Record<string, unknown>;
      if (mapping.type === 'channel') {
        mappings[sectionTitle] = {
          type: 'channel',
          ...(typeof mapping.channelId === 'string' ? { channelId: mapping.channelId } : {}),
          ...(typeof mapping.channelName === 'string' ? { channelName: mapping.channelName } : {}),
        };
      } else if (mapping.type === 'channelFolder') {
        mappings[sectionTitle] = {
          type: 'channelFolder',
          ...(typeof mapping.channelId === 'string' ? { channelId: mapping.channelId } : {}),
        };
      } else if (mapping.type === 'projectFolder') {
        mappings[sectionTitle] = { type: 'projectFolder' };
      }
    }

    return Object.keys(mappings).length > 0 ? mappings : undefined;
  }

  private asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  }
}
