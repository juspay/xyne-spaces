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

const db = DatabaseClient.getInstance();

export class JiraMigrationController {
  preview = async (req: Request, res: Response): Promise<void> => {
    try {
      const { jiraProjectKey, targetProjectId, targetBoardId, targetChannelId } = req.body as {
        jiraProjectKey?: string;
        targetProjectId?: string;
        targetBoardId?: string;
        targetChannelId?: string;
        nextPageToken?: string;
        maxResults?: number;
        dateFrom?: string;
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
        nextPageToken: req.body.nextPageToken,
        maxResults: req.body.maxResults,
        dateFrom: typeof req.body.dateFrom === 'string' ? req.body.dateFrom : undefined,
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
        dateFrom?: string;
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
        dateFrom: typeof req.body.dateFrom === 'string' ? req.body.dateFrom : undefined,
      };

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
        currentStep: 'starting',
        currentIssueKey: null,
      });

      const result = await jiraMigrationImportService.execute(
        input,
        actorUserId,
        async (update: JiraMigrationProgressUpdate) => {
          await this.handleProgressUpdate(jobId, update);
        },
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

  private formatMigrationReport(result: import('@/services/jiraMigrationImportService').JiraMigrationExecuteResult): string {
    const { completedIssues, partialIssues, failedIssues } = this.getMigrationReportSummary(result);
    const detailLines = result.issueResults
      .filter(issue => issue.status !== 'completed')
      .flatMap(issue => {
        const base = `${issue.issueKey} [${issue.status}]${issue.failedStep ? ` step=${issue.failedStep}` : ''}: ${issue.summary}`;
        if (issue.errors.length === 0) {
          return [base];
        }
        return [base, ...issue.errors.map(error => `  - ${error}`)];
      });
    const warningLines = result.warnings.map(warning => `- ${warning}`);
    const unresolvedUserLines = result.unresolvedUsers.map(user => {
      const name = user.displayName || user.accountId || 'Unknown Jira user';
      const suggestions = user.suggestedEmails.length > 0 ? ` -> ${user.suggestedEmails.join(', ')}` : '';
      return `- ${name}${suggestions}`;
    });

    return [
      `Jira migration completed for ${result.jiraProjectKey}.`,
      '',
      `Imported tickets: ${result.importedTickets}`,
      `Skipped tickets: ${result.skippedTickets}`,
      `Imported comments: ${result.importedComments}`,
      `Imported attachments: ${result.importedAttachments}`,
      `Created custom fields: ${result.createdBoardCustomFields}`,
      `Reused custom fields: ${result.reusedBoardCustomFields}`,
      `Linked tickets: ${result.linkedTickets}`,
      `Created subtickets: ${result.createdSubTickets}`,
      '',
      `Completed issues: ${completedIssues}`,
      `Partial issues: ${partialIssues}`,
      `Failed issues: ${failedIssues}`,
      `Warnings: ${result.warnings.length}`,
      ...(unresolvedUserLines.length > 0 ? ['', 'Unresolved users:', ...unresolvedUserLines] : []),
      ...(warningLines.length > 0 ? ['', 'Warnings detail:', ...warningLines] : []),
      ...(detailLines.length > 0 ? ['', 'Issue error detail:', ...detailLines] : []),
    ].join('\n');
  }

  private buildMigrationReportCanvasBlocks(
    result: import('@/services/jiraMigrationImportService').JiraMigrationExecuteResult,
    reportText: string,
  ) {
    const paragraphs = reportText.split(/\n\n+/).map(section => section.trim()).filter(Boolean);

    return [
      {
        id: randomUUID(),
        type: 'heading',
        props: { level: 1 },
        content: [{ type: 'text', text: `Jira Migration Report: ${result.jiraProjectKey}`, styles: {} }],
      },
      ...paragraphs.map(section => ({
        id: randomUUID(),
        type: 'paragraph',
        content: [{ type: 'text', text: section, styles: {} }],
      })),
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
    const reportText = this.formatMigrationReport(result);

    await db.$transaction(async tx => {
      await tx.canvas.create({
        data: {
          id: canvasId,
          title: `Jira Migration Report: ${result.jiraProjectKey}`,
          content: this.buildMigrationReportCanvasBlocks(result, reportText) as any,
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

    return getCanvasUrl(viewAccessId);
  }

  private async postMigrationReport(
    channelId: string,
    actorUserId: string,
    result: import('@/services/jiraMigrationImportService').JiraMigrationExecuteResult,
  ): Promise<void> {
    const conversationId = randomUUID();
    const messageId = randomUUID();
    const now = new Date();
    const canvasUrl = await this.createMigrationReportCanvas(channelId, actorUserId, result);
    const { completedIssues, partialIssues, failedIssues } = this.getMigrationReportSummary(result);
    const messageContent = [
      `Jira migration completed for ${result.jiraProjectKey}.`,
      `Imported tickets: ${result.importedTickets}, skipped tickets: ${result.skippedTickets}.`,
      `Completed issues: ${completedIssues}, partial issues: ${partialIssues}, failed issues: ${failedIssues}.`,
      `📄 View report canvas: ${canvasUrl}`,
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
      warnings: update.warnings,
    });

    if (update.issueResult) {
      await jiraMigrationProgressService.upsertIssueResult(jobId, update.issueResult);
    }
  }
}
