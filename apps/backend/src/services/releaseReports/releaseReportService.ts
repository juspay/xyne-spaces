import { MessageType, UserType, type User } from '@prisma/client';
import {
  type PublishReleaseReportResponse,
  type ReleaseReport,
  type ReleaseReportChange,
  type ReleaseReportDevTicket,
} from '@xyne/shared';
import { db } from '@/database/client';
import { config } from '@/config/env';
import { TicketRepository } from '@/database/repositories/ticketRepository';
import { MessageRepository } from '@/database/repositories/messageRepository';
import { conversationService } from '@/services/conversationService';
import { unifiedBotUserService } from '@/bots/unified';
import { userActivityTrackingService } from '@/services/userActivityTrackingService';
import { logger } from '@/utils/logger';
import { ReleaseReportCanvasService } from './releaseReportCanvas';

interface ReleaseReportTicketMetadata {
  releaseReportCanvasId?: string;
  releaseReportCanvasUrl?: string;
  releaseReportMessageId?: string;
  releaseReportVersion?: number;
}

interface PublishReleaseReportInput {
  ticketId: string;
  publisher: User;
}

const ENV_VAR_REGEX = /^\s*([A-Za-z][A-Za-z0-9_]*)\s*[=:]/gm;

function buildReleaseReportCanvasUrl(workspaceId: string, canvasId: string): string {
  const frontendUrl = config.slackFrontendUrl.replace(/\/$/, '');
  return `${frontendUrl}/${workspaceId}/chat/canvas/${canvasId}`;
}

function extractEnvironmentVariableNames(...values: string[]): Set<string> {
  const names = new Set<string>();
  for (const value of values) {
    ENV_VAR_REGEX.lastIndex = 0;
    for (const match of value.matchAll(ENV_VAR_REGEX)) {
      if (match[1]) names.add(match[1]);
    }
  }
  return names;
}

function displayValue(value: unknown, fallback = ''): string {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function formatChanges(envCount: number, migrationCount: number): string {
  const values: string[] = [];
  if (envCount > 0) values.push(`${envCount} env`);
  if (migrationCount > 0) values.push(`${migrationCount} mig`);
  return values.length > 0 ? values.join(', ') : '—';
}

export class ReleaseReportService {
  private readonly ticketRepository = new TicketRepository();
  private readonly messageRepository = new MessageRepository();
  private readonly canvasService = new ReleaseReportCanvasService();

  async gatherReleaseReport(ticketId: string): Promise<ReleaseReport> {
    const ticket = await db.ticket.findUnique({
      where: { id: ticketId },
      include: {
        project: { select: { id: true, name: true, workspaceId: true } },
      },
    });
    if (!ticket) {
      throw new Error('Release ticket not found');
    }

    const [releaseFormValues, artRows, releaseChanges] = await Promise.all([
      db.formEntityValues.findMany({
        where: { entityId: ticketId, entityType: 'TICKET' },
      }),
      db.applicationReleaseTicket.findMany({
        where: { releaseId: ticketId },
        orderBy: { createdAt: 'desc' },
      }),
      db.releaseChangeType.findMany({
        where: { releaseId: ticketId },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    const ticketIds = [...new Set(artRows.map((row) => row.ticketId))];
    const applicationIds = [...new Set(releaseChanges.map((change) => change.applicationId))];
    const changeIds = releaseChanges.map((change) => change.id);
    const releaseFieldIds = releaseFormValues.map((value) => value.fieldId);

    const [devTickets, applications, changeFormValues, releaseFields] = await Promise.all([
      db.ticket.findMany({ where: { id: { in: ticketIds } } }),
      db.application.findMany({ where: { id: { in: applicationIds } } }),
      db.formEntityValues.findMany({
        where: {
          contextId: ticketId,
          entityId: { in: changeIds },
          entityType: { in: ['RELEASE_ENV_FORM', 'RELEASE_MIGRATION_FORM'] },
        },
      }),
      db.formFields.findMany({ where: { id: { in: releaseFieldIds } } }),
    ]);

    const pullRequests = await db.pullRequests.findMany({
      where: { ticketId: { in: ticketIds } },
      orderBy: { date: 'desc' },
    });

    const prUrlByTicketId = new Map<string, string>();
    for (const pr of pullRequests) {
      if (pr.ticketId && !prUrlByTicketId.has(pr.ticketId)) {
        prUrlByTicketId.set(pr.ticketId, pr.prUrl);
      }
    }

    const changeFieldIds = [...new Set(changeFormValues.map((value) => value.fieldId))];
    const changeFields = await db.formFields.findMany({
      where: { id: { in: changeFieldIds } },
    });
    const users = await db.user.findMany({
      where: {
        id: {
          in: [
            ...new Set([
              ...devTickets.map((devTicket) => devTicket.assignedTo).filter(Boolean),
              ...devTickets.map((devTicket) => devTicket.createdBy).filter(Boolean),
              ...artRows.map((row) => row.testedBy).filter(Boolean),
            ] as string[]),
          ],
        },
      },
      select: { id: true, name: true, email: true },
    });

    const releaseFieldNames = new Map(releaseFields.map((field) => [field.id, field.fieldName]));
    const releaseVersionValue = releaseFormValues.find(
      (value) => releaseFieldNames.get(value.fieldId) === 'releaseVersion'
    );
    const releaseVersion = releaseVersionValue
      ? displayValue(
          releaseVersionValue.actualFieldValue ?? releaseVersionValue.fieldValue
        ).trim() || null
      : null;

    const fieldNames = new Map(changeFields.map((field) => [field.id, field.fieldName]));
    const valuesByChangeId = new Map<string, Record<string, string>>();
    for (const value of changeFormValues) {
      const fieldName = fieldNames.get(value.fieldId);
      if (!fieldName) continue;
      const values = valuesByChangeId.get(value.entityId) ?? {};
      values[fieldName] = displayValue(value.actualFieldValue ?? value.fieldValue);
      valuesByChangeId.set(value.entityId, values);
    }

    const applicationsById = new Map(
      applications.map((application) => [application.id, application])
    );
    const usersById = new Map(users.map((user) => [user.id, user.name ?? user.email ?? user.id]));
    /**
     * Resolve a user id to a display name, falling back to the raw id when the user row
     * isn't loaded. Returns null only when no id is set, so callers can chain fallbacks.
     */
    const resolveUser = (userId: string | null | undefined): string | null =>
      userId ? (usersById.get(userId) ?? userId) : null;
    const devTicketsById = new Map(devTickets.map((devTicket) => [devTicket.id, devTicket]));

    const mappedChanges: ReleaseReportChange[] = releaseChanges.map((change) => {
      const values = valuesByChangeId.get(change.id) ?? {};
      const application = applicationsById.get(change.applicationId);
      return {
        id: change.id,
        applicationName: application?.name ?? 'Unknown application',
        repositoryUrl: application?.repoUrl ?? null,
        filePath: change.filePath ?? 'Unknown file',
        devTicketId: change.devTicketXyneId,
        commitId: change.commitId,
        description: values.description ?? '',
        oldValue: values.oldValue ?? '',
        newValue: values.newValue ?? '',
        changeLog: values.changeLog ?? values.query ?? '',
        createdAt: change.createdAt?.toISOString() ?? '',
      };
    });
    const changeTypesById = new Map(releaseChanges.map((change) => [change.id, change.changeType]));

    const countsByDevTicket = new Map<
      string,
      { environmentVariables: Set<string>; migrationFiles: Set<string> }
    >();
    const releaseEnvironmentVariables = new Set<string>();
    const releaseMigrationFiles = new Set<string>();

    for (const change of releaseChanges) {
      const values = valuesByChangeId.get(change.id) ?? {};
      const ticketKey = change.devTicketXyneId;
      const ticketCounts = ticketKey
        ? (countsByDevTicket.get(ticketKey) ?? {
            environmentVariables: new Set<string>(),
            migrationFiles: new Set<string>(),
          })
        : null;

      if (change.changeType === 'ENV') {
        const names = extractEnvironmentVariableNames(values.oldValue ?? '', values.newValue ?? '');
        names.forEach((name) => {
          releaseEnvironmentVariables.add(name);
          ticketCounts?.environmentVariables.add(name);
        });
      } else if (change.changeType === 'MIGRATION') {
        releaseMigrationFiles.add(`${change.applicationId}:${change.filePath ?? ''}`);
        ticketCounts?.migrationFiles.add(change.filePath ?? '');
      }
      if (ticketKey && ticketCounts) countsByDevTicket.set(ticketKey, ticketCounts);
    }

    const seenDevTickets = new Set<string>();
    const reportDevTickets: ReleaseReportDevTicket[] = [];
    for (const artRow of artRows) {
      if (seenDevTickets.has(artRow.ticketId)) continue;
      seenDevTickets.add(artRow.ticketId);
      const devTicket = devTicketsById.get(artRow.ticketId);
      const ticketXyneId = devTicket?.xyneId ?? artRow.ticketId;
      const counts = countsByDevTicket.get(ticketXyneId);
      // Dev owner precedence: assignee -> creator (reporter) -> 'Unknown'.
      // Only 'Unknown' when neither the assignee nor the creator resolves to a user.
      const assignedOwner = resolveUser(devTicket?.assignedTo);
      const reportedOwner = resolveUser(devTicket?.createdBy);
      reportDevTickets.push({
        ticketId: ticketXyneId,
        title: devTicket?.title ?? artRow.ticketId,
        devOwner: assignedOwner ?? reportedOwner ?? 'Unknown',
        type: devTicket?.ticketType ?? '',
        status: devTicket?.stageName ?? 'Unknown',
        changes: formatChanges(
          counts?.environmentVariables.size ?? 0,
          counts?.migrationFiles.size ?? 0
        ),
        qaOwner: resolveUser(artRow.testedBy) ?? 'Unassigned',
        prUrl: prUrlByTicketId.get(artRow.ticketId) ?? null,
      });
    }

    const generatedAt = new Date().toISOString();
    return {
      release: {
        ticketId: ticket.id,
        xyneId: ticket.xyneId,
        title: ticket.title,
        version: releaseVersion,
        status: ticket.stageName,
        projectId: ticket.project.id,
        projectName: ticket.project.name,
        workspaceId: ticket.project.workspaceId,
        channelId: ticket.channelId,
        conversationId: ticket.conversationId,
        createdAt: ticket.createdAt.toISOString(),
        generatedAt,
      },
      summary: {
        devTicketCount: reportDevTickets.length,
        environmentVariableCount: releaseEnvironmentVariables.size,
        migrationFileCount: releaseMigrationFiles.size,
      },
      devTickets: reportDevTickets,
      environmentChanges: mappedChanges.filter(
        (change) => changeTypesById.get(change.id) === 'ENV'
      ),
      migrations: mappedChanges.filter((change) => changeTypesById.get(change.id) === 'MIGRATION'),
    };
  }

  async publish({
    ticketId,
    publisher,
  }: PublishReleaseReportInput): Promise<PublishReleaseReportResponse> {
    const report = await this.gatherReleaseReport(ticketId);

    return db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'release-report:' + ticketId}))`;
        return this.publishLocked(ticketId, publisher, report);
      },
      { maxWait: 10_000, timeout: 60_000 }
    );
  }

  private async publishLocked(
    ticketId: string,
    publisher: User,
    report: ReleaseReport
  ): Promise<PublishReleaseReportResponse> {
    const ticket = await db.ticket.findUnique({
      where: { id: ticketId },
      select: { metadata: true },
    });
    const existingMetadata = (ticket?.metadata as ReleaseReportTicketMetadata | null) ?? {};
    const version = (existingMetadata.releaseReportVersion ?? 0) + 1;
    const owner =
      (await unifiedBotUserService.getBotByBotId('xyne-release-bot', report.release.workspaceId)) ??
      publisher;

    const canvas = await this.canvasService.createOrUpdate(
      report,
      owner,
      version,
      existingMetadata.releaseReportCanvasId
    );
    const canvasUrl = buildReleaseReportCanvasUrl(report.release.workspaceId, canvas.canvasId);

    const baseMetadata = {
      releaseReportCanvasId: canvas.canvasId,
      releaseReportCanvasUrl: canvasUrl,
      releaseReportVersion: version,
      releaseReportPublishedAt: report.release.generatedAt,
    };

    let messageId: string | undefined;
    let messageError: unknown;
    try {
      const messageContent = `## Release Report ${canvas.action === 'created' ? 'Published' : 'Updated'}

A full release report for **${report.release.xyneId} - ${report.release.title}** is available.

[View Release Report](${canvasUrl})`;
      const existingMessage = await this.messageRepository.findExistingReleaseReportMessage(
        report.release.conversationId,
        ticketId
      );

      if (existingMessage) {
        await conversationService.updateMessageContent({
          messageId: existingMessage.messageId,
          content: messageContent,
          metadata: {
            messageSubtype: 'release_report',
            releaseTicketId: ticketId,
            releaseTicketXyneId: report.release.xyneId,
            canvasUrl,
            canvasId: canvas.canvasId,
            version,
            contentFormat: 'markdown',
            lastUpdatedAt: report.release.generatedAt,
          },
        });
        messageId = existingMessage.messageId;
      } else {
        const result = await conversationService.addMessageToConversation({
          conversationId: report.release.conversationId,
          userId: owner.id,
          content: messageContent,
          msgType: MessageType.SYSTEM,
          isBot: owner.userType === UserType.BOT,
          isMarkdown: true,
          metadata: {
            messageSubtype: 'release_report',
            releaseTicketId: ticketId,
            releaseTicketXyneId: report.release.xyneId,
            canvasUrl,
            canvasId: canvas.canvasId,
            version,
          },
        });
        messageId = result.message.messageId;
      }
    } catch (error) {
      messageError = error;
      logger.error('[ReleaseReport] Canvas published but thread message failed', error);
    }

    let metadataError: unknown;
    try {
      await this.ticketRepository.updateTicketMetadata(ticketId, {
        ...baseMetadata,
        ...(messageId ? { releaseReportMessageId: messageId } : {}),
        releaseReportPublicationStatus: messageError ? 'PARTIAL_FAILURE' : 'PUBLISHED',
        releaseReportLastError: messageError
          ? messageError instanceof Error
            ? messageError.message
            : 'Failed to post the report to the release thread'
          : null,
      });
    } catch (error) {
      metadataError = error;
      logger.error('[ReleaseReport] Failed to persist publication metadata', error);
    }

    const partialFailure = Boolean(messageError || metadataError);
    void userActivityTrackingService
      .trackReleaseReportPublished(publisher.id, {
        ticketId,
        canvasId: canvas.canvasId,
        action: canvas.action,
        version,
        devTicketCount: report.summary.devTicketCount,
        environmentVariableCount: report.summary.environmentVariableCount,
        migrationFileCount: report.summary.migrationFileCount,
        partialFailure,
      })
      .catch((trackingError) =>
        logger.debug('[ReleaseReport] Analytics tracking failed', trackingError)
      );

    const warningParts = [
      messageError
        ? messageError instanceof Error
          ? `Thread message: ${messageError.message}`
          : 'Thread message could not be posted'
        : null,
      metadataError
        ? metadataError instanceof Error
          ? `Ticket metadata: ${metadataError.message}`
          : 'Ticket publication metadata could not be saved'
        : null,
    ].filter((value): value is string => Boolean(value));

    return {
      success: !partialFailure,
      partialFailure,
      action: canvas.action,
      canvasUrl,
      version,
      ...(warningParts.length > 0 ? { warning: warningParts.join('. ') } : {}),
    };
  }
}
