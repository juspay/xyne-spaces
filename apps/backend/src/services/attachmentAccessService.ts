import { MessageAttachment } from '@prisma/client';
import { AttachmentEntityType, ChannelVisibility } from '@xyne/shared';
import { db } from '../database/client';
import { repositories } from '../database/repositories';
import { canvasAuthService } from './canvasAuthService';
import { callShareService } from './callShareService';
import { logger } from '../utils/logger';

export type AttachmentAccessResult =
  | { ok: true }
  | { ok: false; status: number; body: Record<string, string> };

/**
 * Resolve the ticket that owns an IMPACT or FORM_ENTITY_VALUE attachment so its
 * download can be gated by the ticket's channel access. Returns null when the
 * entity is not ticket-scoped (e.g. a non-TICKET form entity), in which case the
 * caller keeps the workspace-bounded default.
 */
async function resolveTicketIdForAttachmentEntity(
  entityType: AttachmentEntityType,
  entityId: string,
): Promise<string | null> {
  if (entityType === AttachmentEntityType.IMPACT) {
    const impact = await db.impact.findUnique({
      where: { id: entityId },
      select: { ticketId: true },
    });
    return impact?.ticketId ?? null;
  }
  // FORM_ENTITY_VALUE — only ticket-scoped values map to a channel.
  const formValue = await db.formEntityValues.findUnique({
    where: { id: entityId },
    select: { entityId: true, entityType: true },
  });
  if (formValue && formValue.entityType === 'TICKET') {
    return formValue.entityId;
  }
  return null;
}

/**
 * Authorization for attachment reads (metadata / download / thumbnail), shared by
 * every route that serves an attachment by id so they all enforce the same checks.
 *
 * Layered and safe for every AttachmentEntityType:
 *  1. Tenant isolation — the attachment must belong to the caller's workspace; an
 *     absent workspace context is rejected, not allowed through.
 *  2. DRAFT / DELAYED_MESSAGE — only the creator may read it.
 *  3. CANVAS — gated by canvas view access.
 *  4. SDLC_HUB — gated by hub-channel visibility / participation.
 *  5. RECORDING — gated by the call's recording-view access.
 *  6. Conversation-backed (chat/DM/transcript) attachments — the caller must be a
 *     participant of the owning channel.
 *  7. IMPACT / FORM_ENTITY_VALUE — resolve the owning ticket's channel and require
 *     the same access the ticket needs (public: any workspace member; private:
 *     participants only).
 * Non-chat types without a conversation and not ticket-scoped are bounded by the
 * workspace check only, preserving existing in-workspace access.
 */
export async function assertAttachmentAccess(
  attachment: MessageAttachment,
  userId: string,
  workspaceId?: string,
): Promise<AttachmentAccessResult> {
  // 1) Workspace isolation — never serve another workspace's file. Require a
  //    workspace context; an absent one is rejected rather than allowed through.
  if (!workspaceId || attachment.workspaceId !== workspaceId) {
    logger.warn('Cross-workspace attachment access blocked', {
      userId,
      workspaceId: workspaceId ?? 'none',
      attachmentId: attachment.id,
      attachmentWorkspaceId: attachment.workspaceId,
    });
    return { ok: false, status: 404, body: { error: 'Attachment not found' } };
  }

  // 2) Draft / scheduled message attachments — creator only.
  if (
    attachment.entityType === AttachmentEntityType.DRAFT ||
    attachment.entityType === AttachmentEntityType.DELAYED_MESSAGE
  ) {
    if (attachment.createdBy !== userId) {
      logger.warn('Unauthorized draft attachment access', {
        userId,
        attachmentId: attachment.id,
        creator: attachment.createdBy,
      });
      return {
        ok: false,
        status: 403,
        body: { error: 'Forbidden', message: 'You do not have permission to access this attachment' },
      };
    }
    return { ok: true };
  }

  // 3) Canvas attachments carry a synthetic conversationId and are not backed by a
  //    real conversation row. Authorize via canvas view access.
  if (attachment.entityType === AttachmentEntityType.CANVAS) {
    try {
      await canvasAuthService.requireViewAccess(attachment.entityId, userId);
      return { ok: true };
    } catch (error) {
      logger.warn('Unauthorized canvas attachment access', {
        userId,
        attachmentId: attachment.id,
        canvasId: attachment.entityId,
        error: error instanceof Error ? error.message : 'denied',
      });
      return {
        ok: false,
        status: 403,
        body: { error: 'Forbidden', message: 'You do not have permission to access this attachment' },
      };
    }
  }

  // 4) SDLC hub files have no conversation to authorize through: their entityId is
  //    the hub channel. Seeing the hub is what earns seeing the file.
  if (attachment.entityType === AttachmentEntityType.SDLC_HUB) {
    const channel = await db.channel.findUnique({
      where: { id: attachment.entityId },
      select: { visibility: true, workspaceId: true },
    });
    if (!channel || channel.workspaceId !== workspaceId) {
      return { ok: false, status: 404, body: { error: 'Attachment not found' } };
    }
    if (channel.visibility !== ChannelVisibility.PUBLIC) {
      const isParticipant = await repositories.channelParticipants.isParticipant(
        attachment.entityId,
        userId,
      );
      if (!isParticipant) {
        logger.warn('Unauthorized SDLC hub attachment access', {
          userId,
          attachmentId: attachment.id,
          hubId: attachment.entityId,
        });
        return {
          ok: false,
          status: 403,
          body: { error: 'Forbidden', message: 'You do not have permission to access this attachment' },
        };
      }
    }
    return { ok: true };
  }

  // 5) Note-taker recordings — same rule as the recording download endpoints.
  if (attachment.entityType === AttachmentEntityType.RECORDING) {
    const recording = await repositories.callRecordings.findById(attachment.entityId);
    const call = recording ? await repositories.calls.findById(recording.callId) : null;
    if (!call || call.workspaceId !== workspaceId) {
      return { ok: false, status: 404, body: { error: 'Attachment not found' } };
    }
    if (!(await callShareService.canViewRecordings(call, userId))) {
      logger.warn('Unauthorized recording attachment access', {
        userId,
        attachmentId: attachment.id,
        callId: call.id,
      });
      return {
        ok: false,
        status: 403,
        body: { error: 'Forbidden', message: 'You do not have permission to access this attachment' },
      };
    }
    return { ok: true };
  }

  // 6) Conversation-backed (chat/DM/transcript) attachments — must participate.
  if (attachment.conversationId) {
    const conversation = await repositories.conversations.findById(attachment.conversationId);
    if (!conversation) {
      logger.warn('Attachment access denied: conversation not found', {
        conversationId: attachment.conversationId,
        attachmentId: attachment.id,
        userId,
      });
      return { ok: false, status: 404, body: { error: 'Attachment not found' } };
    }

    const isParticipant = await repositories.channelParticipants.isParticipant(
      conversation.channelId,
      userId,
    );
    if (!isParticipant) {
      logger.warn('Unauthorized attachment access', {
        userId,
        attachmentId: attachment.id,
        channelId: conversation.channelId,
      });
      return {
        ok: false,
        status: 403,
        body: { error: 'Forbidden', message: 'You do not have permission to access this attachment' },
      };
    }
  }

  // 7) Impact / stage-form DOC attachments (conversationId is null) — resolve the
  //    owning ticket's channel and require the same access the ticket needs.
  if (
    attachment.entityType === AttachmentEntityType.IMPACT ||
    attachment.entityType === AttachmentEntityType.FORM_ENTITY_VALUE
  ) {
    const ticketId = await resolveTicketIdForAttachmentEntity(
      attachment.entityType,
      attachment.entityId,
    );
    // Not ticket-scoped (e.g. a USER-scoped form value) — no channel to gate on;
    // keep the workspace-bounded behavior rather than over-block a legitimate read.
    if (ticketId) {
      const ticket = await db.ticket.findUnique({
        where: { id: ticketId },
        select: { channelId: true, workspaceId: true },
      });
      if (!ticket || ticket.workspaceId !== workspaceId) {
        return { ok: false, status: 404, body: { error: 'Attachment not found' } };
      }
      const channel = await db.channel.findUnique({
        where: { id: ticket.channelId },
        select: { visibility: true },
      });
      if (!channel) {
        return { ok: false, status: 404, body: { error: 'Attachment not found' } };
      }
      if (channel.visibility !== ChannelVisibility.PUBLIC) {
        const isParticipant = await repositories.channelParticipants.isParticipant(
          ticket.channelId,
          userId,
        );
        if (!isParticipant) {
          logger.warn('Unauthorized ticket-scoped attachment access', {
            entityType: attachment.entityType,
            userId,
            attachmentId: attachment.id,
            channelId: ticket.channelId,
          });
          return {
            ok: false,
            status: 403,
            body: { error: 'Forbidden', message: 'You do not have permission to access this attachment' },
          };
        }
      }
    }
  }

  return { ok: true };
}
