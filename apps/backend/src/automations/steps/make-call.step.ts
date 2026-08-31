import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { BaseActionStep } from './base-step';
import { StepCategory } from '../types/categories';
import { variableRef } from '../engine/variable-ref';
import type { AutomationContext } from '../types/context';
import { repositories } from '@/database/repositories';
import { livekitService } from '@/services/liveKitService';
import { callSideEffectService } from '@/services/callSideEffectService';
import { CallType, CallOrigin, CallStatus, ProjectType, UserType } from '@xyne/shared';
import { logger } from '@/utils/logger';
import { db } from '@/database/client';
import { getAutomationsBotUserId } from './automations-bot';
import { buildCallInviteUrl } from '@/utils/urlUtils';

const MAX_CALL_INVITEES = 499;

const MakeCallConfigSchema = z
  .object({
    channelId: variableRef(z.string().min(1)).optional(),
    invitedUserIds: z.array(variableRef(z.string().min(1))).optional(),
    userGroupIds: z.array(variableRef(z.string().min(1))).optional(),
    callType: z.nativeEnum(CallType).default(CallType.AUDIO),
    maxParticipants: z.number().int().min(2).max(500).optional(),
    emptyTimeout: z.number().int().min(10).optional(),
  })
  .refine(
    (data) =>
      data.channelId !== undefined ||
      (data.invitedUserIds !== undefined && data.invitedUserIds.length > 0) ||
      (data.userGroupIds !== undefined && data.userGroupIds.length > 0),
    {
      message: 'At least one of channel, invited users, or user groups must be specified',
      path: ['channelId'],
    }
  );

const MakeCallOutputSchema = z.object({
  callId: z.string(),
  roomLink: z.string(),
  channelId: z.string(),
  conversationId: z.string(),
});

interface MakeCallOutput extends Record<string, unknown> {
  callId: string;
  roomLink: string;
  channelId: string;
  conversationId: string;
}
/**
 * Make a call automation step.
 *
 * The initiator is always the workspace's Automations bot so the call is
 * clearly machine-initiated and cannot impersonate an arbitrary user.
 */
export class MakeCallStep extends BaseActionStep<typeof MakeCallConfigSchema, MakeCallOutput> {
  readonly type = 'MAKE_CALL';
  readonly configSchema = MakeCallConfigSchema;
  readonly outputSchema = MakeCallOutputSchema;
  readonly name = 'Make a call';
  readonly description = 'Initiates a call and invites specified users to join.';
  readonly category = StepCategory.MESSAGING;
  readonly icon = 'Phone';

  async execute(
    config: z.infer<typeof MakeCallConfigSchema>,
    context: AutomationContext
  ): Promise<MakeCallOutput> {
    const callType = config.callType ?? CallType.AUDIO;
    const requestedChannelId = config.channelId;
    const invitedUserIds = config.invitedUserIds ?? [];
    const userGroupIds = config.userGroupIds ?? [];

    const initiatorUserId = await getAutomationsBotUserId(context.automation.workspaceId);

    const workspaceId = context.automation.workspaceId;
    const automationId = context.automation.id;

    // Validate that an explicitly targeted channel belongs to this workspace.
    // Reject cross-workspace channel IDs rather than silently inviting the wrong
    // audience.
    if (requestedChannelId) {
      const channelInWorkspace = await db.channel.findFirst({
        where: { id: requestedChannelId, workspaceId },
        select: { id: true },
      });
      if (!channelInWorkspace) {
        throw new Error(
          `[MakeCallStep] Channel ${requestedChannelId} not found in workspace ${workspaceId}`
        );
      }
    }

    const invitedUserIdSet = new Set<string>();
    let inviteeCapReached = false;
    const addInvitees = (userIds: string[]) => {
      for (const userId of userIds) {
        if (!userId || invitedUserIdSet.has(userId)) continue;
        if (invitedUserIdSet.size >= MAX_CALL_INVITEES) {
          inviteeCapReached = true;
          continue;
        }
        invitedUserIdSet.add(userId);
      }
    };

    addInvitees(invitedUserIds);

    // Resolve user groups to member IDs without loading every mapping for very
    // large groups. Groups outside the automation workspace are ignored: a stale
    // or crafted config must not leak members from another workspace.
    if (userGroupIds.length > 0) {
      for (const groupId of userGroupIds) {
        if (invitedUserIdSet.size >= MAX_CALL_INVITEES) {
          inviteeCapReached = true;
          break;
        }

        const group = await db.userGroup.findUnique({
          where: { id: groupId },
          select: { id: true, workspaceId: true },
        });
        if (!group || group.workspaceId !== workspaceId) {
          logger.warn('[MakeCallStep] skipping_user_group_outside_workspace', {
            groupId: group?.id,
            groupWorkspaceId: group?.workspaceId,
            workspaceId,
            automationId,
          });
          continue;
        }

        const remainingSlots = MAX_CALL_INVITEES - invitedUserIdSet.size;
        const mappings = await db.userGroupMapping.findMany({
          where: { userGroupId: group.id },
          select: { userId: true },
          orderBy: { id: 'asc' },
          take: remainingSlots + 1,
        });
        if (mappings.length > remainingSlots) inviteeCapReached = true;
        addInvitees(mappings.slice(0, remainingSlots).map((m) => m.userId));
      }
    }

    // If an explicit channel is targeted, its members are also invited so the
    // call is visible inside the channel. Pull only up to the remaining cap.
    if (requestedChannelId && invitedUserIdSet.size < MAX_CALL_INVITEES) {
      const remainingSlots = MAX_CALL_INVITEES - invitedUserIdSet.size;
      const channelMembers = await db.channelParticipant.findMany({
        where: { channelId: requestedChannelId },
        select: { userId: true },
        orderBy: { id: 'asc' },
        take: remainingSlots + 1,
      });
      if (channelMembers.length > remainingSlots) inviteeCapReached = true;
      addInvitees(channelMembers.slice(0, remainingSlots).map((m) => m.userId));
    } else if (requestedChannelId) {
      inviteeCapReached = true;
    }

    let allInvitedUserIds = Array.from(invitedUserIdSet);
    if (inviteeCapReached) {
      logger.warn('[MakeCallStep] capped_invitees', {
        workspaceId,
        automationId,
        cappedCount: allInvitedUserIds.length,
        maxInvitees: MAX_CALL_INVITEES,
      });
    }

    // Drop bot/app users and anyone outside the automation workspace in a single
    // batch lookup. This prevents stale/crafted configs from ringing machines or
    // leaking across workspace boundaries.
    if (allInvitedUserIds.length > 0) {
      const resolvedUsers = await db.user.findMany({
        where: { id: { in: allInvitedUserIds }, workspaceId },
        select: { id: true, userType: true },
      });
      const allowedUserIds = new Set(
        resolvedUsers
          .filter((u) => u.userType !== UserType.BOT && u.userType !== UserType.APP)
          .map((u) => u.id)
      );
      const droppedCount = allInvitedUserIds.length - allowedUserIds.size;
      if (droppedCount > 0) {
        logger.warn('[MakeCallStep] dropped_invitees_not_in_workspace_or_bots', {
          workspaceId,
          automationId,
          droppedCount,
        });
      }
      allInvitedUserIds = allInvitedUserIds.filter((id) => allowedUserIds.has(id));
    }

    if (allInvitedUserIds.length === 0) {
      throw new Error(
        `[MakeCallStep] No human invitees for call: workspaceId=${workspaceId}, automationId=${automationId}`
      );
    }

    // Determine channel: use the provided channel, otherwise create a DM from the
    // resolved invitees (which requires at least one human participant).
    let channelId: string;
    if (requestedChannelId) {
      channelId = requestedChannelId;
    } else {
      // Validate DM capability before attempting creation so failures are
      // surfaced with actionable context.
      const dmProject = await db.project.findFirst({
        where: { workspaceId, code: 'DM', type: ProjectType.DM },
        select: { id: true },
      });
      if (!dmProject) {
        throw new Error(
          `[MakeCallStep] DM project not found for workspace: workspaceId=${workspaceId}, automationId=${automationId}`
        );
      }

      channelId = await repositories.channels.findOrCreateDMChannel(
        initiatorUserId,
        allInvitedUserIds,
        repositories.channelParticipants,
        workspaceId
      );
    }

    // uuidv4() is synchronous and CPU-local; sequential generation is
    // intentional and avoids pretending there is useful async work to parallelize.
    const externalId = uuidv4();
    const callId = uuidv4();
    const conversationId = uuidv4();
    const messageId = uuidv4();
    const roomLink = buildCallInviteUrl(externalId);
    const now = new Date();

    // Create the LiveKit room BEFORE committing the DB transaction. This removes
    // the race where the DB row is ACTIVE but the room does not exist: a crash
    // before DB commit leaves no call row, and a crash after commit leaves a
    // valid room. The only downside is a transient orphan room if the DB
    // transaction rolls back; it auto-expires via LiveKit's emptyTimeout.
    const roomMetadata = JSON.stringify({
      channelId,
      callOrigin: CallOrigin.CHANNEL,
      callType,
      sttModel: 'azure',
      createdBy: initiatorUserId,
      ...(allInvitedUserIds.length > 0 && { invitedUserIds: allInvitedUserIds }),
    });

    const effectiveMaxParticipants = Math.max(
      config.maxParticipants ?? 100,
      allInvitedUserIds.length + 1
    );

    await livekitService.createRoom({
      name: externalId,
      maxParticipants: effectiveMaxParticipants,
      emptyTimeout: config.emptyTimeout ?? 120,
      metadata: roomMetadata,
    });

    // Use the same atomic repository method the LiveKit webhook uses when the
    // first participant joins. This creates the Call, CallParticipants,
    // Conversation, system Message, and channelStats in one transaction.
    // The Automations bot is passed as joiningUserId but is NOT included in
    // channelParticipants, so every real invitee stays INVITED (no one is marked
    // as already joined). Automation call output is returned immediately after.
    const result = await repositories.calls.createCallWithParticipantsAndMessage({
      callId,
      roomName: externalId,
      channelId,
      workspaceId,
      createdBy: initiatorUserId,
      callType,
      roomLink,
      joiningUserId: initiatorUserId,
      channelParticipants: allInvitedUserIds.map((userId) => ({ userId })),
      conversationId,
      messageId,
      now,
      callOrigin: CallOrigin.CHANNEL,
    });

    // Ring every invited participant. In normal calls this happens from the
    // webhook when the first participant joins; for automations we do it
    // immediately because there is no human initiator entering the room first.
    const ringResults = await Promise.allSettled(
      result.invitedParticipantIds.map((participantId) =>
        callSideEffectService.handleParticipantInvited(participantId, { throwOnFailure: true })
      )
    );

    let ringSuccesses = 0;
    let ringFailures = 0;
    ringResults.forEach((ringResult, index) => {
      if (ringResult.status === 'fulfilled') {
        ringSuccesses += 1;
        return;
      }
      ringFailures += 1;
      logger.error('[MakeCallStep] participant_ring_failed', {
        participantId: result.invitedParticipantIds[index],
        callId,
        externalId,
        channelId,
        error:
          ringResult.reason instanceof Error
            ? ringResult.reason.message
            : String(ringResult.reason),
      });
    });

    if (result.invitedParticipantIds.length > 0 && ringSuccesses === 0) {
      logger.error('[MakeCallStep] all_participant_rings_failed', {
        callId,
        externalId,
        channelId,
        participantCount: result.invitedParticipantIds.length,
      });
      const cancelledAt = new Date();
      const cleanupResults = await Promise.allSettled([
        db.$transaction([
          db.callParticipant.deleteMany({ where: { callId } }),
          db.message.updateMany({
            where: { messageId, conversationId },
            data: {
              isDeleted: true,
              content: 'Automation call cancelled',
              metadata: {
                isCallMessage: true,
                callId: externalId,
                callType,
                operation: 'call_cancelled',
                reason: 'all_rings_failed',
              },
            },
          }),
          db.conversation.update({
            where: { conversationId },
            data: {
              callId: null,
              doNotPostToChannel: true,
              metadata: {
                automationCallCancelled: true,
                callId: externalId,
                reason: 'all_rings_failed',
              },
            },
          }),
          db.call.update({
            where: { id: callId },
            data: {
              status: CallStatus.CANCELLED,
              endedAt: cancelledAt,
              lastActivityAt: cancelledAt,
            },
          }),
        ]),
        livekitService.deleteRoom(externalId),
      ]);
      cleanupResults.forEach((cleanupResult, index) => {
        if (cleanupResult.status === 'fulfilled') return;
        logger.error('[MakeCallStep] all_rings_failed_cleanup_failed', {
          cleanup: index === 0 ? 'db_tombstone' : 'livekit_room',
          callId,
          externalId,
          error:
            cleanupResult.reason instanceof Error
              ? cleanupResult.reason.message
              : String(cleanupResult.reason),
        });
      });
      throw new Error(
        `[MakeCallStep] Call ${callId} was cancelled because all ${result.invitedParticipantIds.length} participant ring notifications failed`
      );
    }

    logger.info('[MakeCallStep] call_created', {
      callId,
      externalId,
      channelId,
      participantCount: allInvitedUserIds.length,
      ringSuccesses,
      ringFailures,
    });

    return { callId, roomLink, channelId, conversationId };
  }
}

export const makeCallStep = new MakeCallStep();
