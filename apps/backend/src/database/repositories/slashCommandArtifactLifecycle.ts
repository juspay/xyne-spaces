import type { Prisma } from '@prisma/client';
import {
  getSlashCommandArtifactDiagnosticKey,
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
 * Persist side-effect lifecycle in the artifact's FlowJSON and every denormalized
 * message snapshot in the same transaction. Channel lists render
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
    // Call creation and old-call completion webhooks can overlap. Serialize all
    // lifecycle transitions for this artifact so the last transition is based
    // on the latest persisted call link rather than a stale pre-lock read.
    const [lockedMessage] = await tx.$queryRaw<Array<{ messageId: string }>>`
      SELECT "messageId"
      FROM "messages"
      WHERE "messageId" = ${artifactMessageId}
      FOR UPDATE
    `;
    if (!lockedMessage) {
      logger.warn('slash_command_artifact_lifecycle_message_missing', logContext);
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
    const linkedBannerCallIds = artifact.props.sideEffects.flatMap((sideEffect) =>
      sideEffect.type === 'banner' && sideEffect.callExternalId ? [sideEffect.callExternalId] : []
    );
    if (
      status === 'completed' &&
      linkedBannerCallIds.length > 0 &&
      !linkedBannerCallIds.includes(callExternalId)
    ) {
      logger.info('slash_command_artifact_stale_lifecycle_ignored', {
        ...logContext,
        currentCallKey: getSlashCommandArtifactDiagnosticKey(linkedBannerCallIds[0]),
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

    const messageContentUpdated = content !== message.content;
    if (messageContentUpdated) {
      await tx.message.update({
        where: { messageId: artifactMessageId },
        data: { content },
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
