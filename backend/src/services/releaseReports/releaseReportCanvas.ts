import { CanvasRole, CanvasVisibility, Prisma, type User } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import type { ReleaseReport, ReleaseReportChange } from '@xyne/shared';
import { db } from '@/database/client';
import type { BlockNoteBlock, BlockNoteInlineContent } from '@/types/blockNoteTypes';
import { CanvasSideEffectHandler } from '@/zero/side-effects/tables/canvas-handler';
import { vespaQueue } from '@/queues/vespaQueue';
import { fileSchema, SubApp } from '@/vespa/src/types';
import { logger } from '@/utils/logger';

interface ReleaseReportCanvasResult {
  canvasId: string;
  action: 'created' | 'updated';
}

const text = (value: string, bold = false): BlockNoteInlineContent => ({
  type: 'text',
  text: value,
  styles: bold ? { bold: true } : {},
});

const paragraph = (...content: BlockNoteInlineContent[]): BlockNoteBlock => ({
  id: uuidv4(),
  type: 'paragraph',
  content,
});

const heading = (value: string, level: 1 | 2 | 3): BlockNoteBlock => ({
  id: uuidv4(),
  type: 'heading',
  props: { level },
  content: [text(value, level === 1)],
});

const codeBlock = (value: string, language?: string): BlockNoteBlock => ({
  id: uuidv4(),
  type: 'codeBlock',
  props: language ? { language } : {},
  content: [{ type: 'text', text: value, styles: {} }],
});

function buildDevTicketTable(report: ReleaseReport): BlockNoteBlock {
  const headers = ['Ticket Id', 'Title', 'Dev Owner', 'Type', 'Status', 'Changes', 'QA Owner', 'PR URL'];
  const rows = [
    {
      cells: headers.map((value) => ({
        type: 'tableCell' as const,
        content: [text(value, true)],
      })),
    },
    ...report.devTickets.map((ticket) => ({
      cells: [
        ticket.ticketId,
        ticket.title,
        ticket.devOwner,
        ticket.type,
        ticket.status,
        ticket.changes,
        ticket.qaOwner,
        ticket.prUrl ?? '—',
      ].map((value) => ({
        type: 'tableCell' as const,
        content: [text(value)],
      })),
    })),
  ];

  return {
    id: uuidv4(),
    type: 'table',
    content: {
      type: 'tableContent',
      rows,
      headerRows: 1,
    },
  };
}

function buildChangeSection(
  title: string,
  emptyMessage: string,
  changes: ReleaseReportChange[],
  kind: 'environment' | 'migration'
): BlockNoteBlock[] {
  const blocks: BlockNoteBlock[] = [heading(title, 2)];
  if (changes.length === 0) {
    blocks.push(paragraph(text(emptyMessage)));
    return blocks;
  }

  const changesByApplication = new Map<string, ReleaseReportChange[]>();
  for (const change of changes) {
    const applicationChanges = changesByApplication.get(change.applicationName) ?? [];
    applicationChanges.push(change);
    changesByApplication.set(change.applicationName, applicationChanges);
  }

  for (const [applicationName, applicationChanges] of changesByApplication) {
    blocks.push(heading(applicationName, 3));
    for (const change of applicationChanges) {
      const attribution = [
        change.devTicketId ? `Ticket ${change.devTicketId}` : 'Unmapped ticket',
        change.commitId ? `commit ${change.commitId.slice(0, 8)}` : null,
      ]
        .filter(Boolean)
        .join(' | ');

      blocks.push(paragraph(text(change.filePath, true)));
      blocks.push(paragraph(text(attribution)));
      if (change.description) {
        blocks.push(paragraph(text(change.description)));
      }

      if (kind === 'environment') {
        if (change.oldValue) {
          blocks.push(paragraph(text('Previous value', true)));
          blocks.push(codeBlock(change.oldValue));
        }
        if (change.newValue) {
          blocks.push(paragraph(text('New value', true)));
          blocks.push(codeBlock(change.newValue));
        }
      } else if (change.changeLog) {
        blocks.push(codeBlock(change.changeLog, 'sql'));
      }
    }
  }

  return blocks;
}

export function buildReleaseReportBlocks(report: ReleaseReport): BlockNoteBlock[] {
  const release = report.release;
  const blocks: BlockNoteBlock[] = [
    heading(`Release Report: ${release.xyneId}`, 1),
    paragraph(text(release.title)),
    paragraph(text('Version: ', true), text(release.version ?? 'Not set')),
    paragraph(text('Status: ', true), text(release.status)),
    paragraph(text('Project: ', true), text(release.projectName)),
    paragraph(text('Created: ', true), text(new Date(release.createdAt).toLocaleString('en-US'))),
    paragraph(
      text('Generated: ', true),
      text(new Date(release.generatedAt).toLocaleString('en-US'))
    ),
    heading('Summary', 2),
    paragraph(
      text(
        `${report.summary.devTicketCount} dev tickets | ` +
          `${report.summary.environmentVariableCount} environment variables | ` +
          `${report.summary.migrationFileCount} migration files`
      )
    ),
    heading('Dev Tickets', 2),
  ];

  if (report.devTickets.length === 0) {
    blocks.push(paragraph(text('No Dev Tickets are currently mapped to this release.')));
  } else {
    blocks.push(buildDevTicketTable(report));
  }

  blocks.push(
    ...buildChangeSection(
      'Environment Changes',
      'No environment changes are recorded for this release.',
      report.environmentChanges,
      'environment'
    ),
    ...buildChangeSection(
      'Migrations',
      'No migrations are recorded for this release.',
      report.migrations,
      'migration'
    )
  );

  return blocks;
}

export class ReleaseReportCanvasService {
  async createOrUpdate(
    report: ReleaseReport,
    owner: User,
    version: number,
    preferredCanvasId?: string
  ): Promise<ReleaseReportCanvasResult> {
    const now = new Date();
    const title = `Release Report: ${report.release.xyneId}${
      report.release.version ? ` (${report.release.version})` : ''
    }`;
    const content = buildReleaseReportBlocks(report);
    const metadata: Prisma.InputJsonObject = {
      source: 'release_report',
      releaseTicketId: report.release.ticketId,
      releaseTicketXyneId: report.release.xyneId,
      projectId: report.release.projectId,
      workspaceId: report.release.workspaceId,
      channelId: report.release.channelId,
      conversationId: report.release.conversationId,
      generatedAt: report.release.generatedAt,
      version,
      devTicketCount: report.summary.devTicketCount,
      environmentVariableCount: report.summary.environmentVariableCount,
      migrationFileCount: report.summary.migrationFileCount,
      mentionedUserIds: [],
    };

    const result = await db.$transaction(async (tx) => {
      const preferredCanvas = preferredCanvasId
        ? await tx.canvas.findFirst({
            where: {
              id: preferredCanvasId,
              AND: [
                { metadata: { path: ['source'], equals: 'release_report' } },
                {
                  metadata: {
                    path: ['releaseTicketId'],
                    equals: report.release.ticketId,
                  },
                },
              ],
            },
            select: { id: true },
          })
        : null;
      const existingCanvas =
        preferredCanvas ??
        (await tx.canvas.findFirst({
          where: {
            AND: [
              { metadata: { path: ['source'], equals: 'release_report' } },
              {
                metadata: {
                  path: ['releaseTicketId'],
                  equals: report.release.ticketId,
                },
              },
            ],
          },
          select: { id: true },
          orderBy: { createdAt: 'asc' },
        }));

      if (existingCanvas) {
        await tx.canvas.update({
          where: { id: existingCanvas.id },
          data: {
            title,
            content: content as unknown as Prisma.InputJsonValue,
            channelId: report.release.channelId,
            projectId: report.release.projectId,
            createdBy: owner.id,
            lastEditedBy: owner.id,
            lastEditedAt: now,
            visibility: CanvasVisibility.PUBLIC,
            isCollaborative: false,
            metadata,
          },
        });
        await tx.canvasParticipant.upsert({
          where: {
            canvasId_userId: {
              canvasId: existingCanvas.id,
              userId: owner.id,
            },
          },
          create: {
            id: uuidv4(),
            canvasId: existingCanvas.id,
            userId: owner.id,
            role: CanvasRole.VIEWER,
            joinedAt: now,
            updatedAt: now,
          },
          update: {
            role: CanvasRole.VIEWER,
            updatedAt: now,
          },
        });

        return {
          canvasId: existingCanvas.id,
          action: 'updated' as const,
        };
      }

      const canvasId = uuidv4();
      await tx.canvas.create({
        data: {
          id: canvasId,
          title,
          content: content as unknown as Prisma.InputJsonValue,
          channelId: report.release.channelId,
          projectId: report.release.projectId,
          createdBy: owner.id,
          visibility: CanvasVisibility.PUBLIC,
          isTemplate: false,
          isCollaborative: false,
          lastEditedBy: owner.id,
          lastEditedAt: now,
          metadata,
        },
      });
      await tx.canvasParticipant.create({
        data: {
          id: uuidv4(),
          canvasId,
          userId: owner.id,
          role: CanvasRole.VIEWER,
          joinedAt: now,
          updatedAt: now,
        },
      });

      return { canvasId, action: 'created' as const };
    });

    await this.runSideEffects(result, owner);
    return result;
  }

  private async runSideEffects(result: ReleaseReportCanvasResult, owner: User): Promise<void> {
    if (!owner.workspaceId) {
      logger.warn('[ReleaseReport] Skipping Canvas side effects: owner has no workspace', {
        ownerId: owner.id,
        canvasId: result.canvasId,
      });
      return;
    }

    try {
      const orgMember = await db.orgMember.findUnique({
        where: { email: owner.email },
        select: { memberId: true, role: true },
      });
      if (orgMember) {
        const handler = new CanvasSideEffectHandler({
          userID: owner.id,
          workspaceId: owner.workspaceId,
          role: owner.role,
          memberId: orgMember.memberId,
          orgRole: orgMember.role,
        });
        if (result.action === 'created') {
          await handler.onInsert({
            entityId: result.canvasId,
            entityType: 'canvases',
            operation: 'insert',
          });
        }
      } else {
        logger.warn('[ReleaseReport] Canvas owner has no organization membership', {
          ownerId: owner.id,
          canvasId: result.canvasId,
        });
      }
    } catch (error) {
      logger.error('[ReleaseReport] Canvas side effects failed', error, {
        ownerId: owner.id,
        canvasId: result.canvasId,
      });
    }

    // onInsert returns before queueing when a Canvas has no mentions. Release
    // reports are mention-free, so always queue create/update explicitly.
    try {
      await vespaQueue.addJob({
        schema: fileSchema,
        docId: result.canvasId,
        jobType: 'feed',
        userId: owner.id,
        workspaceId: owner.workspaceId,
        app: SubApp.CANVAS,
      });
    } catch (error) {
      logger.error('[ReleaseReport] Failed to queue Canvas for Vespa indexing', error);
    }
  }
}
