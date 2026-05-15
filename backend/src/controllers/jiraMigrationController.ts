import { randomUUID } from 'crypto';
import { Request, Response } from 'express';
import { jiraMigrationPreviewService } from '@/services/jiraMigrationPreviewService';
import {
  jiraMigrationImportService,
  type JiraMigrationExecuteInput,
  type JiraMigrationProgressUpdate,
} from '@/services/jiraMigrationImportService';
import { jiraMigrationProgressService } from '@/services/jiraMigrationProgressService';
import { DatabaseClient } from '@/database/client';
import { logger } from '@/utils/logger';
import { getCanvasUrl } from '@/services/canvasService';
import { messageMetadataService } from '@/services/messageMetadataService';

const db = DatabaseClient.getInstance();

export class JiraMigrationController {
  preview = async (req: Request, res: Response): Promise<void> => {
    try {
      const { jiraProjectKey, targetProjectId, targetBoardId, targetChannelId } = req.body as {
        jiraProjectKey?: string;
        targetProjectId?: string;
        targetBoardId?: string;
        targetChannelId?: string;
        jiraBoardId?: number;
        nextPageToken?: string;
        maxResults?: number;
        dateFrom?: string;
        filters?: { reporterAccountIds?: string[]; creatorAccountIds?: string[]; assigneeAccountIds?: string[]; labels?: string[] };
        loadFilterOptions?: boolean;
      };

      if (!jiraProjectKey || !targetProjectId || !targetBoardId || !targetChannelId) {
        res.status(400).json({
          error: 'jiraProjectKey, targetProjectId, targetBoardId, and targetChannelId are required',
        });
        return;
      }

      const result = await jiraMigrationPreviewService.preview({
        jiraProjectKey,
        targetProjectId,
        targetBoardId,
        targetChannelId,
        ...(typeof req.body.jiraBoardId === 'number' ? { jiraBoardId: req.body.jiraBoardId } : {}),
        nextPageToken: req.body.nextPageToken,
        maxResults: req.body.maxResults,
        dateFrom: typeof req.body.dateFrom === 'string' ? req.body.dateFrom : undefined,
        loadFilterOptions: req.body.loadFilterOptions === true,
        filters: req.body.filters && typeof req.body.filters === 'object' ? {
          ...(Array.isArray(req.body.filters.reporterAccountIds) ? { reporterAccountIds: req.body.filters.reporterAccountIds.filter((value: unknown): value is string => typeof value === 'string') } : {}),
          ...(Array.isArray(req.body.filters.creatorAccountIds) ? { creatorAccountIds: req.body.filters.creatorAccountIds.filter((value: unknown): value is string => typeof value === 'string') } : {}),
          ...(Array.isArray(req.body.filters.assigneeAccountIds) ? { assigneeAccountIds: req.body.filters.assigneeAccountIds.filter((value: unknown): value is string => typeof value === 'string') } : {}),
          ...(Array.isArray(req.body.filters.labels) ? { labels: req.body.filters.labels.filter((value: unknown): value is string => typeof value === 'string') } : {}),
        } : undefined,
      });

      res.json({ success: true, data: result });
    } catch (error) {
      logger.error('Jira migration preview failed', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to preview Jira migration',
      });
    }
  };

  execute = async (req: Request, res: Response): Promise<void> => {
    try {
      const { jiraProjectKey, targetProjectId, targetBoardId, targetChannelId } = req.body as {
        jiraProjectKey?: string;
        targetProjectId?: string;
        targetBoardId?: string;
        targetChannelId?: string;
        issueKeys?: string[];
        jiraBoardId?: number;
        dateFrom?: string;
        statusV2Mappings?: Record<string, string>;
        skipCustomFieldIds?: string[];
        jiraStatusSequence?: string[];
        excludedStageNames?: string[];
        filters?: { reporterAccountIds?: string[]; creatorAccountIds?: string[]; assigneeAccountIds?: string[]; labels?: string[] };
      };

      if (!jiraProjectKey || !targetProjectId || !targetBoardId || !targetChannelId) {
        res.status(400).json({
          error: 'jiraProjectKey, targetProjectId, targetBoardId, and targetChannelId are required',
        });
        return;
      }

      const actorUserId = req.user?.id;
      if (!actorUserId) {
        res.status(401).json({ error: 'Authenticated user required for Jira migration' });
        return;
      }

      const input: JiraMigrationExecuteInput = {
        jiraProjectKey,
        targetProjectId,
        targetBoardId,
        targetChannelId,
        issueKeys: Array.isArray(req.body.issueKeys) ? req.body.issueKeys : undefined,
        ...(typeof req.body.jiraBoardId === 'number' ? { jiraBoardId: req.body.jiraBoardId } : {}),
        dateFrom: typeof req.body.dateFrom === 'string' ? req.body.dateFrom : undefined,
        filters: req.body.filters && typeof req.body.filters === 'object' ? {
          ...(Array.isArray(req.body.filters.reporterAccountIds) ? { reporterAccountIds: req.body.filters.reporterAccountIds.filter((value: unknown): value is string => typeof value === 'string') } : {}),
          ...(Array.isArray(req.body.filters.creatorAccountIds) ? { creatorAccountIds: req.body.filters.creatorAccountIds.filter((value: unknown): value is string => typeof value === 'string') } : {}),
          ...(Array.isArray(req.body.filters.assigneeAccountIds) ? { assigneeAccountIds: req.body.filters.assigneeAccountIds.filter((value: unknown): value is string => typeof value === 'string') } : {}),
          ...(Array.isArray(req.body.filters.labels) ? { labels: req.body.filters.labels.filter((value: unknown): value is string => typeof value === 'string') } : {}),
        } : undefined,
        statusV2Mappings:
          req.body.statusV2Mappings && typeof req.body.statusV2Mappings === 'object'
            ? req.body.statusV2Mappings
            : {},
        skipCustomFieldIds: Array.isArray(req.body.skipCustomFieldIds)
          ? req.body.skipCustomFieldIds.filter((fieldId: unknown): fieldId is string => typeof fieldId === 'string')
          : [],
        jiraStatusSequence: Array.isArray(req.body.jiraStatusSequence)
          ? req.body.jiraStatusSequence.filter((value: unknown): value is string => typeof value === 'string' && value.trim().length > 0)
          : undefined,
        excludedStageNames: Array.isArray(req.body.excludedStageNames)
          ? req.body.excludedStageNames.filter((value: unknown): value is string => typeof value === 'string' && value.trim().length > 0)
          : undefined,
      };

      if (Object.keys(input.statusV2Mappings).length === 0) {
        res.status(400).json({
          error: 'statusV2Mappings is required and must include Jira status to StatusV2 mappings',
        });
        return;
      }

      const jobId = randomUUID();
      await jiraMigrationProgressService.createJob(jobId, input);

      res.json({ success: true, data: { jobId } });

      void this.runMigrationJob(jobId, input, actorUserId);
    } catch (error) {
      logger.error('Jira migration execution failed', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to execute Jira migration',
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

      const job = await jiraMigrationProgressService.getJob(jobId);
      if (!job) {
        res.status(404).json({ error: 'Migration job not found' });
        return;
      }

      res.json({ success: true, data: job });
    } catch (error) {
      logger.error('Jira migration status fetch failed', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to fetch Jira migration status',
      });
    }
  };

  stop = async (req: Request, res: Response): Promise<void> => {
    try {
      const { jobId } = req.params as { jobId?: string };
      if (!jobId) {
        res.status(400).json({ error: 'jobId is required' });
        return;
      }

      const job = await jiraMigrationProgressService.getJob(jobId);
      if (!job) {
        res.status(404).json({ error: 'Migration job not found' });
        return;
      }

      if (job.status !== 'running' && job.status !== 'queued') {
        res.status(400).json({ error: `Job cannot be stopped (status=${job.status})` });
        return;
      }

      const next = await jiraMigrationProgressService.patchJob(jobId, { controlStatus: 'cancel_requested' });
      res.json({ success: true, data: next });
    } catch (error) {
      logger.error('Jira migration stop failed', error);
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to stop Jira migration' });
    }
  };

  pause = async (req: Request, res: Response): Promise<void> => {
    try {
      const { jobId } = req.params as { jobId?: string };
      if (!jobId) {
        res.status(400).json({ error: 'jobId is required' });
        return;
      }

      const job = await jiraMigrationProgressService.getJob(jobId);
      if (!job) {
        res.status(404).json({ error: 'Migration job not found' });
        return;
      }

      if (job.controlStatus === 'cancel_requested') {
        res.status(400).json({ error: 'Job is already stopped' });
        return;
      }

      if (job.status !== 'running') {
        res.status(400).json({ error: `Job is not running (status=${job.status})` });
        return;
      }

      const next = await jiraMigrationProgressService.patchJob(jobId, { controlStatus: 'paused', currentStep: 'paused' });
      res.json({ success: true, data: next });
    } catch (error) {
      logger.error('Jira migration pause failed', error);
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to pause Jira migration' });
    }
  };

  resume = async (req: Request, res: Response): Promise<void> => {
    try {
      const { jobId } = req.params as { jobId?: string };
      if (!jobId) {
        res.status(400).json({ error: 'jobId is required' });
        return;
      }

      const job = await jiraMigrationProgressService.getJob(jobId);
      if (!job) {
        res.status(404).json({ error: 'Migration job not found' });
        return;
      }

      if (job.controlStatus === 'cancel_requested') {
        res.status(400).json({ error: 'Job is already stopped' });
        return;
      }

      if (job.status !== 'running') {
        res.status(400).json({ error: `Job is not running (status=${job.status})` });
        return;
      }

      const next = await jiraMigrationProgressService.patchJob(jobId, { controlStatus: 'running' });
      res.json({ success: true, data: next });
    } catch (error) {
      logger.error('Jira migration resume failed', error);
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to resume Jira migration' });
    }
  };


  history = async (_req: Request, res: Response): Promise<void> => {
    try {
      const history = (await db.externalSource.findMany({
        where: { sourceType: 'jira' },
        orderBy: { updatedAt: 'desc' },
      })).map(source => {
        const jiraProjectKeyMatch = source.displayName.match(/Jira \((.+)\)/i);

        return {
          externalSourceId: source.id,
          jiraProjectKey: jiraProjectKeyMatch?.[1] || source.displayName.replace(/^Jira\s*\(|\)$/g, ''),
          displayName: source.displayName,
          targetBoardId: source.boardId || null,
          targetChannelId: source.channelId,
          isActive: source.isActive,
          createdAt: source.createdAt.toISOString(),
          updatedAt: source.updatedAt.toISOString(),
        };
      });

      res.json({ success: true, data: history });
    } catch (error) {
      logger.error('Jira migration history fetch failed', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to fetch Jira migration history',
      });
    }
  };

  private async runMigrationJob(
    jobId: string,
    input: JiraMigrationExecuteInput,
    actorUserId: string,
  ): Promise<void> {
    try {
      await jiraMigrationProgressService.patchJob(jobId, {
        status: 'running',
        controlStatus: 'running',
        currentStep: 'starting',
        currentIssueKey: null,
      });

      const result = await jiraMigrationImportService.execute(
        input,
        actorUserId,
        async (update: JiraMigrationProgressUpdate) => {
          await this.handleProgressUpdate(jobId, update);
        },
        async () => (await jiraMigrationProgressService.getJob(jobId))?.controlStatus,
      );

      await jiraMigrationProgressService.patchJob(jobId, {
        status: 'completed',
        currentStep: 'completed',
        currentIssueKey: null,
        completedAt: new Date().toISOString(),
        result,
        warnings: result.warnings,
        issueResults: result.issueResults,
        totalIssues: result.issueResults.length,
        processedIssues: result.issueResults.length,
        importedTickets: result.importedTickets,
        skippedTickets: result.skippedTickets,
        importedComments: result.importedComments,
        skippedComments: result.skippedComments,
        importedAttachments: result.importedAttachments,
        skippedAttachments: result.skippedAttachments,
      });

      try {
        await this.postMigrationReport(input.targetChannelId, actorUserId, result);
      } catch (reportError) {
        logger.error('[JiraMigration] Failed to post migration report to channel', reportError, {
          jobId,
          channelId: input.targetChannelId,
          jiraProjectKey: result.jiraProjectKey,
        });
      }
    } catch (error) {
      logger.error('[JiraMigration] Background migration job failed', error, { jobId });
      await jiraMigrationProgressService.patchJob(jobId, {
        status: 'failed',
        currentStep: 'failed',
        completedAt: new Date().toISOString(),
        errorMessage: error instanceof Error ? error.message : 'Unknown migration error',
      });
    }
  }

  private getMigrationReportSummary(result: import('@/services/jiraMigrationImportService').JiraMigrationExecuteResult) {
    return {
      completedIssues: result.issueResults.filter(issue => issue.status === 'completed').length,
      partialIssues: result.issueResults.filter(issue => issue.status === 'partial').length,
      failedIssues: result.issueResults.filter(issue => issue.status === 'failed').length,
    };
  }

  private buildMetricCard(label: string, value: string, tone: 'default' | 'success' | 'warning' | 'danger' = 'default') {
    const backgroundColorByTone = {
      default: '#F8FAFC',
      success: '#ECFDF5',
      warning: '#FFFBEB',
      danger: '#FEF2F2',
    } as const;

    const textColorByTone = {
      default: '#0F172A',
      success: '#065F46',
      warning: '#92400E',
      danger: '#991B1B',
    } as const;

    return {
      id: randomUUID(),
      type: 'paragraph',
      props: {
        backgroundColor: backgroundColorByTone[tone],
        textColor: textColorByTone[tone],
      },
      content: [
        { type: 'text', text: `${label}\n`, styles: { bold: true } },
        { type: 'text', text: value, styles: { textColor: textColorByTone[tone] } },
      ],
    };
  }

  private buildBulletListBlock(title: string, items: string[]) {
    if (items.length === 0) {
      return [];
    }

    return [
      {
        id: randomUUID(),
        type: 'heading',
        props: { level: 2 },
        content: [{ type: 'text', text: title, styles: {} }],
      },
      ...items.map(item => ({
        id: randomUUID(),
        type: 'bulletListItem',
        content: [{ type: 'text', text: item, styles: {} }],
      })),
    ];
  }

  private buildMigrationReportCanvasBlocks(
    result: import('@/services/jiraMigrationImportService').JiraMigrationExecuteResult,
  ) {
    const { completedIssues, partialIssues, failedIssues } = this.getMigrationReportSummary(result);
    const topWarnings = result.warnings.slice(0, 8);
    const unresolvedUserItems = result.unresolvedUsers.slice(0, 8).map(user => {
      const name = user.displayName || user.accountId || 'Unknown Jira user';
      const suggestedEmails = user.suggestedEmails.length > 0 ? user.suggestedEmails.join(', ') : null;
      const issueKeys = user.issueKeys.length > 0 ? user.issueKeys.slice(0, 5).join(', ') : null;
      const issueSuffix =
        user.issueKeys.length > 5 ? ` (+${user.issueKeys.length - 5} more)` : '';

      return [
        name,
        suggestedEmails,
        issueKeys ? `Tickets: ${issueKeys}${issueSuffix}` : null,
      ]
        .filter(Boolean)
        .join(' · ');
    });
    const issueDetailItems = result.issueResults
      .filter(issue => issue.status !== 'completed')
      .slice(0, 12)
      .map(issue => {
        const base = `${issue.issueKey} · ${issue.status.toUpperCase()}${issue.failedStep ? ` · ${issue.failedStep}` : ''} · ${issue.summary}`;
        return issue.errors.length > 0
          ? `${base} · ${issue.errors.slice(0, 2).join(' | ')}`
          : base;
      });

    return [
      {
        id: randomUUID(),
        type: 'heading',
        props: { level: 1 },
        content: [{ type: 'text', text: `Jira Migration Report · ${result.jiraProjectKey}`, styles: {} }],
      },
      {
        id: randomUUID(),
        type: 'paragraph',
        content: [{ type: 'text', text: 'Execution summary for the latest Jira import run.', styles: {} }],
      },
      {
        id: randomUUID(),
        type: 'heading',
        props: { level: 2 },
        content: [{ type: 'text', text: 'Overview', styles: {} }],
      },
      this.buildMetricCard('Tickets', `${result.importedTickets} imported · ${result.skippedTickets} skipped`, 'success'),
      this.buildMetricCard('Comments', `${result.importedComments} imported · ${result.skippedComments} skipped`),
      this.buildMetricCard('Attachments', `${result.importedAttachments} imported · ${result.skippedAttachments} skipped`),
      this.buildMetricCard('Custom Fields', `${result.createdBoardCustomFields} created · ${result.reusedBoardCustomFields} reused`),
      this.buildMetricCard(
        'Issue Status',
        `${completedIssues} completed · ${partialIssues} partial · ${failedIssues} failed`,
        failedIssues > 0 ? 'danger' : partialIssues > 0 ? 'warning' : 'success',
      ),
      this.buildMetricCard('Relationships', `${result.linkedTickets} links · ${result.createdSubTickets} subtickets`),
      ...this.buildBulletListBlock(
        topWarnings.length > 0
          ? `Warnings${result.warnings.length > topWarnings.length ? ` (showing ${topWarnings.length} of ${result.warnings.length})` : ''}`
          : 'Warnings',
        topWarnings,
      ),
      ...this.buildBulletListBlock(
        unresolvedUserItems.length > 0
          ? `Unresolved Users${result.unresolvedUsers.length > unresolvedUserItems.length ? ` (showing ${unresolvedUserItems.length} of ${result.unresolvedUsers.length})` : ''}`
          : 'Unresolved Users',
        unresolvedUserItems,
      ),
      ...this.buildBulletListBlock(
        issueDetailItems.length > 0
          ? `Issue Details${result.issueResults.filter(issue => issue.status !== 'completed').length > issueDetailItems.length ? ` (showing ${issueDetailItems.length})` : ''}`
          : 'Issue Details',
        issueDetailItems,
      ),
    ];
  }

  private async createMigrationReportCanvas(
    channelId: string,
    actorUserId: string,
    result: import('@/services/jiraMigrationImportService').JiraMigrationExecuteResult,
  ): Promise<string> {
    const now = new Date();
    const canvasId = randomUUID();
    const viewAccessId = randomUUID();
    const participantId = randomUUID();
    try {
      await db.$transaction(async tx => {
        await tx.canvas.create({
          data: {
            id: canvasId,
            title: `Jira Migration Report: ${result.jiraProjectKey}`,
            content: this.buildMigrationReportCanvasBlocks(result) as any,
            channelId,
            createdBy: actorUserId,
            viewAccessId,
            editAccessId: null,
            visibility: 'PUBLIC',
            isTemplate: false,
            isCollaborative: false,
            lastEditedBy: actorUserId,
            lastEditedAt: now,
            createdAt: now,
            updatedAt: now,
            metadata: {
              source: 'jira_migration_report',
              jiraProjectKey: result.jiraProjectKey,
              externalSourceId: result.externalSourceId || null,
              summary: {
                importedTickets: result.importedTickets,
                skippedTickets: result.skippedTickets,
                importedComments: result.importedComments,
                importedAttachments: result.importedAttachments,
                warnings: result.warnings.length,
                ...this.getMigrationReportSummary(result),
              },
            },
          },
        });

        await tx.canvasParticipant.create({
          data: {
            id: participantId,
            canvasId,
            userId: actorUserId,
            role: 'OWNER',
            joinedAt: now,
            updatedAt: now,
          },
        });
      });
    } catch (error) {
      logger.error('[JiraMigration] Canvas report create failed', error, {
        jiraProjectKey: result.jiraProjectKey,
        externalSourceId: result.externalSourceId || null,
        channelId,
        actorUserId,
        canvasId,
        viewAccessId,
      });
      throw error;
    }

    const canvasUrl = getCanvasUrl(viewAccessId);
    logger.info('[JiraMigration] Canvas report created', {
      jiraProjectKey: result.jiraProjectKey,
      externalSourceId: result.externalSourceId || null,
      channelId,
      actorUserId,
      canvasId,
      viewAccessId,
      canvasUrl,
    });

    return canvasUrl;
  }

  private async postMigrationReport(
    channelId: string,
    actorUserId: string,
    result: import('@/services/jiraMigrationImportService').JiraMigrationExecuteResult,
  ): Promise<void> {
    const conversationId = randomUUID();
    const messageId = randomUUID();
    const now = new Date();
    let canvasUrl: string | null = null;
    try {
      canvasUrl = await this.createMigrationReportCanvas(channelId, actorUserId, result);
    } catch (error) {
      logger.error('[JiraMigration] Canvas report failed; posting summary message without canvas link', error, {
        channelId,
        actorUserId,
        jiraProjectKey: result.jiraProjectKey,
        externalSourceId: result.externalSourceId || null,
      });
    }
    const { completedIssues, partialIssues, failedIssues } = this.getMigrationReportSummary(result);
    const messageContent = [
      `Jira migration report · ${result.jiraProjectKey}`,
      '',
      `Tickets: ${result.importedTickets} imported · ${result.skippedTickets} skipped`,
      `Comments: ${result.importedComments} imported · ${result.skippedComments} skipped`,
      `Attachments: ${result.importedAttachments} imported · ${result.skippedAttachments} skipped`,
      `Issue status: ${completedIssues} completed · ${partialIssues} partial · ${failedIssues} failed`,
      `Warnings: ${result.warnings.length}`,
      ...(canvasUrl ? ['', `View full report: ${canvasUrl}`] : []),
    ].join('\n');

    await db.$transaction(async tx => {
      await tx.conversation.create({
        data: {
          conversationId,
          channelId,
          createdBy: actorUserId,
          initialMessageId: messageId,
          createdAt: now,
          lastActivityAt: now,
          metadata: {
            source: {
              system: 'jira',
              kind: 'migration_report',
              jiraProjectKey: result.jiraProjectKey,
              canvasUrl,
            },
          },
        },
      });

      await tx.message.create({
        data: {
          messageId,
          conversationId,
          senderId: actorUserId,
          content: messageContent,
          msgType: 'SYSTEM',
          hasAttachment: false,
          showInChannel: true,
          metadata: {
            messageSubtype: 'jira_migration_report',
            jiraProjectKey: result.jiraProjectKey,
            externalSourceId: result.externalSourceId || null,
            canvasUrl,
            summary: {
              importedTickets: result.importedTickets,
              skippedTickets: result.skippedTickets,
              importedComments: result.importedComments,
              importedAttachments: result.importedAttachments,
              warnings: result.warnings.length,
              completedIssues,
              partialIssues,
              failedIssues,
            },
          },
          createdAt: now,
        },
      });

      await tx.conversationParticipant.upsert({
        where: {
          conversationId_userId: {
            conversationId,
            userId: actorUserId,
          },
        },
        create: {
          id: randomUUID(),
          conversationId,
          userId: actorUserId,
          participationType: 'AUTHOR',
          isSubscribed: true,
          joinedAt: now,
          channelId,
        },
        update: {
          participationType: 'AUTHOR',
          isSubscribed: true,
        },
      });

      await tx.channel.update({
        where: { id: channelId },
        data: { lastActivityAt: now },
      });
    });
    await messageMetadataService.syncInitialMessageMd(conversationId);

  }

  private async handleProgressUpdate(
    jobId: string,
    update: JiraMigrationProgressUpdate,
  ): Promise<void> {
    await jiraMigrationProgressService.patchJob(jobId, {
      status: 'running',
      totalIssues: update.totalIssues,
      processedIssues: update.processedIssues,
      importedTickets: update.importedTickets,
      skippedTickets: update.skippedTickets,
      importedComments: update.importedComments,
      skippedComments: update.skippedComments,
      importedAttachments: update.importedAttachments,
      skippedAttachments: update.skippedAttachments,
      currentIssueKey: update.currentIssueKey,
      currentStep: update.currentStep,
      stageSequence: update.stageSequence,
      warnings: update.warnings,
    });

    // Stop controls (checked between progress ticks)
    const job = await jiraMigrationProgressService.getJob(jobId);
    if (job?.controlStatus === 'cancel_requested') {
      throw new Error('Migration stopped by user');
    }

    if (update.issueResult) {
      await jiraMigrationProgressService.upsertIssueResult(jobId, update.issueResult);
    }
  }
}
