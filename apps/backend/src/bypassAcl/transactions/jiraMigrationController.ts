import { transaction } from '../base';
import { db, JiraMigrationController } from '@/controllers/jiraMigrationController';
import { CanvasVisibility, CanvasRole, MessageType, ConversationParticipation } from '@xyne/shared';
import { JiraMigrationExecuteResult } from '@/services/jiraMigrationImportService';
import { randomUUID } from 'crypto';


export function moveJiraProjectBoardTx(batch: { ticketId: string; stageName: string; kanbanPosition: string; }[], targetBoardId: string, actorUserId: string, now: Date) {
  return transaction(['Ticket'], 'moveJiraProjectBoard: batch ticket board moves must commit atomically; tx is not ACL-wrapped', db, async tx => {
    for (const update of batch) {
      await tx.ticket.update({
        where: { id: update.ticketId },
        data: {
          boardId: targetBoardId,
          kanbanPosition: update.kanbanPosition,
          updatedBy: actorUserId,
          updatedAt: now,
        },
      });
    }
  });
}
export function moveJiraProjectChannelTx(ticketsToMove: { id: string; conversationId: string | null }[], sourceChannelId: string, targetChannelId: string, actorUserId: string, now: Date, conversationIds: string[], targetChannel: any, mappedTicketIds: any, sourceExternalSource: any, targetExternalSourceName: string) {
  return transaction(['Conversation', 'ConversationParticipant', 'ExternalSource', 'Ticket'], 'moveJiraProjectChannel: ticket, conversation, participant and external-source moves must commit atomically; tx is not ACL-wrapped', db, async tx => {
    const ticketUpdate = await tx.ticket.updateMany({
      where: {
        id: { in: ticketsToMove.map(ticket => ticket.id) },
        channelId: sourceChannelId,
      },
      data: {
        channelId: targetChannelId,
        updatedBy: actorUserId,
        updatedAt: now,
      },
    });

    const conversationUpdateCount =
      conversationIds.length > 0
        ? (
            await tx.conversation.updateMany({
              where: { conversationId: { in: conversationIds }, channelId: sourceChannelId },
              data: { channelId: targetChannelId, workspaceId: targetChannel.workspaceId },
            })
          ).count
        : 0;

    const participantUpdateCount =
      conversationIds.length > 0
        ? (
            await tx.conversationParticipant.updateMany({
              where: { conversationId: { in: conversationIds }, channelId: sourceChannelId },
              data: { channelId: targetChannelId },
            })
          ).count
        : 0;

    const remainingOnSource = await tx.ticket.count({
      where: {
        id: { in: mappedTicketIds },
        channelId: sourceChannelId,
      },
    });

    let externalSourceUpdated = false;
    if (remainingOnSource === 0) {
      await tx.externalSource.update({
        where: { id: sourceExternalSource.id },
        data: {
          name: targetExternalSourceName,
          channelId: targetChannelId,
        },
      });
      externalSourceUpdated = true;
    }

    return {
      ticketUpdateCount: ticketUpdate.count,
      conversationUpdateCount,
      participantUpdateCount,
      remainingOnSource,
      externalSourceUpdated,
    };
  });
}
export function runPurgeJobTx(chunk: string[]) {
  return transaction(['Conversation', 'ConversationParticipant', 'Message', 'MessageAttachment'], 'runPurgeJob: conversation chunk plus participant, attachment and message deletes must commit atomically; tx is not ACL-wrapped', db, async tx => {
    await tx.conversationParticipant.deleteMany({ where: { conversationId: { in: chunk } } });
    await tx.messageAttachment.deleteMany({ where: { conversationId: { in: chunk } } });
    await tx.message.deleteMany({ where: { conversationId: { in: chunk } } });
    await tx.conversation.deleteMany({ where: { conversationId: { in: chunk } } });
  });
}
export function createMigrationReportCanvasTx(canvasId: string, canvasChannel: any, result: JiraMigrationExecuteResult, channelId: string, actorUserId: string, now: Date, self: JiraMigrationController, participantId: string) {
  return transaction(['Canvas', 'CanvasParticipant'], 'createMigrationReportCanvas: migration report canvas plus participant rows must commit atomically; tx is not ACL-wrapped', db, async tx => {
    await tx.canvas.create({
      data: {
        id: canvasId,
        workspaceId: canvasChannel.workspaceId,
        title: `Jira Migration Report: ${result.jiraProjectKey}`,
        content: [],
        channelId,
        createdBy: actorUserId,
        visibility: CanvasVisibility.PUBLIC,
        isTemplate: false,
        isCollaborative: true,
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
            ...self.getMigrationReportSummary(result),
          },
        },
      },
    });

    await tx.canvasParticipant.create({
      data: {
        id: participantId,
        workspaceId: canvasChannel.workspaceId,
        canvasId,
        userId: actorUserId,
        role: CanvasRole.OWNER,
        joinedAt: now,
        updatedAt: now,
      },
    });
  });
}
export function postMigrationReportTx(conversationId: string, channelId: string, actorUserId: string, messageId: string, migrationReportChannel: any, now: Date, result: JiraMigrationExecuteResult, canvasUrl: string | null, messageContent: string, completedIssues: number, partialIssues: number, failedIssues: number) {
  return transaction(['Channel', 'Conversation', 'ConversationParticipant', 'Message'], 'postMigrationReport: migration report conversation, message, participant and channel touch must commit atomically; tx is not ACL-wrapped', db, async tx => {
    await tx.conversation.create({
      data: {
        conversationId,
        channelId,
        createdBy: actorUserId,
        initialMessageId: messageId,
        workspaceId: migrationReportChannel.workspaceId,
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
        workspaceId: migrationReportChannel.workspaceId,
        content: messageContent,
        msgType: MessageType.SYSTEM,
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
        participationType: ConversationParticipation.AUTHOR,
        isSubscribed: true,
        joinedAt: now,
        channelId,
        workspaceId: migrationReportChannel.workspaceId,
      },
      update: {
        participationType: ConversationParticipation.AUTHOR,
        isSubscribed: true,
      },
    });

    await tx.channel.update({
      where: { id: channelId },
      data: { lastActivityAt: now },
    });
  });
}
