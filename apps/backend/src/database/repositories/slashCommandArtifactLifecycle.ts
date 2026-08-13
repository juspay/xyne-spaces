import type { Prisma } from '@prisma/client';
import {
  getSlashCommandArtifactDiagnosticKey,
  getSlashCommandMessageArtifact,
  MessageArtifactStatus,
  parseSlashCommandArtifactMessage,
  serializeInitialMessageMd,
  serializeParentMessageMd,
  updateSlashCommandArtifactBannerLifecycle,
  type InitialMessageSummary,
  type ParentMessageSummary,
  type SlashCommandArtifactSideEffectLifecycleStatus,
} from '@xyne/shared';
import { logger } from '@/utils/logger';

export interface SlashCommandArtifactCallMetadata {
  conversationId?: string;
  artifactMessageId?: string;
}

export type SlashCommandArtifactLifecycleSource =
  | 'call_repository_update'
  | 'end_call'
  | 'participant_leave'
  | 'room_finished'
  | 'call_created';

/**
 * Persist the queryable lifecycle on the shared artifact row, then update its
 * FlowJSON rendering snapshot and every denormalized message snapshot in the
 * same transaction. Channel lists render
 * `initial_message_md`, while threads can render `messages.content`; updating
 * only one is what previously allowed the two surfaces to disagree.
 */
export const updateArtifactBannerLifecycle = async (
  tx: Prisma.TransactionClient,
  artifactMessageId: string,
  callExternalId: string,
  status: SlashCommandArtifactSideEffectLifecycleStatus,
  source: SlashCommandArtifactLifecycleSource
): Promise<void> => {
  const logContext = {
    artifactKey: getSlashCommandArtifactDiagnosticKey(artifactMessageId),
    callKey: getSlashCommandArtifactDiagnosticKey(callExternalId),
    lifecycleStatus: status,
    source,
  };

  try {
    // Message insertion side effects normally create this row before an
    // activity is published. Call creation can race that worker, so bootstrap
    // the same canonical row here instead of dropping the lifecycle event.
    const existingArtifact = await tx.messageArtifact.findUnique({
      where: { messageId: artifactMessageId },
      select: { id: true },
    });
    if (!existingArtifact) {
      const bootstrapMessage = await tx.message.findUnique({
        where: { messageId: artifactMessageId },
        select: {
          messageId: true,
          workspaceId: true,
          conversationId: true,
          content: true,
          isDeleted: true,
          visibleTo: true,
          conversation: {
            select: {
              channelId: true,
              initialMessageId: true,
              createdAt: true,
            },
          },
        },
      });
      const bootstrapArtifact = getSlashCommandMessageArtifact(bootstrapMessage?.content);
      if (
        !bootstrapMessage ||
        bootstrapMessage.isDeleted ||
        !bootstrapArtifact ||
        !bootstrapMessage.conversation.channelId
      ) {
        logger.warn('slash_command_artifact_lifecycle_record_missing', logContext);
        return;
      }
      await tx.messageArtifact.upsert({
        where: { messageId: artifactMessageId },
        create: {
          workspaceId: bootstrapMessage.workspaceId,
          messageId: artifactMessageId,
          channelId: bootstrapMessage.conversation.channelId,
          conversationId: bootstrapMessage.conversationId,
          conversationCreatedAt: bootstrapMessage.conversation.createdAt,
          messagePreview: bootstrapArtifact.messagePreview,
          isInitialMessage:
            bootstrapMessage.conversation.initialMessageId === bootstrapMessage.messageId,
          visibleTo: bootstrapMessage.visibleTo,
          type: bootstrapArtifact.type,
          command: bootstrapArtifact.command,
          status: bootstrapArtifact.status,
          callExternalId: bootstrapArtifact.callExternalId,
        },
        update: {},
      });
    }

    // Call creation and old-call completion webhooks can overlap. Serialize all
    // lifecycle transitions for this artifact so the last transition is based
    // on the latest persisted call link rather than a stale pre-lock read.
    const [lockedArtifact] = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "message_artifacts"
      WHERE "messageId" = ${artifactMessageId}
      FOR UPDATE
    `;
    if (!lockedArtifact) {
      logger.warn('slash_command_artifact_lifecycle_record_missing', logContext);
      return;
    }

    const artifactRecord = await tx.messageArtifact.findUnique({
      where: { messageId: artifactMessageId },
      select: { status: true, callExternalId: true },
    });
    if (!artifactRecord) {
      logger.warn('slash_command_artifact_lifecycle_record_missing', logContext);
      return;
    }

    const message = await tx.message.findUnique({
      where: { messageId: artifactMessageId },
      select: {
        messageId: true,
        conversationId: true,
        workspaceId: true,
        senderId: true,
        content: true,
        msgType: true,
        hasAttachment: true,
        edited: true,
        isDeleted: true,
        showInChannel: true,
        visibleTo: true,
        createdAt: true,
        metadata: true,
        nudgeCount: true,
        isSent: true,
        reactions_md: true,
        link_preview_md: true,
        childConversationId: true,
      },
    });
    if (!message) {
      logger.warn('slash_command_artifact_lifecycle_message_missing', logContext);
      return;
    }

    const artifact = parseSlashCommandArtifactMessage(message.content);
    if (!artifact) {
      logger.warn('slash_command_artifact_lifecycle_content_invalid', logContext);
      return;
    }
    if (
      status === 'completed' &&
      artifactRecord.callExternalId &&
      artifactRecord.callExternalId !== callExternalId
    ) {
      logger.info('slash_command_artifact_stale_lifecycle_ignored', {
        ...logContext,
        currentCallKey: getSlashCommandArtifactDiagnosticKey(artifactRecord.callExternalId),
        reason: 'completion_call_link_mismatch',
      });
      return;
    }

    const content = updateSlashCommandArtifactBannerLifecycle(
      message.content,
      status,
      callExternalId
    );
    if (!content) {
      logger.warn('slash_command_artifact_lifecycle_content_invalid', logContext);
      return;
    }

    const nextArtifactStatus =
      status === 'completed' ? MessageArtifactStatus.COMPLETED : MessageArtifactStatus.ACTIVE;
    const messageContentUpdated = content !== message.content;
    const artifactStatusUpdated = artifactRecord.status !== nextArtifactStatus;
    const artifactCallUpdated = artifactRecord.callExternalId !== callExternalId;
    if (messageContentUpdated) {
      await tx.message.update({
        where: { messageId: artifactMessageId },
        data: { content },
      });
    }
    if (artifactStatusUpdated || artifactCallUpdated) {
      await tx.messageArtifact.update({
        where: { messageId: artifactMessageId },
        data: { status: nextArtifactStatus, callExternalId },
      });
    }

    const initialSummary: InitialMessageSummary = {
      messageId: message.messageId,
      conversationId: message.conversationId,
      workspaceId: message.workspaceId,
      senderId: message.senderId,
      content,
      msgType: message.msgType as InitialMessageSummary['msgType'],
      hasAttachment: message.hasAttachment,
      edited: message.edited,
      isDeleted: message.isDeleted,
      showInChannel: message.showInChannel,
      visibleTo: message.visibleTo,
      createdAt: message.createdAt.getTime(),
      metadata: message.metadata ? JSON.stringify(message.metadata) : null,
      nudgeCount: message.nudgeCount,
      isSent: message.isSent,
      reactions_md: message.reactions_md,
      link_preview_md: message.link_preview_md,
      childConversationId: message.childConversationId,
    };
    const parentSummary: ParentMessageSummary = {
      messageId: message.messageId,
      conversationId: message.conversationId,
      senderId: message.senderId,
      content,
      msgType: message.msgType as ParentMessageSummary['msgType'],
      createdAt: message.createdAt.getTime(),
    };
    const initialMessageMd = serializeInitialMessageMd(initialSummary);
    const parentMessageMd = serializeParentMessageMd(parentSummary);

    const references = await tx.conversation.findMany({
      where: {
        OR: [{ initialMessageId: artifactMessageId }, { parentMessageId: artifactMessageId }],
      },
      select: {
        conversationId: true,
        initialMessageId: true,
        parentMessageId: true,
        initial_message_md: true,
        parent_message_md: true,
      },
    });

    let initialSnapshotUpdates = 0;
    let parentSnapshotUpdates = 0;
    for (const reference of references) {
      const data: Prisma.ConversationUpdateInput = {};
      if (
        reference.initialMessageId === artifactMessageId &&
        reference.initial_message_md !== initialMessageMd
      ) {
        data.initial_message_md = initialMessageMd;
        initialSnapshotUpdates += 1;
      }
      if (
        reference.parentMessageId === artifactMessageId &&
        reference.parent_message_md !== parentMessageMd
      ) {
        data.parent_message_md = parentMessageMd;
        parentSnapshotUpdates += 1;
      }
      if (Object.keys(data).length > 0) {
        await tx.conversation.update({
          where: { conversationId: reference.conversationId },
          data,
        });
      }
    }

    logger.info('slash_command_artifact_lifecycle_write_staged', {
      ...logContext,
      transactional: true,
      messageContentUpdated,
      artifactStatusUpdated,
      artifactCallUpdated,
      initialSnapshotUpdates,
      parentSnapshotUpdates,
    });
  } catch (error) {
    logger.error('slash_command_artifact_lifecycle_persist_failed', {
      ...logContext,
      errorType: error instanceof Error ? error.name : 'unknown',
    });
    throw error;
  }
};
