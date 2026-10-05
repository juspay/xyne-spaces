
import { setVisibilityTx, validateGrantTargetsTx, grantTx2, revokeTx, linkTicketTx, unlinkTicketTx, setAccess } from '@/bypassAcl/transactions/recordingSharingService';
import { Prisma, type EntityAccess } from '@prisma/client';
import {
  
  EntityUserAccess,
  
  
  
  type GrantableEntityUserAccess,
  CallVisibility,
  CanvasRole,
  
  
  
} from '@xyne/shared';
import { isRecording, shareEntityTypeFor } from '@/utils/callTypeUtils';
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
      /**
       * Internal only — not in the controller's schema. Pass false to grant
       * access without creating the share post (defaults to true).
       */
      post?: boolean;
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
  /** The share went from absent or revoked to active. */
  activated: boolean;
  /** An already-active share moved between VIEW and EDIT. */
  levelChanged: boolean;
}

export type RecordingShareIntent = 'direct_share' | 'ticket_link';

export const RECORDING_SHARE_INTENT = {
  DIRECT_SHARE: 'direct_share',
  TICKET_LINK: 'ticket_link',
} as const satisfies Record<string, RecordingShareIntent>;

/**
 * The role a recording grant confers on the recording's summary/notes canvases.
 * Editing the summary is the substance of recording edit access, so the two
 * stay in step rather than being managed separately.
 */
export const canvasRoleFor = (access: GrantableEntityUserAccess): CanvasRole =>
  access === EntityUserAccess.EDIT ? CanvasRole.EDITOR : CanvasRole.VIEWER;

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
          command.post ?? true,
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

  /**
   * After an ownership transfer, keep the previous owner's view access as a plain
   * direct share (no DM, no notification) that the new owner can revoke. The caller
   * has already checked the call is a recording that actually changed owner.
   */
  async grantPreviousOwnerView(
    tx: Prisma.TransactionClient,
    callId: string,
    previousOwnerUserId: string,
  ): Promise<void> {
    const recording = await tx.call.findUnique({
      where: { id: callId },
      select: {
        id: true,
        externalId: true,
        title: true,
        metadata: true,
        callType: true,
        channelId: true,
        workspaceId: true,
        createdByUserId: true,
        startedAt: true,
        endedAt: true,
      },
    });
    if (!recording?.workspaceId) return;

    await setAccess(
      this,
      tx,
      recording,
      recording.workspaceId,
      { type: 'user', id: previousOwnerUserId },
      EntityUserAccess.VIEW,
      RECORDING_SHARE_INTENT.DIRECT_SHARE,
    );
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
    post = true,
  ): Promise<RecordingSharingResult> {
    await validateGrantTargetsTx(this, callId, actor, targets);

    const dmChannelIds = new Map<string, string>();
    const { shares, activities } = await grantTx2(this, callId, actor, targets, access, dmChannelIds, messageContent, post);

    await recordingSharingNotificationService.publish(actor.userId, activities);
    return { action: 'grant', shares };
  }

  private async revoke(
    callId: string,
    actor: RecordingSharingActor,
    targets: RecordingShareTarget[],
  ): Promise<RecordingSharingResult> {
    // Leaving is self-service: anyone the recording reaches may drop their own access.
    const isSelfRevoke =
      targets.length > 0 &&
      targets.every(target => target.type === 'user' && target.id === actor.userId);

    logger.info('[RecordingSharingService] Revoke access request received', {
      callId,
      actorUserId: actor.userId,
      workspaceId: actor.workspaceId,
      targets,
      isSelfRevoke,
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
