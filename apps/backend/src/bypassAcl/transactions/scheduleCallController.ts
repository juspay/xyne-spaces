import { Request } from 'express';
import { repositories } from '@/database/repositories';
import { recurringCallService } from '@/services/recurringCallService';
import { INSTANCE_BUFFER_DAYS } from '@/controllers/scheduleCallController';
import { transaction } from '../base';
import { type Prisma, PrismaClient } from '@prisma/client';
import { CallType, CallOrigin } from '@xyne/shared';
import { replaceInternalParticipants, replaceExternalInvitees } from '@/bypassAcl/transactions/recurringCallParticipantRepository';
import { createInstancesForDateRange } from '@/bypassAcl/transactions/recurringCallService';
import { createScheduledCallPill } from '@/bypassAcl/transactions/callRepository';
export async function scheduleCallTx(db: PrismaClient, callId: string, externalId: string, title: string, userId: string, finalChannelId: string | undefined, conversationId: string | undefined, roomLink: string, startsAt: number, endsAt: number, targetUserIds: string[] | undefined, callUpdatesChannel: string | null, normalizedExternalInvitees: string[], resolvedCallOrigin: CallOrigin, req: Request) {
  let pillConversationId: string | undefined;
  const created = await transaction(['Call', 'CallParticipant'], 'scheduleCall: call row and participant rows must commit atomically; tx is not ACL-wrapped', db, async (tx) => {
    const result = await repositories.calls.createCallWithParticipants({
      callId,
      externalId,
      title,
      createdByUserId: userId,
      channelId: finalChannelId!,
      callType: CallType.AUDIO,
      callOrigin: resolvedCallOrigin,
      roomLink,
      timezone: 'UTC',
      isRecurring: false,
      startsAt: new Date(startsAt),
      endsAt: new Date(endsAt),
      ...(targetUserIds?.length && { targetUserIds }),
      ...(conversationId && { metadata: { conversationId } }),
      callUpdatesChannel,
      ...(normalizedExternalInvitees.length && { externalInvitees: normalizedExternalInvitees }),
    }, tx);

    // Same transaction as the call, so a pill can never outlive a failed insert.
    const workspaceId = await repositories.channels.getWorkspaceId(finalChannelId!);
    const pill = await createScheduledCallPill(tx, {
      callId,
      callExternalId: externalId,
      channelId: finalChannelId!,
      workspaceId,
      senderId: userId,
      senderName: req.user?.displayName || req.user?.name || 'Someone',
      ...(conversationId && { threadConversationId: conversationId }),
    });
    // Only a channel-root pill is its conversation's initialMessage.
    if (pill && !conversationId) pillConversationId = pill.conversationId;

    return result;
  });
  return { ...created, pillConversationId };
}
export function updateRecurringSeriesTx(db: PrismaClient, seriesId: string, seriesUpdate: Prisma.RecurringCallSeriesUncheckedUpdateInput, recurringParticipantUserIds: string[] | undefined, series: any, userId: string, req: Request, normalizedExternalInvitees: string[] | undefined) {
  return transaction(['RecurringCallParticipant', 'RecurringCallSeries'], 'updateRecurringSeries: series update and internal/external participant replacement must commit atomically; tx is not ACL-wrapped', db, async (tx) => {
    const seriesAfterUpdate = await repositories.recurringCallSeries.update(
      seriesId,
      seriesUpdate,
      tx,
    );

    if (recurringParticipantUserIds !== undefined) {
      await replaceInternalParticipants(repositories.recurringCallParticipants, {
        recurringSeriesId: seriesId,
        organizerId: series.organizerId,
        // Credit the editor on rows they add, so they can remove them later.
        invitedByUserId: userId,
        userIds: recurringParticipantUserIds,
        workspaceId: req.user!.workspaceId!,
        tx,
      });
    }

    if (normalizedExternalInvitees !== undefined) {
      await replaceExternalInvitees(repositories.recurringCallParticipants, {
        recurringSeriesId: seriesId,
        organizerId: series.organizerId,
        externalInvitees: normalizedExternalInvitees,
        workspaceId: req.user!.workspaceId!,
        tx,
      });
    }

    return seriesAfterUpdate;
  });
}

export async function createRecurringSeriesTx(dbClient: PrismaClient, seriesId: string, title: string, description: string | undefined, req: Request, userId: string, finalChannelId: string | undefined, recurrenceRule: string, timezone: string, startTime: string, endTime: string, startsOn: number, resolvedEndsOn: Date | null, callUpdatesChannel: string | null, recurringParticipantUserIds: string[], normalizedExternalInvitees: string[], createdCallIds: string[]) {
  const result = await transaction(['Call', 'CallParticipant', 'Channel', 'RecurringCallParticipant', 'RecurringCallSeries'], 'createRecurringSeries: series, participant rows and buffered instances must commit atomically; tx is not ACL-wrapped', dbClient, async (tx) => {
    const series = await repositories.recurringCallSeries.create({
      id: seriesId,
      title,
      description,
      workspaceId: req.user!.workspaceId!,
      organizerId: userId,
      channelId: finalChannelId!,
      recurrenceRule,
      timezone,
      startTime,
      endTime,
      startsOn: new Date(startsOn),
      endsOn: resolvedEndsOn,
      createdAt: new Date(),
      updatedAt: new Date(),
      callUpdatesChannel,
    }, tx);

    await replaceInternalParticipants(repositories.recurringCallParticipants, {
      recurringSeriesId: series.id,
      organizerId: userId,
      userIds: recurringParticipantUserIds,
      workspaceId: req.user!.workspaceId!,
      tx,
    });

    if (normalizedExternalInvitees.length > 0) {
      await replaceExternalInvitees(repositories.recurringCallParticipants, {
        recurringSeriesId: series.id,
        organizerId: userId,
        externalInvitees: normalizedExternalInvitees,
        workspaceId: req.user!.workspaceId!,
        tx,
      });
    }

    // Pre-create all instances for the next buffer period.
    // RecurringCallParticipant rows are the source for internal participants and external invitees.
    const fromDate = new Date(startsOn);
    const toDate = new Date(Date.now() + INSTANCE_BUFFER_DAYS);
    const finalToDate = resolvedEndsOn && resolvedEndsOn < toDate ? resolvedEndsOn : toDate;

    createdCallIds = await createInstancesForDateRange(recurringCallService, series, fromDate, finalToDate, tx, callUpdatesChannel);
  });
  return { result, createdCallIds };
}
