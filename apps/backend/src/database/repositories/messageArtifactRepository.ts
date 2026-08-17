import type { Prisma } from '@prisma/client';
import {
  getSlashCommandArtifactDiagnosticKey,
  getSlashCommandArtifactProjection,
  MessageArtifactStatus,
} from '@xyne/shared';
import { logger } from '@/utils/logger';

export type MessageArtifactLifecycleStatus =
  | MessageArtifactStatus.ACTIVE
  | MessageArtifactStatus.COMPLETED;

/**
 * Rebuild the `message_artifacts` row from its source message, or delete it if
 * the message no longer qualifies (deleted, no longer an artifact, or scoped to
 * a single viewer). This is the only writer of the projected columns, so the
 * insert, edit, delete, and call-creation paths all stay consistent by calling
 * it rather than assembling their own projection.
 *
 * Lifecycle columns (`status`, `callExternalId`) are intentionally not touched
 * on update: they are owned by setSlashCommandArtifactLifecycle, and message
 * content never carries them.
 */
export const syncMessageArtifact = async (
  tx: Prisma.TransactionClient,
  messageId: string
): Promise<void> => {
  const message = await tx.message.findUnique({
    where: { messageId },
    select: {
      messageId: true,
      workspaceId: true,
      conversationId: true,
      content: true,
      createdAt: true,
      isDeleted: true,
      visibleTo: true,
      conversation: {
        select: { channelId: true, initialMessageId: true },
      },
    },
  });

  const projection = getSlashCommandArtifactProjection(message?.content);

  // `visibleTo` messages are scoped to one viewer, so they never earn a
  // channel-wide artifact. Keeping them out is what lets the artifact ACL skip
  // the visibility check the messages ACL applies.
  if (
    !message ||
    message.isDeleted ||
    message.visibleTo ||
    !projection ||
    !message.conversation?.channelId
  ) {
    await tx.messageArtifact.deleteMany({ where: { messageId } });
    return;
  }

  const projected = {
    workspaceId: message.workspaceId,
    messageId: message.messageId,
    channelId: message.conversation.channelId,
    conversationId: message.conversationId,
    isInitialMessage: message.conversation.initialMessageId === message.messageId,
    messagePreview: projection.messagePreview,
    messageCreatedAt: message.createdAt,
    command: projection.command,
  };

  await tx.messageArtifact.upsert({
    where: { messageId },
    create: { ...projected, status: MessageArtifactStatus.ACTIVE },
    update: projected,
  });
};

/**
 * Move an artifact's lifecycle forward and record the entity that owns it.
 *
 * The update is a compare-and-set rather than a read-modify-write: a completion
 * only lands while the artifact is still linked to the same call, so a late
 * webhook from a previous call cannot close the side effect of a newer one.
 */
export const setSlashCommandArtifactLifecycle = async (
  tx: Prisma.TransactionClient,
  params: {
    messageId: string;
    status: MessageArtifactLifecycleStatus;
    callExternalId: string;
  }
): Promise<void> => {
  const { messageId, status, callExternalId } = params;
  const logContext = {
    artifactKey: getSlashCommandArtifactDiagnosticKey(messageId),
    callKey: getSlashCommandArtifactDiagnosticKey(callExternalId),
    lifecycleStatus: status,
  };

  // The message side-effect worker normally creates this row first, but call
  // creation can outrun it. Bootstrapping here keeps the lifecycle event rather
  // than dropping it.
  const existing = await tx.messageArtifact.findUnique({
    where: { messageId },
    select: { id: true },
  });
  if (!existing) {
    await syncMessageArtifact(tx, messageId);
  }

  const { count } = await tx.messageArtifact.updateMany({
    where: {
      messageId,
      // Completion is only valid for the call the artifact is currently linked
      // to. Activation always wins — it is the newest call by definition.
      ...(status === MessageArtifactStatus.COMPLETED ? { callExternalId } : {}),
    },
    data: { status, callExternalId },
  });

  if (count === 0) {
    logger.info('slash_command_artifact_lifecycle_skipped', {
      ...logContext,
      reason: existing ? 'call_link_mismatch_or_missing' : 'artifact_row_unavailable',
    });
    return;
  }

  logger.info('slash_command_artifact_lifecycle_updated', logContext);
};
