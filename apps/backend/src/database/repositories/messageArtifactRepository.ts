import type { Prisma } from '@prisma/client';
import {
  getSlashCommandArtifactDiagnosticKey,
  getSlashCommandArtifactProjection,
  MessageArtifactStatus,
  withSlashCommandArtifactEndedCall,
  type SlashCommandArtifactEndedCall,
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
  messageId: string,
  expectedChannelId?: string
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

  if (expectedChannelId && message.conversation.channelId !== expectedChannelId) {
    logger.warn('slash_command_artifact_channel_mismatch', {
      artifactKey: getSlashCommandArtifactDiagnosticKey(messageId),
      expectedChannelKey: getSlashCommandArtifactDiagnosticKey(expectedChannelId),
      actualChannelKey: getSlashCommandArtifactDiagnosticKey(message.conversation.channelId),
    });
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

  const now = new Date();
  await tx.messageArtifact.upsert({
    where: { messageId },
    create: { ...projected, status: MessageArtifactStatus.ACTIVE, updatedAt: now },
    update: { ...projected, updatedAt: now },
  });
};

/**
 * Move an artifact's lifecycle forward and record the call that owns it.
 *
 * `channelId` is the channel of the call driving the transition, and every
 * write is scoped to it. The artifact message id originates in a client request
 * body, so this scoping — rather than a pre-flight lookup in the controller —
 * is what stops a forged id from touching an artifact in a channel the caller
 * cannot reach: a mismatch simply matches zero rows.
 *
 * The update is a compare-and-set rather than a read-modify-write: a completion
 * only lands while the artifact is still linked to the same call, so a late
 * webhook from a previous call cannot close the side effect of a newer one.
 */
export const setSlashCommandArtifactLifecycle = async (
  tx: Prisma.TransactionClient,
  params: {
    messageId: string;
    channelId: string;
    status: MessageArtifactLifecycleStatus;
    callExternalId: string;
    /**
     * Summary of the call that just ended. Baked into the message's FlowJSON so
     * the card can render the ended state after the call has left the client's
     * active-call subscription.
     */
    endedCall?: SlashCommandArtifactEndedCall;
  }
): Promise<void> => {
  const { messageId, channelId, status, callExternalId, endedCall } = params;
  const logContext = {
    artifactKey: getSlashCommandArtifactDiagnosticKey(messageId),
    callKey: getSlashCommandArtifactDiagnosticKey(callExternalId),
    channelKey: getSlashCommandArtifactDiagnosticKey(channelId),
    lifecycleStatus: status,
  };

  // The message side-effect worker normally creates this row first, but call
  // creation can outrun it. Bootstrapping here keeps the lifecycle event rather
  // than dropping it — scoped to the call's channel so it cannot be used to
  // materialize a row for a message the caller has no access to.
  const existing = await tx.messageArtifact.findUnique({
    where: { messageId },
    select: { id: true },
  });
  if (!existing) {
    await syncMessageArtifact(tx, messageId, channelId);
  }

  const { count } = await tx.messageArtifact.updateMany({
    where: {
      messageId,
      channelId,
      // Completion is only valid for the call the artifact is currently linked
      // to. Activation always wins — it is the newest call by definition.
      ...(status === MessageArtifactStatus.COMPLETED ? { callExternalId } : {}),
    },
    data: { status, callExternalId, updatedAt: new Date() },
  });

  if (count === 0) {
    logger.info('slash_command_artifact_lifecycle_skipped', {
      ...logContext,
      reason: existing ? 'call_link_or_channel_mismatch' : 'artifact_row_unavailable',
    });
    return;
  }

  // Only after the compare-and-set matched — a late webhook from a superseded
  // call must not overwrite the newer call's summary. This message write also
  // re-syncs conversation.initial_message_md / parent_message_md via the Prisma
  // message-metadata middleware, so no snapshot bookkeeping is needed here.
  if (endedCall) {
    const message = await tx.message.findUnique({
      where: { messageId },
      select: { content: true },
    });
    const content = message?.content
      ? withSlashCommandArtifactEndedCall(message.content, endedCall)
      : null;
    if (content && content !== message?.content) {
      await tx.message.update({ where: { messageId }, data: { content } });
    }
  }

  logger.info('slash_command_artifact_lifecycle_updated', {
    ...logContext,
    endedCallRecorded: !!endedCall,
  });
};
