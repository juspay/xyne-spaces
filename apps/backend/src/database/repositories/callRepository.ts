import { updateScheduledCallTx } from '@/bypassAcl/transactions/callRepository';
import { createCallWithParticipantsAndMessageTx } from '@/bypassAcl/transactions/callRepository';
import { activateScheduledCallTx } from '@/bypassAcl/transactions/callRepository';
import { DatabaseClient } from '../client';
import { resolveWorkspaceIdFromModel } from '@/database/tenant/workspace-utils';
import { v4 as uuidv4 } from 'uuid';
import { Prisma, type Call, type CallParticipant } from '@prisma/client';
import { CallOrigin, CallStatus, CallType, InvitationResponse, MeetingStatus, RingStatus,  MessageArtifactStatus } from '@xyne/shared';
import { repositories } from './index';
import { logger } from '@/utils/logger';
import { messageMetadataService } from '@/services/messageMetadataService';
import type { CallParticipantMetadata } from '@xyne/shared';
import { normalizeEmailList } from '@/utils/email';
import { CallVespaFeedSource, queueCallVespaDelete, queueCallVespaFeed } from '@/services/callVespaQueue';
import { refreshCallParticipantPreview } from '@/utils/callParticipantCountUtils';
import { queueScheduledCallPillSync } from '@/services/scheduledCallPillSync';
import {
  setSlashCommandArtifactLifecycle,
  type MessageArtifactLifecycleStatus,
} from './messageArtifactRepository';
import { appendCallMarkedItem, clearCallGoogleCalendarPushState, setCallGoogleCalendarPushState } from '@/bypassAcl/callServices';
import { linkArtifactToActiveCallTx, moveScheduledCallPillTx } from '@/bypassAcl/transactions/callRepository';
import { updateRecordingParticipantsTx } from '@/bypassAcl/transactions/callRepository';
import { appendLabelsTx } from '@/bypassAcl/transactions/callRepository';
import { createParticipantTx } from '@/bypassAcl/transactions/callRepository';
import { handleParticipantLeaveTx } from '@/bypassAcl/transactions/callRepository';
import { handleRoomFinishedTx } from '@/bypassAcl/transactions/callRepository';
import { createLobbyRequestTx } from '@/bypassAcl/transactions/callRepository';
import { externalJoinTx } from '@/bypassAcl/transactions/callRepository';

export type { Call, CallParticipant };

// Shorter channel calls skip post-call AI outputs (see getPostCallAiSkipReason).
const MIN_CALL_DURATION_FOR_AI_SECONDS = 30;

/** Preview text only — the card itself renders from the metadata below. */
export const scheduledCallPillContent = (senderName: string): string =>
  `${senderName} scheduled a call`;

/** The call fields a pill card renders. Kept on the message, refreshed on every change. */
interface ScheduledCallPillSnapshot {
  id: string;
  title: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  status: string;
  channelId: string | null;
}

export const scheduledCallPillMetadata = (
  callExternalId: string,
  snapshot: ScheduledCallPillSnapshot,
): Prisma.InputJsonObject => ({
  isScheduledCallPill: true,
  callId: callExternalId,
  operation: 'call_scheduled',
  call: {
    // Internal id: the Calls screen and the summary route both key on it, not externalId.
    id: snapshot.id,
    title: snapshot.title,
    startsAt: snapshot.startsAt ? snapshot.startsAt.getTime() : null,
    endsAt: snapshot.endsAt ? snapshot.endsAt.getTime() : null,
    status: snapshot.status,
    channelId: snapshot.channelId,
  },
});

export function parseRecordingParticipantIds(stored: string | null): string[] {
  if (!stored) return [];
  try {
    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * The outbound mirror of a Call on the organizer's Google Calendar, recorded
 * under `calls.metadata.googleCalendarPush`. Absent until the call has been
 * pushed; removed again when the remote event is deleted.
 */
export type GoogleCalendarPushState = {
  /** Google's event id on the organizer's primary calendar. */
  eventId: string;
  /** ExternalSource the event was written through, so a reconnect is detectable. */
  sourceId: string;
  /** Organizer whose calendar owns the event — the only account allowed to edit it. */
  organizerUserId: string;
  /**
   * Digest of the event body last written. A reconcile whose payload hashes to
   * this skips the PATCH entirely — Google emails every attendee on an event
   * update, so a no-op write is not free.
   */
  contentHash: string;
  htmlLink?: string;
  syncedAt: string;
};

/**
 * Shape of `calls.metadata` as written by this repository.
 * `artifactMessageId` is set only for calls started from a slash-command
 * artifact card, and links the call back to the message that owns it.
 */
export interface CallMetadata {
  systemMessageId?: string;
  conversationId?: string;
  artifactMessageId?: string;
  googleCalendarPush?: GoogleCalendarPushState;
  /** The call's channel pill. Separate from `systemMessageId`, which activation owns. */
  channelPillMessageId?: string;
}

const getArtifactMessageId = (metadata: Prisma.JsonValue | null): string | undefined =>
  (metadata as CallMetadata | null)?.artifactMessageId;

export interface CreateCallParticipantInput {
  id: string;
  callId: string;
  userId: string;
  email?: string | null;
  invitedBy: string;
  invitedAt: Date;
  response: InvitationResponse;
  ringStatus?: RingStatus | null;
  meetingStatus?: MeetingStatus;
  respondedAt?: Date | null;
  joinedAt?: Date | null;
  leftAt?: Date | null;
}

export interface UpdateCallInput {
  status?: CallStatus;
  endedAt?: Date;
  lastActivityAt?: Date;
  roomLink?: string;
  metadata?: any;
  aiSummary?: string;
  title?: string;
  transcript?: string;
  startedAt?: Date;
  recordingUrl?: string | null;
  labels?: string[];
  markedItems?: Prisma.InputJsonValue[];
  summaryTemplateId?: string | null;
}

export interface CreateCallWithParticipantsInput {
  callId: string;
  externalId: string;
  title: string;
  createdByUserId: string;
  workspaceId?: string; // denormalized tenant key (background callers thread it in — no request-scoped stamp)
  channelId: string; // required for CHANNEL/CONVERSATION origin
  callType: CallType;
  callOrigin: CallOrigin;
  roomLink: string;
  timezone: string;
  isRecurring: boolean;
  recurringSeriesId?: string;
  startsAt: Date;
  endsAt: Date;
  targetUserIds?: string[];
  participantInviters?: Record<string, string>;
  externalInvitees?: string[];
  metadata?: Record<string, unknown>; // Optional: e.g. { conversationId } for thread-linked calls
  callUpdatesChannel?: string | null;
}

export class CallRepository {
  async findByExternalId(externalId: string): Promise<Call | null> {
    const result = await DatabaseClient.getInstance().call.findUnique({
      where: { externalId }
    });
    return result;
  }

  async setRecordingUrl(id: string, recordingUrl: string | null): Promise<void> {
    await DatabaseClient.getInstance().call.update({
      where: { id },
      data: { recordingUrl },
    });
    queueCallVespaFeed(id, { source: CallVespaFeedSource.CallRepositorySetRecordingUrl });
  }

  async findActiveCallByChannelId(channelId: string): Promise<Call | null> {
    const result = await DatabaseClient.getInstance().call.findFirst({
      where: {
        channelId,
        status: CallStatus.ACTIVE,
        callOrigin: CallOrigin.CHANNEL,
      },
      orderBy: {
        startedAt: 'desc'
      }
    });
    return result;
  }


  async findActiveCallByChannelIdAndConversationId(
    channelId: string,
    conversationId: string
  ): Promise<Call | null> {
    const result = await DatabaseClient.getInstance().call.findFirst({
      where: {
        channelId,
        status: CallStatus.ACTIVE,
        callOrigin: CallOrigin.CONVERSATION,
        metadata: {
          path: ['conversationId'],
          equals: conversationId
        }
      },
      orderBy: {
        startedAt: 'desc'
      }
    });
    return result;
  }

  /**
   * Find an active call belonging to a recurring series.
   * Used when a participant tries to join via an old series link so we can
   * redirect them to the currently-live instance instead.
   */
  async findActiveCallByRecurringSeriesId(recurringSeriesId: string): Promise<Call | null> {
    return await DatabaseClient.getInstance().call.findFirst({
      where: {
        recurringSeriesId,
        status: CallStatus.ACTIVE,
      },
      orderBy: {
        startedAt: 'desc',
      },
    });
  }

  /**
   * Find the current or next SCHEDULED call instance for a recurring series.
   * An occurrence remains eligible until its scheduled end time so a join request
   * made after startsAt still resolves to that occurrence instead of the next one.
   */
  async findCurrentOrNextScheduledCallByRecurringSeriesId(
    recurringSeriesId: string
  ): Promise<Call | null> {
    return await DatabaseClient.getInstance().call.findFirst({
      where: {
        recurringSeriesId,
        status: CallStatus.SCHEDULED,
        endsAt: { gt: new Date() },
      },
      orderBy: {
        startsAt: 'asc',
      },
    });
  }

  async findAllActiveCalls(take: number): Promise<Call[]> {
    const result = await DatabaseClient.getInstance().call.findMany({
      where: {
        status: CallStatus.ACTIVE,
      },
      take,
    });
    return result;
  }

  /**
   * Fetch call IDs for Vespa backfill in a stable paginated order.
   * The controller only needs the primary key, so keep this query centralized
   * here instead of duplicating Prisma pagination logic.
   */
  async findBackfillBatch(options: {
    where: Prisma.CallWhereInput;
    skip: number;
    take: number;
    orderByUpdatedAt: boolean;
  }): Promise<Array<Pick<Call, 'id'>>> {
    const { where, skip, take, orderByUpdatedAt } = options;

    return await DatabaseClient.getInstance().call.findMany({
      where,
      skip,
      take,
      orderBy: orderByUpdatedAt ? { updatedAt: 'asc' } : { createdAt: 'asc' },
      select: { id: true },
    });
  }

  /**
   * Find SCHEDULED calls whose endsAt has passed (stale scheduled calls).
   * These are calls that were never started and whose window has expired —
   * the Bull auto-end job may have been missed or lost.
   */
  async findStaleScheduledCalls(
    take: number,
    excludeOrigins?: CallOrigin[],
  ): Promise<Call[]> {
    return DatabaseClient.getInstance().call.findMany({
      where: {
        status: CallStatus.SCHEDULED,
        endsAt: { lt: new Date() },
        ...(excludeOrigins?.length && { callOrigin: { notIn: excludeOrigins } }),
      },
      take,
    });
  }

  /**
   * All calls whose detailed summary has sat in 'pending' since
   * before `staleBefore` with no row activity. Summary generation runs
   * in-process in the API, so a backend restart mid-run leaves the row
   * 'pending' forever — this is the query the validation worker sweeps.
   * updatedAt is part of the predicate so a fresh manual regenerate on an old
   * recording (which re-publishes 'pending' and bumps updatedAt) is not swept
   * on the next cycle.
   */
  async findStalePendingSummaryCalls(take: number, staleBefore: Date): Promise<Call[]> {
    return DatabaseClient.getInstance().call.findMany({
      where: {
        endedAt: { lt: staleBefore },
        updatedAt: { lt: staleBefore },
        metadata: { path: ['detailedSummaryStatus'], equals: 'pending' },
      },
      orderBy: { endedAt: 'asc' },
      take,
    });
  }

  async update(id: string, data: UpdateCallInput): Promise<Call> {
    const client = DatabaseClient.getInstance();
    const result = await client.call.update({
      where: { id },
      data
    });
    if (data.status === CallStatus.ENDED) {
      await this.syncArtifactLifecycle(
        client,
        result,
        MessageArtifactStatus.COMPLETED,
        data.endedAt ?? new Date(),
      );
    }
    queueCallVespaFeed(result.id, { source: CallVespaFeedSource.CallRepositoryUpdate });
    queueScheduledCallPillSync(result.id, 'callRepository.update');
    return result;
  }

  /**
   * Adopt an already-running call as a slash-command artifact's call.
   *
   * "Start call" on an artifact card is channel-scoped, so it lands on the
   * channel's existing call whenever one is already live instead of creating a
   * room. Without this the card would sit in its pending state forever and the
   * artifact would never be completed when that call ends, because completion
   * is driven off `calls.metadata.artifactMessageId`.
   *
   * Refuses to steal a call that already belongs to a different artifact — the
   * first incident to claim it keeps it.
   */
  async linkArtifactToActiveCall(params: {
    callId: string;
    callExternalId: string;
    channelId: string;
    artifactMessageId: string;
    metadata: Prisma.JsonValue | null;
  }): Promise<boolean> {
    const { callId, callExternalId, channelId, artifactMessageId, metadata } = params;
    const existingArtifactMessageId = getArtifactMessageId(metadata);
    if (existingArtifactMessageId) return existingArtifactMessageId === artifactMessageId;

    await linkArtifactToActiveCallTx(callId, metadata, artifactMessageId, channelId, callExternalId);

    queueCallVespaFeed(callId, { source: CallVespaFeedSource.CallRepositoryUpdate });
    return true;
  }

  /**
   * Mirror a call transition onto the slash-command artifact that started it.
   * A no-op for every other call, which is why it can sit directly on the
   * shared end-of-call paths without altering their behavior.
   */
  async syncArtifactLifecycle(
    tx: Prisma.TransactionClient,
    call: {
      id: string;
      externalId: string;
      channelId: string | null;
      startedAt: Date | null;
      metadata: Prisma.JsonValue | null;
    },
    status: MessageArtifactLifecycleStatus,
    endedAt?: Date
  ): Promise<void> {
    const artifactMessageId = getArtifactMessageId(call.metadata);
    if (!artifactMessageId || !call.channelId) return;

    // On completion, summarise the call for the card. An ended call has left
    // the client's active-call subscription, so these two numbers are baked
    // into the message once here — the same thing updateCallSystemMessageIfNeeded
    // does for the ordinary "started a call" system message.
    const endedCall =
      status === MessageArtifactStatus.COMPLETED && endedAt && call.startedAt
        ? {
            durationMs: Math.max(0, endedAt.getTime() - call.startedAt.getTime()),
            joinedCount: await tx.callParticipant.count({
              where: { callId: call.id, joinedAt: { not: null } },
            }),
          }
        : undefined;

    await setSlashCommandArtifactLifecycle(tx, {
      messageId: artifactMessageId,
      channelId: call.channelId,
      status,
      callExternalId: call.externalId,
      ...(endedCall && { endedCall }),
    });
  }

  async appendMarkedItem(externalId: string, item: Prisma.InputJsonValue): Promise<boolean> {
    const rowsUpdated = await appendCallMarkedItem(externalId, item);
    return rowsUpdated > 0;
  }

  /**
   * Why a channel call should get no post-call AI outputs, or null to proceed.
   * Channel calls only: headless calls have no CallParticipant rows. A null
   * endedAt (webhook race) never triggers the duration skip.
   */
  async getPostCallAiSkipReason(
    call: Pick<Call, 'id' | 'startedAt' | 'endedAt'>,
  ): Promise<{
    reason: 'single_joined_participant' | 'call_too_short' | null;
    joinedCount: number;
    durationSeconds: number | null;
  }> {
    const joinedCount = await DatabaseClient.getInstance().callParticipant.count({
      where: { callId: call.id, joinedAt: { not: null } },
    });
    const durationSeconds = call.endedAt
      ? Math.max(0, (call.endedAt.getTime() - call.startedAt.getTime()) / 1000)
      : null;

    const reason =
      joinedCount <= 1
        ? 'single_joined_participant'
        : durationSeconds !== null && durationSeconds < MIN_CALL_DURATION_FOR_AI_SECONDS
          ? 'call_too_short'
          : null;

    return { reason, joinedCount, durationSeconds };
  }

  async updateRecordingParticipants(
    externalId: string,
    action: 'add' | 'remove',
    userId: string,
  ): Promise<boolean> {
    const lockKey = `call-recording-participants:${externalId}`;

    return updateRecordingParticipantsTx(lockKey, externalId, action, userId);
  }

  async appendLabels(callId: string, labelIds: string[]): Promise<void> {
    if (labelIds.length === 0) return;
    const lockKey = `call-labels:${callId}`;

    await appendLabelsTx(lockKey, callId, labelIds);

    queueCallVespaFeed(callId, { source: CallVespaFeedSource.CallRepositoryUpdate });
  }

  async findById(id: string): Promise<Call | null> {
    const result = await DatabaseClient.getInstance().call.findUnique({
      where: { id }
    });
    return result;
  }

  async findByUserAndType(userId: string, callType: CallType): Promise<Call[]>;
  async findByUserAndType(
    userId: string,
    callType: CallType,
    options: { limit: number; cursor?: { startedAt: Date; id: string } }
  ): Promise<{ calls: Call[]; nextCursor: { startedAt: Date; id: string } | null }>;
  async findByUserAndType(
    userId: string,
    callType: CallType,
    options?: { limit: number; cursor?: { startedAt: Date; id: string } }
  ): Promise<Call[] | { calls: Call[]; nextCursor: { startedAt: Date; id: string } | null }> {
    const where: Prisma.CallWhereInput = {
      createdByUserId: userId,
      callType,
      ...(options?.cursor && {
        OR: [
          { startedAt: { lt: options.cursor.startedAt } },
          { startedAt: options.cursor.startedAt, id: { lt: options.cursor.id } },
        ],
      }),
    };

    if (!options) {
      return await DatabaseClient.getInstance().call.findMany({
        where,
        orderBy: { startedAt: 'desc' },
      });
    }

    const { limit } = options;
    // Fetch one extra to determine if there is a next page
    const calls = await DatabaseClient.getInstance().call.findMany({
      where,
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    let nextCursor: { startedAt: Date; id: string } | null = null;
    if (calls.length > limit) {
      calls.pop(); // discard the sentinel item (not part of the current page)
      const lastInPage = calls[calls.length - 1];
      nextCursor = { startedAt: lastInPage.startedAt, id: lastInPage.id };
    }

    return { calls, nextCursor };
  }

  async delete(id: string): Promise<void> {
    await DatabaseClient.getInstance().call.delete({
      where: { id }
    });
    queueCallVespaDelete(id, { source: 'CallRepository.delete' });
  }

  async getScheduledCallsForUser(userId: string, from: Date, to: Date) {
    return DatabaseClient.getInstance().call.findMany({
      where: {
        participants: { some: { userId } },
        status: CallStatus.SCHEDULED,
        startsAt: { gte: from, lte: to },
      },
      include: {
        participants: {
          where: { isExternal: false },
          select: { userId: true, meetingStatus: true },
        },
      },
      orderBy: { startsAt: 'asc' },
    });
  }

  async findParticipant(callId: string, userId: string): Promise<CallParticipant | null> {
    const result = await DatabaseClient.getInstance().callParticipant.findFirst({
      where: {
        callId,
        userId,
      },
    });
    return result;
  }


  async createParticipant(data: CreateCallParticipantInput): Promise<CallParticipant> {
    const workspaceId = await this.getCallWorkspaceId(data.callId);
    return await createParticipantTx(data, workspaceId);
  }

  async updateParticipantMeetingStatus(
    participantId: string,
    meetingStatus: MeetingStatus,
    respondedAt: Date,
    tx: Prisma.TransactionClient,
  ): Promise<CallParticipant> {
    const participant = await tx.callParticipant.update({
      where: { id: participantId },
      data: {
        meetingStatus,
        respondedAt,
      },
    });
    queueCallVespaFeed(participant.callId, { source: CallVespaFeedSource.CallRepositoryUpdateParticipantMeetingStatus });
    return participant;
  }

  /**
   * Create a SCHEDULED call together with its participants in a single transaction.
   * Used by both one-time scheduled calls and recurring series instances.
   * Channel participants are fetched first (outside the transaction) and then
   * written atomically alongside the call record.
   * Returns the callId and the list of invited participant userIds.
   */
  async createCallWithParticipants(
    params: CreateCallWithParticipantsInput,
    tx: Prisma.TransactionClient,
  ): Promise<{ callId: string; participantUserIds: string[] }> {
    const workspaceId = await repositories.channels.getWorkspaceId(params.channelId);

    const baseParticipantUserIds = params.targetUserIds?.length
      ? params.targetUserIds
      : (await repositories.channelParticipants.getChannelParticipants(params.channelId)).map(p => p.userId);

    // Always include the creator/organizer — they may not appear in a hand-picked targetUserIds list.
    const participantUserIds = baseParticipantUserIds.includes(params.createdByUserId)
      ? baseParticipantUserIds
      : [params.createdByUserId, ...baseParticipantUserIds];
    const externalInvitees = normalizeEmailList(params.externalInvitees);

    await tx.call.create({
      data: {
        id: params.callId,
        externalId: params.externalId,
        title: params.title,
        workspaceId,
        createdByUserId: params.createdByUserId,
        channelId: params.channelId,
        callType: params.callType,
        callOrigin: params.callOrigin,
        status: CallStatus.SCHEDULED,
        timezone: params.timezone,
        isRecurring: params.isRecurring,
        ...(params.recurringSeriesId && { recurringSeriesId: params.recurringSeriesId }),
        recordingEnabled: false,
        roomLink: params.roomLink,
        startsAt: params.startsAt,
        endsAt: params.endsAt,
        createdAt: new Date(),
        updatedAt: new Date(),
        lastActivityAt: new Date(),
        participantCount: participantUserIds.length + externalInvitees.length,
        ...(params.metadata && { metadata: params.metadata as Prisma.InputJsonValue }),
        ...(params.callUpdatesChannel !== undefined && { callUpdatesChannel: params.callUpdatesChannel }),
      },
    });

    await tx.callParticipant.createMany({
      data: participantUserIds.map((userId) => ({
        id: uuidv4(),
        callId: params.callId,
        workspaceId,
        userId,
        invitedBy: params.participantInviters?.[userId] ?? params.createdByUserId,
        invitedAt: new Date(),
        response: InvitationResponse.INVITED,
        meetingStatus: userId === params.createdByUserId ? MeetingStatus.ACCEPTED : MeetingStatus.PENDING,
        respondedAt: userId === params.createdByUserId ? new Date() : null,
        joinedAt: null,
        leftAt: null,
      })),
    });

    if (externalInvitees.length > 0) {
      await tx.callParticipant.createMany({
        data: externalInvitees.map((email) => {
          const participantId = uuidv4();
          return {
            id: participantId,
            callId: params.callId,
            workspaceId,
            userId: participantId,
            email,
            invitedBy: params.createdByUserId,
            invitedAt: new Date(),
            response: InvitationResponse.INVITED,
            meetingStatus: MeetingStatus.PENDING,
            respondedAt: null,
            joinedAt: null,
            leftAt: null,
            displayName: email,
            isExternal: true,
          };
        }),
        skipDuplicates: true,
      });
    }

    await refreshCallParticipantPreview(tx, params.callId);

    return { callId: params.callId, participantUserIds };
  }

  /**
   * Find participant userIds from the most recently created call in a recurring series.
   * Used to carry over the explicit participant list when creating new instances.
   */
  async findLatestSeriesParticipantUserIds(
    seriesId: string,
    tx: Prisma.TransactionClient,
  ): Promise<string[] | undefined> {
    const sibling = await tx.call.findFirst({
      where: { recurringSeriesId: seriesId },
      select: { participants: { where: { isExternal: false }, select: { userId: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return sibling?.participants.map(p => p.userId);
  }

  /**
   * Get all participants for a call, with the user who invited each of them.
   */
  async findParticipants(callId: string): Promise<Array<{ userId: string; invitedBy: string }>> {
    return await DatabaseClient.getInstance().callParticipant.findMany({
      where: {
        callId,
        isExternal: false,
      },
      select: {
        userId: true,
        invitedBy: true,
      },
    });
  }

  async findExternalInviteeEmails(callId: string): Promise<string[]> {
    const participants = await DatabaseClient.getInstance().callParticipant.findMany({
      where: {
        callId,
        isExternal: true,
        email: { not: null },
      },
      select: {
        email: true,
      },
    });

    return participants
      .map(p => p.email)
      .filter((email): email is string => Boolean(email));
  }

  /**
   * Everything the outbound Google Calendar push needs to mirror a call, in a
   * single query. Not `findByExternalId`: the push job runs outside any tenant
   * scope and knows only a call id, so it reads the row's own `workspaceId`
   * here and opens a scope with it before doing anything else.
   */
  async findForCalendarPush(callId: string): Promise<{
    id: string;
    externalId: string;
    workspaceId: string;
    title: string | null;
    description: string | null;
    status: string;
    callOrigin: string;
    createdByUserId: string;
    roomLink: string | null;
    startsAt: Date | null;
    endsAt: Date | null;
    timezone: string;
    metadata: Prisma.JsonValue | null;
    updatedAt: Date;
  } | null> {
    return await DatabaseClient.getInstance().call.findUnique({
      where: { id: callId },
      select: {
        id: true,
        externalId: true,
        workspaceId: true,
        title: true,
        description: true,
        status: true,
        callOrigin: true,
        createdByUserId: true,
        roomLink: true,
        startsAt: true,
        endsAt: true,
        timezone: true,
        metadata: true,
        updatedAt: true,
      },
    });
  }

  /** `updatedAt` alone, to detect a call edited while a push job was running. */
  async findCalendarPushRevision(callId: string): Promise<Date | null> {
    const row = await DatabaseClient.getInstance().call.findUnique({
      where: { id: callId },
      select: { updatedAt: true },
    });
    return row?.updatedAt ?? null;
  }

  /**
   * Record (or clear) the Google Calendar event this call is mirrored to.
   *
   * Written as a jsonb merge rather than a read-modify-write of the whole
   * column: `calls.metadata` also carries `systemMessageId` / `conversationId`
   * written by unrelated flows, and a push job that round-tripped the object
   * would silently drop whichever of those landed in between.
   */
  async setGoogleCalendarPushState(
    callId: string,
    state: GoogleCalendarPushState | null,
  ): Promise<void> {
    if (state === null) {
      await clearCallGoogleCalendarPushState(callId);
      return;
    }

    await setCallGoogleCalendarPushState(callId, state);
  }

  /**
   * Get all participants for a call with their response status.
   * Used to check for active participants when auto-ending calls.
   * - ACCEPTED: participant is currently in the call
   * - LEFT: participant joined and has left the call
   * - INVITED: participant has not yet joined
   */
  async findParticipantsWithStatus(callId: string): Promise<Array<{ userId: string; response: InvitationResponse | null }>> {
    return (await DatabaseClient.getInstance().callParticipant.findMany({
      where: {
        callId,
      },
      select: {
        userId: true,
        response: true,
      },
    })) as Array<{ userId: string; response: InvitationResponse | null }>;
  }

  /**
   * Get all participant IDs for a call matching a specific response
   */
  async getParticipantIdsByResponse(callId: string, response: InvitationResponse): Promise<string[]> {
    const participants = await DatabaseClient.getInstance().callParticipant.findMany({
      where: {
        callId,
        isExternal: false,
        response,
      },
      select: {
        userId: true,
      },
    });
    return participants.map((p) => p.userId);
  }

  async getParticipantIdsByMeetingStatus(callId: string, meetingStatus: MeetingStatus): Promise<string[]> {
    const participants = await DatabaseClient.getInstance().callParticipant.findMany({
      where: {
        callId,
        isExternal: false,
        meetingStatus,
      },
      select: {
        userId: true,
      },
    });
    return participants.map((p) => p.userId);
  }

  /**
   * Get up to 3 participants who joined the call (with user names) and total count
   * Now uses the smaller utility methods with transaction support
   * Requires a transaction client for atomic operations
   */
  async getJoinedParticipants(
    callId: string,
    tx: Prisma.TransactionClient
  ): Promise<{ participants: Array<{ userId: string; userName: string }>; totalCount: number }> {
    // Use the utility methods
    const joinedParticipants = await this.getLeftParticipants(callId, 3, tx);
    const totalCount = await this.countLeftParticipants(callId, tx);

    if (totalCount === 0) return { participants: [], totalCount: 0 };

    const internalUserIds = joinedParticipants.filter(p => !p.isExternal).map(p => p.userId);
    const users = internalUserIds.length > 0
      ? await repositories.users.getUserNamesByIds(internalUserIds, tx)
      : [];

    const userMap = new Map(users.map(u => [u.id, u.displayName || u.name]));

    return {
      participants: joinedParticipants.map(p => ({
        userId: p.userId,
        userName: p.isExternal
          ? `${p.displayName || 'Guest'} (External)`
          : (userMap.get(p.userId) ?? 'Unknown User'),
      })),
      totalCount,
    };
  }

  /**
   * Mark all active participants as left for a call
   * @param tx - Optional transaction client for atomic operations
   */
  async markAllParticipantsAsLeft(
    callId: string,
    leftAt: Date,
    tx?: Prisma.TransactionClient
  ): Promise<void> {
    const client = tx || DatabaseClient.getInstance();
    await client.callParticipant.updateMany({
      where: {
        callId,
        leftAt: null,
      },
      data: {
        response: InvitationResponse.LEFT,
        leftAt,
      },
    });
    queueCallVespaFeed(callId, { source: CallVespaFeedSource.CallRepositoryMarkAllParticipantsAsLeft });
  }

  /**
   * Mark a call's ACCEPTED participants as LEFT. Returns the number of rows updated.
   */
  async markStrandedParticipantsAsLeft(callId: string, leftAt: Date): Promise<number> {
    const { count } = await DatabaseClient.getInstance().callParticipant.updateMany({
      where: {
        callId,
        response: InvitationResponse.ACCEPTED,
      },
      data: {
        response: InvitationResponse.LEFT,
        leftAt,
      },
    });

    if (count > 0) {
      queueCallVespaFeed(callId, { source: CallVespaFeedSource.CallRepositoryMarkParticipantAsLeft });
    }

    return count;
  }

  /**
   * Find calls that are no longer live but still have ACCEPTED participants.
   */
  async findCallsWithStrandedParticipants(
    take: number,
  ): Promise<Array<{ id: string; endedAt: Date | null }>> {
    const stranded = await DatabaseClient.getInstance().callParticipant.findMany({
      where: {
        response: InvitationResponse.ACCEPTED,
        call: { status: { notIn: [CallStatus.ACTIVE, CallStatus.IN_PROGRESS] } },
      },
      select: { callId: true },
      distinct: ['callId'],
      take,
    });

    if (stranded.length === 0) return [];

    return await DatabaseClient.getInstance().call.findMany({
      where: { id: { in: stranded.map((p) => p.callId) } },
      select: { id: true, endedAt: true },
      orderBy: { endedAt: 'asc' },
    });
  }

  /**
   * Get participants who left a call (up to specified limit)
   * Requires a transaction client for atomic operations
   */
  async getLeftParticipants(
    callId: string,
    limit: number,
    tx: Prisma.TransactionClient
  ): Promise<Array<{ userId: string; displayName: string | null; isExternal: boolean }>> {
    return await tx.callParticipant.findMany({
      where: {
        callId,
        response: InvitationResponse.LEFT,
      },
      orderBy: {
        joinedAt: 'asc',
      },
      take: limit,
      select: {
        userId: true,
        displayName: true,
        isExternal: true,
      }
    });
  }

  /**
   * Count participants who left a call
   * Requires a transaction client for atomic operations
   */
  async countLeftParticipants(
    callId: string,
    tx: Prisma.TransactionClient
  ): Promise<number> {
    return await tx.callParticipant.count({
      where: {
        callId,
        response: InvitationResponse.LEFT,
      },
    });
  }

  /**
   * Handle participant leaving - marks participant as left and ends call if no active participants.
   * If the call has a future endsAt (scheduled call), reverts to SCHEDULED instead of ENDED
   * so participants can rejoin. Also updates system message within the transaction if call ends.
   * Returns whether the call should be ended, if message was updated, and the call data.
   */
  async handleParticipantLeave(
    params: {
      callExternalId: string;
      userId: string;
      leftAt: Date;
    }
  ): Promise<{ shouldEndCall: boolean; messageUpdated: boolean; call: Call | null }> {
    const { callExternalId, userId, leftAt } = params;

    const result = await handleParticipantLeaveTx(callExternalId, userId, this, leftAt);
    queueCallVespaFeed(result.call?.id, { source: CallVespaFeedSource.CallRepositoryHandleParticipantLeaving });
    if (result.call) {
      queueScheduledCallPillSync(result.call.id, 'callRepository.handleParticipantLeave');
    }
    return result;
  }

  /**
   * Handle room finished - marks call as ended (or SCHEDULED if still within its window) and updates system message.
   * Returns whether the call was ended and if message was updated.
   */
  async handleRoomFinished(
    params: {
      callExternalId: string;
      endedAt: Date;
    }
  ): Promise<{ shouldEndCall: boolean; messageUpdated: boolean; call: Call | null }> {
    const { callExternalId, endedAt } = params;

    const result = await handleRoomFinishedTx(callExternalId, endedAt, this);
    queueCallVespaFeed(result.call?.id, { source: CallVespaFeedSource.CallRepositoryHandleRoomFinished });
    if (result.call) {
      queueScheduledCallPillSync(result.call.id, 'callRepository.handleRoomFinished');
    }
    return result;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private helpers
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Resolve the denormalized workspaceId for a call from its internal id.
   * Used when only a callId is in scope (participant/lobby creates) so the new
   * row inherits the workspace of the parent call.
   */
  private async getCallWorkspaceId(
    callId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<string> {
    const client = tx ?? DatabaseClient.getInstance();
    return resolveWorkspaceIdFromModel(client, 'call', { id: callId });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Public composite methods
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Activate a SCHEDULED call when the first participant joins.
   *
   * Two cases handled inside a single $transaction:
   *  1. No conversation yet → create conversation + system message, flip to ACTIVE.
   *  2. Conversation already exists (rejoin within the window) → flip to ACTIVE only.
   *
   * Returns the fresh call record after the update.
   */
  async activateScheduledCall(params: {
    call: Call;
    initiatorName: string;
    now: Date;
    workspaceId?: string;
  }): Promise<void> {
    const { call: callParam, initiatorName, now, workspaceId } = params;

    await activateScheduledCallTx(callParam, workspaceId, initiatorName, now);

    // Sync eagerly so initial_message_md is populated before the response returns.
    // The middleware also covers this via setImmediate, but the deferred sync is too
    // late for clients that render the channel immediately after the call is created.
    const activatedCallMeta = (await DatabaseClient.getInstance().call.findUnique({
      where: { id: callParam.id },
      select: { metadata: true },
    }))?.metadata as { conversationId?: string } | null;
    if (activatedCallMeta?.conversationId) {
      await messageMetadataService.syncInitialMessageMd(activatedCallMeta.conversationId);
    }
    queueCallVespaFeed(callParam.id, { source: CallVespaFeedSource.CallRepositoryActivateScheduledCall });
    queueScheduledCallPillSync(callParam.id, 'callRepository.activateScheduledCall');
  }

  /**
   * Rewrite a call's pill message with its current title, time and status.
   *
   * Every path that changes one of those has to call this, or the card goes stale —
   * see queueScheduledCallPillSync for the fire-and-forget wrapper most callers use.
   * No-ops for a call with no pill, and for a pill retired by a channel move.
   */
  async syncScheduledCallPillMessage(callId: string): Promise<void> {
    const db = DatabaseClient.getInstance();

    const call = await db.call.findUnique({
      where: { id: callId },
      select: {
        id: true,
        externalId: true,
        title: true,
        startsAt: true,
        endsAt: true,
        status: true,
        channelId: true,
        metadata: true,
      },
    });
    const messageId = (call?.metadata as CallMetadata | null)?.channelPillMessageId;
    if (!call || !messageId) return;

    const message = await db.message.findUnique({
      where: { messageId },
      select: { conversationId: true, metadata: true },
    });
    if (!message) return;
    // A retired pill is a dead card: the move stamped it and it is never revived.
    if ((message.metadata as { retired?: boolean } | null)?.retired) return;

    await db.message.update({
      where: { messageId },
      data: { metadata: scheduledCallPillMetadata(call.externalId, call) },
    });
    // Mandatory: the channel timeline renders from the denormalized blob, not the row.
    await messageMetadataService.syncInitialMessageMd(message.conversationId);
  }

  /**
   * An edit moved the call: retire the old pill and post a fresh one in the destination.
   *
   * A pill that is not its conversation's initialMessage sits inside a thread, which
   * does not travel with the call's channel — leave it alone.
   */
  async moveScheduledCallPill(params: {
    callId: string;
    callExternalId: string;
    callTitle: string | null;
    newChannelId: string;
    workspaceId: string;
    senderId: string;
    senderName: string;
  }): Promise<void> {
    const { callId, callExternalId, callTitle, newChannelId, workspaceId, senderId, senderName } =
      params;

    const result = await moveScheduledCallPillTx(callId, callExternalId, callTitle, newChannelId, workspaceId, senderId, senderName);

    if (result) {
      // The channel timeline renders from the denormalized initial_message_md blob.
      // Both the retired pill's conversation and the new pill's conversation need
      // to be synced so Zero picks up the retirement and the fresh card.
      if (result.retiredConversationId) {
        await messageMetadataService.syncInitialMessageMd(result.retiredConversationId);
      }
      if (result.newConversationId) {
        await messageMetadataService.syncInitialMessageMd(result.newConversationId);
      }
    }
  }

  /**
   * Create initial call with all participants, conversation, and system message atomically.
   * This is used when the first participant joins a brand-new room.
   * Returns the call and list of invited participant IDs (excluding the joining user).
   */
  async createCallWithParticipantsAndMessage(
    params: {
      callId: string;
      roomName: string;
      channelId: string;
      workspaceId?: string;
      createdBy: string;
      callType: CallType;
      roomLink: string;
      joiningUserId: string;
      channelParticipants: Array<{ userId: string }>;
      conversationId: string;
      messageId: string;
      now: Date;
      callOrigin?: CallOrigin;
      artifactMessageId?: string;
      /** Transcription agent this call was pinned to at creation time (from room metadata). */
      agentName?: string;
      dispatchStatus?: string;
    }
  ): Promise<{ call: Call; invitedParticipantIds: string[] }> {
    const {
      callId,
      roomName,
      channelId,
      workspaceId,
      createdBy,
      callType,
      roomLink,
      joiningUserId,
      channelParticipants,
      conversationId,
      messageId,
      now,
      callOrigin,
      artifactMessageId,
      agentName,
      dispatchStatus,
    } = params;

    const isHeadless = callType === CallType.HEADLESS;

    // Prefer the caller-supplied workspaceId, else derive from the call's channel.
    const wsId = workspaceId ?? await repositories.channels.getWorkspaceId(channelId);

    const result = await createCallWithParticipantsAndMessageTx(callId, roomName, wsId, createdBy, channelId, workspaceId, callType, roomLink, isHeadless, now, callOrigin, messageId, conversationId, artifactMessageId, agentName, dispatchStatus, this, channelParticipants, joiningUserId);

    await messageMetadataService.syncInitialMessageMd(conversationId);

    queueCallVespaFeed(result.call.id, { source: CallVespaFeedSource.CallRepositoryCreateCallWithParticipantsAndMessage });
    return result;
  }

  /**
   * Get all participants for a call with their user details
   * Used for building mention maps in documents
   */
  async getCallParticipantsWithUserDetails(
    callExternalId: string
  ): Promise<Array<{ userId: string; userName: string; userEmail: string; userPicture: string | null }>> {
    // Get call by external ID
    const call = await this.findByExternalId(callExternalId);
    if (!call) {
      return [];
    }

    // Get all call participants using repository method
    const callParticipants = await this.findParticipants(call.id);

    // Get user IDs
    const userIds = callParticipants.map(p => p.userId);

    if (userIds.length === 0) {
      return [];
    }

    // Batch fetch all user details using repository method
    const users = await repositories.users.findMany({
      where: { id: { in: userIds } },
    });

    return users.map(user => ({
      userId: user.id,
      userName: user.displayName || user.name,
      userEmail: user.email,
      userPicture: user.picture,
    }));
  }

  /**
   * Get all participants for a call with their user details and response status.
   * Used by the native Participants screen to categorize attendees vs invited.
   */
  async getParticipantsInfo(
    callExternalId: string
  ): Promise<Array<{
    userId: string;
    userName: string;
    userEmail: string;
    userPicture: string | null;
    response: InvitationResponse | null;
    meetingStatus: MeetingStatus;
    joinedAt: Date | null;
    leftAt: Date | null;
  }>> {
    const call = await this.findByExternalId(callExternalId);
    if (!call) {
      logger.info(`[getParticipantsInfo] No call found for externalId: ${callExternalId}`);
      return [];
    }

    logger.info(`[getParticipantsInfo] Resolved call: externalId=${callExternalId}, internalId=${call.id}`);

    // Fetch participants with response status
    const callParticipants = await DatabaseClient.getInstance().callParticipant.findMany({
      where: { callId: call.id },
      select: {
        userId: true,
        email: true,
        displayName: true,
        isExternal: true,
        response: true,
        meetingStatus: true,
        joinedAt: true,
        leftAt: true,
      },
    });

    logger.info(`[getParticipantsInfo] Found ${callParticipants.length} call_participant records for callId=${call.id}, userIds: ${callParticipants.map(p => p.userId).join(', ')}`);

    const userIds = callParticipants.map(p => p.userId);
    if (userIds.length === 0) {
      return [];
    }

    // Batch fetch all user details
    const users = await repositories.users.findMany({
      where: { id: { in: userIds } },
    });

    const userMap = new Map(users.map(u => [u.id, u]));

    return callParticipants.map(p => {
      const user = userMap.get(p.userId);
      if (p.isExternal) {
        const externalName = p.displayName || p.email || 'Guest';
        return {
          userId: p.userId,
          userName: externalName,
          userEmail: p.email ?? '',
          userPicture: null,
          response: p.response as InvitationResponse | null,
          meetingStatus: p.meetingStatus as MeetingStatus,
          joinedAt: p.joinedAt,
          leftAt: p.leftAt,
        };
      }

      return {
        userId: p.userId,
        userName: (user?.displayName || user?.name) ?? 'Unknown',
        userEmail: user?.email ?? '',
        userPicture: user?.picture ?? null,
        response: p.response as InvitationResponse | null,
        meetingStatus: p.meetingStatus as MeetingStatus,
        joinedAt: p.joinedAt,
        leftAt: p.leftAt,
      };
    });
  }

  /**
   * Update a SCHEDULED call's fields and manage participant delta.
   * Only modifies fields that are explicitly provided.
   * Participant changes: addUserIds are added (skipping duplicates), removeUserIds are deleted.
   * `invitedByUserId` is stamped on the newly added rows — it is the editor, not necessarily
   * the organizer, so a participant who added someone can later be allowed to remove them.
   */
  async updateScheduledCall(params: {
    callId: string;
    title?: string;
    startsAt?: Date;
    endsAt?: Date;
    channelId?: string;
    addUserIds?: string[];
    removeUserIds?: string[];
    invitedByUserId?: string;
    metadata?: Record<string, unknown>;
    callUpdatesChannel?: string | null;
    externalInvitees?: string[];
  }): Promise<Call> {
    const { callId, title, startsAt, endsAt, channelId, addUserIds, removeUserIds, invitedByUserId, metadata, callUpdatesChannel, externalInvitees } = params;
    const db = DatabaseClient.getInstance();

    const updatedCall = await updateScheduledCallTx(db, title, startsAt, endsAt, channelId, metadata, callUpdatesChannel, callId, removeUserIds, addUserIds, invitedByUserId, externalInvitees);

    queueCallVespaFeed(callId, { source: CallVespaFeedSource.CallRepositoryUpdateScheduledCall });
    queueScheduledCallPillSync(callId, 'callRepository.updateScheduledCall');
    return updatedCall;
  }

  // ---------------------------------------------------------------------------
  // External Lobby methods
  // ---------------------------------------------------------------------------

  /**
   * Return only public-safe fields for an external-lobby page.
   * Never exposes internal id, channelId, createdByUserId, etc.
   */
  async getPublicCallInfo(externalId: string): Promise<{
    title: string | null;
    callType: CallType;
    status: CallStatus;
    callId: string;
    createdByUserId: string;
    roomName: string;
  } | null> {
    const call = await DatabaseClient.getInstance().call.findUnique({
      where: { externalId },
      select: {
        id: true,
        title: true,
        callType: true,
        status: true,
        createdByUserId: true,
        externalId: true,
      },
    });
    if (!call) return null;
    return {
      title: call.title,
      callType: call.callType as CallType,
      status: call.status as CallStatus,
      callId: call.id,
      createdByUserId: call.createdByUserId,
      roomName: call.externalId, // LiveKit room name == externalId
    };
  }

  /**
   * Return only the fields needed to decide whether a public invite can route
   * into an authenticated workspace session. Kept separate from
   * getPublicCallInfo so workspaceId is never exposed by the public lobby API.
   */
  async getCallInviteRoutingInfo(externalId: string): Promise<{
    status: CallStatus;
    workspaceId: string;
  } | null> {
    const call = await DatabaseClient.getInstance().call.findUnique({
      where: { externalId },
      select: {
        status: true,
        workspaceId: true,
      },
    });
    if (!call?.workspaceId) return null;
    return {
      status: call.status as CallStatus,
      workspaceId: call.workspaceId,
    };
  }

  /**
   * Create a CallParticipant row for an external lobby request.
   * userId is a random UUID (external users have no real account).
   */
  async createLobbyRequest(params: {
    callId: string;
    displayName: string;
  }): Promise<CallParticipant> {
    const { callId, displayName } = params;
    const id = uuidv4();
    const workspaceId = await this.getCallWorkspaceId(callId);
    const participant = await createLobbyRequestTx(id, callId, workspaceId, displayName);
    queueCallVespaFeed(participant.callId, { source: CallVespaFeedSource.CallRepositoryCreateLobbyRequest });
    return participant;
  }

  /**
   * Return the current response status for an external participant.
   */
  async getLobbyStatus(params: {
    participantId: string;
    callId: string;
  }): Promise<{ response: InvitationResponse | null } | null> {
    const row = await DatabaseClient.getInstance().callParticipant.findFirst({
      where: {
        id: params.participantId,
        callId: params.callId,
        isExternal: true,
      },
      select: { response: true },
    });
    return row as { response: InvitationResponse | null } | null;
  }

  async findExternalParticipantById(params: {
    participantId: string;
    callId: string;
  }): Promise<CallParticipant | null> {
    return await DatabaseClient.getInstance().callParticipant.findFirst({
      where: {
        id: params.participantId,
        callId: params.callId,
        isExternal: true,
      },
    });
  }

  async markExternalParticipantRequested(params: {
    participantId: string;
    displayName?: string;
    respondedAt: Date;
  }): Promise<CallParticipant> {
    const participant = await DatabaseClient.getInstance().callParticipant.update({
      where: { id: params.participantId },
      data: {
        ...(params.displayName && { displayName: params.displayName }),
        response: InvitationResponse.REQUESTED,
        respondedAt: params.respondedAt,
        joinedAt: null,
        leftAt: null,
      },
    });
    queueCallVespaFeed(participant.callId, { source: CallVespaFeedSource.CallRepositoryMarkExternalParticipantRequested });
    return participant;
  }

  async acceptExternalParticipantSession(params: {
    participantId: string;
    displayName?: string;
  }): Promise<CallParticipant> {
    const participant = await DatabaseClient.getInstance().callParticipant.update({
      where: { id: params.participantId },
      data: {
        ...(params.displayName && { displayName: params.displayName }),
        response: InvitationResponse.ACCEPTED,
        joinedAt: null,
      },
    });
    queueCallVespaFeed(participant.callId, { source: CallVespaFeedSource.CallRepositoryAcceptExternalParticipantSession });
    return participant;
  }

  /**
   * Validate that an external participant is ACCEPTED, set joinedAt, and return
   * the participant record with displayName.
   */
  async externalJoin(params: {
    participantId: string;
    callId: string;
  }): Promise<CallParticipant | null> {
    const { participantId, callId } = params;
    const participant = await DatabaseClient.getInstance().callParticipant.findFirst({
      where: {
        id: participantId,
        callId,
        isExternal: true,
        response: InvitationResponse.ACCEPTED,
      },
    });
    if (!participant) return null;

    const updatedParticipant = await externalJoinTx(participantId);
    queueCallVespaFeed(updatedParticipant.callId, { source: CallVespaFeedSource.CallRepositoryExternalJoin });
    return updatedParticipant;
  }

  async updateParticipantMetadata(
    participantId: string,
    metadata: Prisma.InputJsonValue,
  ): Promise<CallParticipant> {
    const participant = await DatabaseClient.getInstance().callParticipant.update({
      where: { id: participantId },
      data: { metadata },
    });
    queueCallVespaFeed(participant.callId, { source: CallVespaFeedSource.CallRepositoryUpdateParticipantMetadata });
    return participant;
  }

  async markParticipantRemovedByHost(params: {
    callId: string;
    participantUserId: string;
    removedAt: Date;
  }): Promise<CallParticipant | null> {
    const participant = await this.findParticipant(params.callId, params.participantUserId);
    if (!participant) return null;

    const metadata =
      participant.metadata && typeof participant.metadata === 'object' && !Array.isArray(participant.metadata)
        ? (participant.metadata as CallParticipantMetadata)
        : {};

    await DatabaseClient.getInstance().callParticipant.update({
      where: { id: participant.id },
      data: {
        response: InvitationResponse.DECLINED,
        leftAt: params.removedAt,
        metadata: { ...metadata, removedByHost: true } as Prisma.InputJsonValue,
      },
    });

    queueCallVespaFeed(params.callId, { source: CallVespaFeedSource.CallRepositoryMarkParticipantRemovedByHost });
    return participant;
  }

  async restoreParticipantState(participant: CallParticipant): Promise<CallParticipant> {
    const restoredParticipant = await DatabaseClient.getInstance().callParticipant.update({
      where: { id: participant.id },
      data: {
        response: participant.response,
        leftAt: participant.leftAt,
        metadata:
          participant.metadata === null
            ? Prisma.DbNull
            : (participant.metadata as Prisma.InputJsonValue),
      },
    });
    queueCallVespaFeed(restoredParticipant.callId, { source: CallVespaFeedSource.CallRepositoryRestoreParticipantState });
    return restoredParticipant;
  }

  /**
   * Reset an external participant's status back to REQUESTED for rejoin.
   * Only works if participant was previously ACCEPTED or LEFT.
   */
  async rejoinLobby(params: {
    participantId: string;
    callId: string;
  }): Promise<CallParticipant | null> {
    const { participantId, callId } = params;
    const participant = await DatabaseClient.getInstance().callParticipant.findFirst({
      where: {
        id: participantId,
        callId,
        isExternal: true,
        response: { in: [InvitationResponse.ACCEPTED, InvitationResponse.LEFT] },
      },
    });
    if (!participant) return null;

    const updatedParticipant = await DatabaseClient.getInstance().callParticipant.update({
      where: { id: participantId },
      data: {
        response: InvitationResponse.REQUESTED,
        respondedAt: null,
        joinedAt: null,
      },
    });
    queueCallVespaFeed(updatedParticipant.callId, { source: CallVespaFeedSource.CallRepositoryRejoinLobby });
    return updatedParticipant;
  }

  /**
   * Return participant info for a call with resolved display names.
   * For external users: uses displayName field.
   * For internal users: looks up user.name from the users table.
   */
  async getCallParticipantsPublic(callId: string): Promise<
    Array<{
      id: string;
      userId: string;
      displayName: string;
      isExternal: boolean;
      response: InvitationResponse | null;
    }>
  > {
    const participants = await DatabaseClient.getInstance().callParticipant.findMany({
      where: {
        callId,
        response: { in: [InvitationResponse.ACCEPTED, InvitationResponse.REQUESTED] },
      },
      select: {
        id: true,
        displayName: true,
        isExternal: true,
        response: true,
        userId: true,
      },
      orderBy: { invitedAt: 'asc' },
    });

    // Resolve names for internal users
    const internalUserIds = participants
      .filter(p => !p.isExternal)
      .map(p => p.userId);

    let userNameMap = new Map<string, string>();
    if (internalUserIds.length > 0) {
      const users = await DatabaseClient.getInstance().user.findMany({
        where: { id: { in: internalUserIds } },
        select: { id: true, name: true, displayName: true },
      });
      userNameMap = new Map(users.map(u => [u.id, u.displayName || u.name]));
    }

    return participants.map(p => ({
      id: p.id,
      userId: p.userId,
      displayName: p.isExternal
        ? (p.displayName || 'Guest')
        : (userNameMap.get(p.userId) || 'Unknown'),
      isExternal: p.isExternal,
      response: p.response as InvitationResponse | null,
    }));
  }

  async findByExternalIdSelect(
    externalId: string,
    select: Prisma.CallSelect,
  ): Promise<Record<string, unknown> | null> {
    return DatabaseClient.getInstance().call.findUnique({
      where: { externalId },
      select,
    }) as Promise<Record<string, unknown> | null>;
  }

  async findExternalCalendarCalls(params: {
    callOrigin: CallOrigin;
    externalIdPrefix: string;
    statusNot?: CallStatus;
    timeRange?: { startsAfter?: Date; startsBefore?: Date };
  }): Promise<Array<{ id: string; externalId: string }>> {
    const where: Prisma.CallWhereInput = {
      callOrigin: params.callOrigin,
      externalId: { startsWith: params.externalIdPrefix },
      ...(params.statusNot && { status: { not: params.statusNot } }),
    };

    if (params.timeRange?.startsAfter || params.timeRange?.startsBefore) {
      where.startsAt = {
        ...(params.timeRange.startsAfter ? { gte: params.timeRange.startsAfter } : {}),
        ...(params.timeRange.startsBefore ? { lte: params.timeRange.startsBefore } : {}),
      };
    }

    return DatabaseClient.getInstance().call.findMany({
      where,
      select: { id: true, externalId: true },
    });
  }

  async cancelByIds(ids: string[]): Promise<number> {
    const result = await DatabaseClient.getInstance().call.updateMany({
      where: { id: { in: ids } },
      data: { status: CallStatus.CANCELLED, updatedAt: new Date() },
    });
    ids.forEach((id) => queueCallVespaFeed(id, { source: CallVespaFeedSource.CallRepositoryCancelByIds }));
    return result.count;
  }

  async upsertExternalCalendarCall(data: {
    externalId: string;
    id: string;
    title: string;
    description?: string;
    createdByUserId: string;
    callType: CallType;
    callOrigin: CallOrigin;
    status: CallStatus;
    roomLink?: string;
    startsAt?: Date;
    endsAt?: Date;
    timezone: string;
    xyneManaged?: boolean;
    /** Self-DM channel backing a Xyne-managed calendar call; null for a plain mirrored (unmanaged) event. */
    channelId: string | null;
    isRecurring: boolean;
    recordingEnabled: boolean;
    startedAt: Date;
    lastActivityAt: Date;
    createdAt: Date;
    updatedAt: Date;
    metadata: Prisma.InputJsonObject;
  }): Promise<void> {
    const existing = await this.findByExternalIdSelect(data.externalId, {
      id: true,
      title: true,
      description: true,
      status: true,
      roomLink: true,
      startsAt: true,
      endsAt: true,
      timezone: true,
      xyneManaged: true,
      channelId: true,
      metadata: true,
    });

    if (!existing) {
      // Xyne-managed calendar calls carry a resolved self-DM channelId; plain
      // mirrored (unmanaged) events have none, so inherit the workspace of the
      // organizer who owns the calendar sync instead of denormalizing from a channel.
      const workspaceId = await resolveWorkspaceIdFromModel(DatabaseClient.getInstance(), 'user', { id: data.createdByUserId });
      await DatabaseClient.getInstance().call.create({ data: { ...data, workspaceId } });
      queueCallVespaFeed(data.id, { source: CallVespaFeedSource.CallRepositoryUpsertExternalCalendarCallCreate });
      return;
    }

    if (!hasExternalCallChanged(existing as unknown as ExistingCallRow, data)) return;

    // Merge (not replace): once a call is activated, its metadata also carries
    // `conversationId`/`systemMessageId` (see activateScheduledCall). A plain
    // overwrite here would wipe those out on the next calendar resync, causing
    // the following join to think it's a fresh call and create a duplicate
    // conversation + "started a call" system message instead of reusing them.
    const mergedMetadata = {
      ...(existing.metadata as Prisma.InputJsonObject ?? {}),
      ...data.metadata,
    };

    const updated = await DatabaseClient.getInstance().call.update({
      where: { externalId: data.externalId },
      data: {
        title: data.title,
        description: data.description,
        status: data.status,
        roomLink: data.roomLink,
        startsAt: data.startsAt,
        endsAt: data.endsAt,
        timezone: data.timezone,
        xyneManaged: data.xyneManaged ?? false,
        channelId: data.channelId,
        metadata: mergedMetadata,
        updatedAt: data.updatedAt,
        lastActivityAt: data.lastActivityAt,
      },
      select: { id: true },
    });
    queueCallVespaFeed(updated.id, { source: CallVespaFeedSource.CallRepositoryUpsertExternalCalendarCallUpdate });
  }

  async cancelByExternalId(externalId: string): Promise<void> {
    const affectedCalls = await DatabaseClient.getInstance().call.findMany({
      where: { externalId, status: { not: CallStatus.CANCELLED } },
      select: { id: true },
    });

    await DatabaseClient.getInstance().call.updateMany({
      where: { externalId, status: { not: CallStatus.CANCELLED } },
      data: { status: CallStatus.CANCELLED, updatedAt: new Date() },
    });

    affectedCalls.forEach(call =>
      queueCallVespaFeed(call.id, { source: CallVespaFeedSource.CallRepositoryCancelByExternalId }),
    );
  }
}

interface ExistingCallRow {
  title: string | null;
  description: string | null;
  status: CallStatus;
  roomLink: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  timezone: string;
  xyneManaged: boolean;
  channelId: string | null;
  metadata: Prisma.JsonValue;
}

function stableStringify(val: unknown): string {
  if (val === undefined) return 'null';
  if (val === null || typeof val !== 'object') return JSON.stringify(val);
  if (Array.isArray(val)) return `[${val.map(stableStringify).join(',')}]`;
  const sorted = Object.keys(val as object)
    .filter(k => (val as Record<string, unknown>)[k] !== undefined)
    .sort()
    .map(k => `${JSON.stringify(k)}:${stableStringify((val as Record<string, unknown>)[k])}`);
  return `{${sorted.join(',')}}`;
}

/** Strips the activation-only keys (`conversationId`, `systemMessageId`) that
 * activateScheduledCall stamps onto call.metadata, so calendar-resync change
 * detection only looks at calendar-derived fields. */
function omitActivationKeys(metadata: Prisma.JsonValue): unknown {
  if (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata)) return metadata;
  const { conversationId, systemMessageId, ...rest } = metadata as Record<string, unknown>;
  return rest;
}

function hasExternalCallChanged(
  existing: ExistingCallRow,
  data: {
    title: string;
    description?: string;
    status: CallStatus;
    roomLink?: string;
    startsAt?: Date;
    endsAt?: Date;
    timezone: string;
    xyneManaged?: boolean;
    channelId: string | null;
    metadata: Prisma.InputJsonObject;
  },
): boolean {
  return (
    existing.title !== (data.title ?? null) ||
    existing.description !== (data.description ?? null) ||
    existing.status !== data.status ||
    existing.roomLink !== (data.roomLink ?? null) ||
    existing.startsAt?.getTime() !== data.startsAt?.getTime() ||
    existing.endsAt?.getTime() !== data.endsAt?.getTime() ||
    existing.timezone !== data.timezone ||
    existing.xyneManaged !== (data.xyneManaged ?? false) ||
    existing.channelId !== data.channelId ||
    // Compare only the calendar-derived subset of existing.metadata: once activated,
    // existing.metadata also carries conversationId/systemMessageId (see
    // activateScheduledCall), which never appear in the freshly computed data.metadata
    // and would otherwise make this always report "changed".
    stableStringify(omitActivationKeys(existing.metadata)) !== stableStringify(data.metadata)
  );
}
