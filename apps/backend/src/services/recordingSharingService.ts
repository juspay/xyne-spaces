import { unlinkTicketTx } from '@/bypassAcl/transactions/recordingSharingService';
import { linkTicketTx } from '@/bypassAcl/transactions/recordingSharingService';
import { revokeTx } from '@/bypassAcl/transactions/recordingSharingService';
import { grantTx2 } from '@/bypassAcl/transactions/recordingSharingService';
import { grantTx } from '@/bypassAcl/transactions/recordingSharingService';
import { setVisibilityTx } from '@/bypassAcl/transactions/recordingSharingService';
import { Prisma, type EntityAccess } from '@prisma/client';
import {
  
  EntityUserAccess,
  
  
  
  ShareableEntityType,
  type GrantableEntityUserAccess,
  CallType,
  CallVisibility,
  
  
  
  
} from '@xyne/shared';
import { repositories } from '@/database/repositories';
import { isRecording } from '@/utils/callTypeUtils';
import { logger } from '@/utils/logger';
import {
  recordingSharingNotificationService,
  
} from '@/services/recordingSharingNotificationService';

export type RecordingShareTarget =
  | { type: 'user'; id: string }
  | { type: 'user_group'; id: string }
  | { type: 'channel'; id: string };

export type RecordingSharingCommand =
  | {
      action: 'grant';
      targets: RecordingShareTarget[];
      access?: GrantableEntityUserAccess;
      /** Optional share message. */
      messageContent?: string;
    }
  | { action: 'revoke'; targets: RecordingShareTarget[] }
  | { action: 'link_ticket'; ticketId: string }
  | { action: 'unlink_ticket' }
  | { action: 'set_visibility'; visibility: CallVisibility };

export interface RecordingSharingActor {
  userId: string;
  workspaceId: string;
}

export interface RecordingSharingResult {
  action: RecordingSharingCommand['action'];
  linkedTicketId?: string | null;
  linkedTicketMessageId?: string | null;
  shares?: Array<{ id: string; target: RecordingShareTarget; access: string }>;
  visibility?: CallVisibility;
}

export interface LoadedRecording {
  id: string;
  externalId: string;
  title: string | null;
  metadata: Prisma.JsonValue;
  callType: string;
  channelId: string | null;
  createdByUserId: string;
  startedAt: Date;
  endedAt: Date | null;
}

export interface AccessChange {
  share: EntityAccess;
  activated: boolean;
}

export type RecordingShareIntent = 'direct_share' | 'ticket_link';

export const RECORDING_SHARE_INTENT = {
  DIRECT_SHARE: 'direct_share',
  TICKET_LINK: 'ticket_link',
} as const satisfies Record<string, RecordingShareIntent>;

export const shareEntityTypeFor = (callType: string): string =>
  callType === CallType.HEADLESS ? ShareableEntityType.NOTE_TAKER : ShareableEntityType.CALL;

export class RecordingSharingError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'RecordingSharingError';
  }
}

export const asMetadata = (value: Prisma.JsonValue): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

// Posted conversation details stored on the access row.
export interface SharePost {
  channelId: string;
  conversationId: string;
  messageId: string;
}

const getShareIntent = (value: Prisma.JsonValue): RecordingShareIntent | null => {
  const intent = asMetadata(value)['intent'];
  return intent === RECORDING_SHARE_INTENT.DIRECT_SHARE ||
    intent === RECORDING_SHARE_INTENT.TICKET_LINK
    ? intent
    : null;
};

export const asSharePost = (value: Prisma.JsonValue): SharePost | null => {
  const record = asMetadata(value);
  return typeof record['channelId'] === 'string' &&
    typeof record['conversationId'] === 'string' &&
    typeof record['messageId'] === 'string'
    ? {
        channelId: record['channelId'],
        conversationId: record['conversationId'],
        messageId: record['messageId'],
      }
    : null;
};

export const targetWhere = (target: RecordingShareTarget): Prisma.EntityAccessWhereInput =>
  target.type === 'user'
    ? { userId: target.id }
    : target.type === 'user_group'
      ? { userGroupId: target.id }
      : { channelId: target.id };

export const targetData = (
  target: RecordingShareTarget,
): { userId: string } | { userGroupId: string } | { channelId: string } =>
  target.type === 'user'
    ? { userId: target.id }
    : target.type === 'user_group'
      ? { userGroupId: target.id }
      : { channelId: target.id };

export class RecordingSharingService {
  async execute(
    callId: string,
    actor: RecordingSharingActor,
    command: RecordingSharingCommand,
  ): Promise<RecordingSharingResult> {
    switch (command.action) {
      case 'grant':
        return this.grant(
          callId,
          actor,
          command.targets,
          command.access ?? EntityUserAccess.VIEW,
          command.messageContent,
        );
      case 'revoke':
        return this.revoke(callId, actor, command.targets);
      case 'link_ticket':
        return this.linkTicket(callId, actor, command.ticketId);
      case 'unlink_ticket':
        return this.unlinkTicket(callId, actor);
      case 'set_visibility':
        return this.setVisibility(callId, actor, command.visibility);
    }
  }

  private async setVisibility(
    callId: string,
    actor: RecordingSharingActor,
    visibility: CallVisibility,
  ): Promise<RecordingSharingResult> {
    await setVisibilityTx(this, callId, actor, visibility);
    return { action: 'set_visibility', visibility };
  }

  private async grant(
    callId: string,
    actor: RecordingSharingActor,
    targets: RecordingShareTarget[],
    access: GrantableEntityUserAccess,
    messageContent?: string,
  ): Promise<RecordingSharingResult> {
    await grantTx(this, callId, actor, targets);

    // Resolve a separate 1:1 DM for each user.
    const dmChannelIds = new Map<string, string>();
    const userIds = [
      ...new Set(targets.flatMap(target => (target.type === 'user' ? [target.id] : []))),
    ];
    for (const userId of userIds) {
      const channelId = await repositories.channels.findOrCreateDMChannel(
        actor.userId,
        [userId],
        repositories.channelParticipants,
        actor.workspaceId,
      );
      dmChannelIds.set(userId, channelId);
    }

    const { shares, activities } = await grantTx2(this, callId, actor, targets, access, dmChannelIds, messageContent);

    await recordingSharingNotificationService.publish(actor.userId, activities);
    return { action: 'grant', shares };
  }

  private async revoke(
    callId: string,
    actor: RecordingSharingActor,
    targets: RecordingShareTarget[],
  ): Promise<RecordingSharingResult> {
    logger.info('[RecordingSharingService] Revoke access request received', {
      callId,
      actorUserId: actor.userId,
      workspaceId: actor.workspaceId,
      targets,
    });

    const { shares, activities } = await revokeTx(this, callId, actor, targets);

    await recordingSharingNotificationService.publish(actor.userId, activities);
    return { action: 'revoke', shares };
  }

  private async linkTicket(
    callId: string,
    actor: RecordingSharingActor,
    ticketId: string,
  ): Promise<RecordingSharingResult> {
    const transactionResult = await linkTicketTx(this, callId, actor, ticketId);

    return {
      action: 'link_ticket',
      linkedTicketId: transactionResult.linkedTicketId,
      linkedTicketMessageId: transactionResult.linkedTicketMessageId,
    };
  }

  private async unlinkTicket(
    callId: string,
    actor: RecordingSharingActor,
  ): Promise<RecordingSharingResult> {
    logger.info('[RecordingSharingService] Unlink ticket request received', {
      callId,
      actorUserId: actor.userId,
      workspaceId: actor.workspaceId,
    });

    await unlinkTicketTx(this, callId, actor);

    return {
      action: 'unlink_ticket',
      linkedTicketId: null,
      linkedTicketMessageId: null,
    };
  }

  /**
   * Link visibility and ticket linking read and write recording-shaped state
   * (Call.visibility, Call.metadata canvas pointers) that a regular call does not
   * have, so they stay recordings-only rather than silently no-op'ing.
   */
  assertRecordingOnly(recording: LoadedRecording, feature: string): void {
    if (!isRecording(recording)) {
      throw new RecordingSharingError(`${feature} is only available for recordings`, 400);
    }
  }

  /**
   * Mirrors `entityAccessService.hasActiveShare`, but reads through the caller's
   * transaction so the permission check sees the same snapshot as the write it
   * guards.
   */
  async hasActiveShare(
    tx: Prisma.TransactionClient,
    call: Pick<LoadedRecording, 'id' | 'callType'>,
    actor: RecordingSharingActor,
  ): Promise<boolean> {
    const groupMappings = await tx.userGroupMapping.findMany({
      where: { userId: actor.userId },
      select: { userGroupId: true },
    });
    const channelParticipations = await tx.channelParticipant.findMany({
      where: { userId: actor.userId },
      select: { channelId: true },
    });
    const userGroupIds = groupMappings.map(mapping => mapping.userGroupId);
    const channelIds = channelParticipations.map(participation => participation.channelId);

    const share = await tx.entityAccess.findFirst({
      where: {
        workspaceId: actor.workspaceId,
        shareableEntityType: shareEntityTypeFor(call.callType),
        entityId: call.id,
        entityUserAccess: { not: EntityUserAccess.REVOKED },
        OR: [
          { userId: actor.userId },
          ...(userGroupIds.length ? [{ userGroupId: { in: userGroupIds } }] : []),
          ...(channelIds.length ? [{ channelId: { in: channelIds } }] : []),
        ],
      },
      select: { id: true },
    });
    return share !== null;
  }

  async validateTargets(
    tx: Prisma.TransactionClient,
    recording: LoadedRecording,
    workspaceId: string,
    targets: RecordingShareTarget[],
  ): Promise<void> {
    for (const target of targets) {
      if (target.type === 'user') {
        if (target.id === recording.createdByUserId) {
          throw new RecordingSharingError(
            `The ${isRecording(recording) ? 'recording' : 'call'} owner already has access`,
            400,
          );
        }
        const user = await tx.user.findFirst({
          where: { id: target.id, workspaceId, leftAt: null },
          select: { id: true },
        });
        if (!user) throw new RecordingSharingError('User not found in this workspace', 400);
      } else if (target.type === 'user_group') {
        const group = await tx.userGroup.findFirst({
          where: { id: target.id, workspaceId },
          select: { id: true },
        });
        if (!group) throw new RecordingSharingError('User group not found in this workspace', 400);
      } else {
        const channel = await tx.channel.findFirst({
          where: { id: target.id, workspaceId },
          select: { id: true },
        });
        if (!channel) throw new RecordingSharingError('Channel not found in this workspace', 400);
      }
    }
  }

  async findShare(
    tx: Prisma.TransactionClient,
    call: Pick<LoadedRecording, 'id' | 'callType'>,
    workspaceId: string,
    target: RecordingShareTarget,
    intent: RecordingShareIntent,
  ): Promise<EntityAccess | null> {
    const shares = await tx.entityAccess.findMany({
      where: {
        workspaceId,
        shareableEntityType: shareEntityTypeFor(call.callType),
        entityId: call.id,
        ...targetWhere(target),
      },
    });
    return shares.find(share => getShareIntent(share.metadata) === intent) ?? null;
  }

  getShareCanvasIds(recording: LoadedRecording): string[] {
    const metadata = asMetadata(recording.metadata);
    const detailedSummaryCanvasId = metadata['detailedSummaryCanvasId'];
    const notesCanvasId = metadata['notesCanvasId'];
    const canvasIds: string[] = [];

    if (typeof detailedSummaryCanvasId === 'string' && detailedSummaryCanvasId.length > 0) {
      canvasIds.push(detailedSummaryCanvasId);
    }
    if (typeof notesCanvasId === 'string' && notesCanvasId.length > 0) {
      canvasIds.push(notesCanvasId);
    }

    return [...new Set(canvasIds)];
  }

}

export const recordingSharingService = new RecordingSharingService();
