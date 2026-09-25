import type { Call, RecurringCallSeries } from '@prisma/client';
import {
  CallOrigin,
  CallStatus,
  CallType,
  InvitationResponse,
  MeetingStatus,
  RecurringCallSeriesStatus,
  UserStatus,
  UserType,
} from '@xyne/shared';
import { db } from '@/database/client';
import { repositories } from '@/database/repositories';
import type { CallMetadata } from '@/database/repositories/callRepository';
import { logger } from '@/utils/logger';
import { acquireLock, releaseLock } from '@/utils/distributedLock';
import { isRecording } from '@/utils/callTypeUtils';
import { getUnlinkedTranscript } from '@/utils/transcriptUnlink';
import { vespaQueue } from '@/queues/vespaQueue';
import { fileSchema, SubApp } from '@/vespa/src/types';
import { livekitService } from '@/services/liveKitService';
import { callSideEffectService } from '@/services/callSideEffectService';
import { recurringCallService } from '@/services/recurringCallService';
import { scheduledCallNotificationService } from '@/services/scheduledCallNotificationService';
import { transcriptService } from '@/services/transcriptService';
import { noteTakerTranscriptService } from '@/services/noteTakerTranscriptService';
import { callDocumentService } from '@/services/callDocumentService';
import { recordingSharingService } from '@/services/recordingSharingService';
import { logDetailedSummaryFailed } from '@/services/detailedSummaryFailureLog';
import type { SummaryModelType } from '@/services/callLlmRetry';
import { CallVespaFeedSource, queueCallVespaFeed } from '@/services/callVespaQueue';
import { queueCallCalendarPushMany } from '@/queues/callCalendarPushQueue';
import {
  CALENDAR_CALL_ORIGINS,
  CallAdminError,
  callAdminAccessService,
  type CallAdminAction,
  type CallAdminRelation,
  type CallAdminScope,
} from '@/services/callAdminAccessService';

/**
 * Calls admin panel operations. Every method assumes the controller has already
 * resolved the caller's relation to the call and asserted the action against
 * callAdminAccessService; these only do the work.
 */

export interface CallAdminActor {
  userId: string;
  workspaceId: string;
  scope: CallAdminScope;
}

type SummaryStatus = 'pending' | 'ready' | 'failed';

interface UserSummary {
  id: string;
  name: string | null;
  email: string | null;
}

export interface CallAdminCallRow {
  id: string;
  externalId: string;
  title: string | null;
  type: string;
  origin: string;
  status: string;
  owner: UserSummary;
  startedAt: Date;
  endedAt: Date | null;
  startsAt: Date | null;
  endsAt: Date | null;
  recurringSeriesId: string | null;
  hasTranscript: boolean;
  transcriptUnlinked: boolean;
  summaryStatus: SummaryStatus | null;
  relation: CallAdminRelation;
  allowedActions: CallAdminAction[];
}

export interface CallAdminSeriesRow {
  id: string;
  title: string;
  status: string;
  organizer: UserSummary;
  recurrenceRule: string;
  timezone: string;
  startTime: string;
  endTime: string;
  startsOn: Date;
  endsOn: Date | null;
  nextInstance: { externalId: string; startsAt: Date | null } | null;
  relation: CallAdminRelation;
  allowedActions: CallAdminAction[];
}

export interface ListCallsInput {
  mineOnly: boolean;
  statuses?: CallStatus[];
  callType?: CallType;
  ownerId?: string;
  search?: string;
  summaryStatuses?: SummaryStatus[];
  hasTranscript?: boolean;
  from?: Date;
  to?: Date;
  limit: number;
  cursor?: string;
}

export interface ListSeriesInput {
  mineOnly: boolean;
  statuses?: RecurringCallSeriesStatus[];
  organizerId?: string;
  search?: string;
  limit: number;
  cursor?: string;
}

// Only these origins are mirrored onto the organizer's Google Calendar
// (see callCalendarPushService's PUSHABLE_ORIGINS).
const CALENDAR_PUSH_ORIGINS = new Set<string>([CallOrigin.CHANNEL, CallOrigin.CONVERSATION]);

// A transcript run holds the processing lock for the length of its LLM work, so an
// unlink waits briefly for it rather than interleaving with a half-finished run.
const UNLINK_LOCK_WAIT_MS = 10_000;

// Only reached when a summary run dies without releasing its lock; a normal run releases
// as soon as it settles. Long enough to outlast a slow model, short enough that a wedged
// run doesn't block the retry this panel exists to offer.
const REGENERATE_SUMMARY_LOCK_TTL_SECONDS = 15 * 60;

function encodeCursor(at: Date, id: string): string {
  return Buffer.from(`${at.toISOString()}|${id}`).toString('base64');
}

// Same opaque `iso|id` token as GET /api/calls/recordings.
function decodeCursor(cursor: string): { at: Date; id: string } {
  const decoded = Buffer.from(cursor, 'base64').toString('utf-8');
  const pipeIdx = decoded.lastIndexOf('|');
  const at = new Date(decoded.slice(0, pipeIdx));
  const id = decoded.slice(pipeIdx + 1);
  if (pipeIdx < 0 || isNaN(at.getTime()) || !id) {
    throw new CallAdminError('Invalid cursor', 400);
  }
  return { at, id };
}

function metadataRecord(metadata: Call['metadata']): Record<string, unknown> {
  return metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? { ...(metadata as Record<string, unknown>) }
    : {};
}

function readSummaryStatus(call: Call): SummaryStatus | null {
  const status = metadataRecord(call.metadata).detailedSummaryStatus;
  return status === 'pending' || status === 'ready' || status === 'failed' ? status : null;
}

async function findUserSummaries(userIds: string[]): Promise<Map<string, UserSummary>> {
  if (userIds.length === 0) return new Map();
  const users = await db.user.findMany({
    where: { id: { in: [...new Set(userIds)] } },
    select: { id: true, name: true, email: true },
  });
  return new Map(users.map((user) => [user.id, user]));
}

function userSummary(users: Map<string, UserSummary>, userId: string): UserSummary {
  return users.get(userId) ?? { id: userId, name: null, email: null };
}

/** Who holds the call's mirrored Google Calendar event, if it has been pushed. */
function pushedOrganizerId(metadata: Call['metadata']): string | null {
  return (metadata as CallMetadata | null)?.googleCalendarPush?.organizerUserId ?? null;
}

async function hasActiveGoogleCalendar(userId: string): Promise<boolean> {
  const source = await repositories.externalSources.findCalendarSourceByOwner(userId, 'GOOGLE');
  return source?.isActive === true;
}

class CallAdminService {
  async listCalls(
    actor: CallAdminActor,
    input: ListCallsInput,
  ): Promise<{ rows: CallAdminCallRow[]; nextCursor: string | null }> {
    const cursor = input.cursor ? decodeCursor(input.cursor) : undefined;
    const { calls, nextCursor } = await repositories.calls.findForAdminList(
      {
        workspaceId: actor.workspaceId,
        ...(input.mineOnly ? { participantUserId: actor.userId } : {}),
        statuses: input.statuses,
        callType: input.callType,
        ownerId: input.ownerId,
        search: input.search,
        summaryStatuses: input.summaryStatuses,
        hasTranscript: input.hasTranscript,
        from: input.from,
        to: input.to,
      },
      { limit: input.limit, ...(cursor ? { cursor: { startedAt: cursor.at, id: cursor.id } } : {}) },
    );

    const owners = await findUserSummaries(calls.map((call) => call.createdByUserId));

    const rows = calls.map((call): CallAdminCallRow => {
      // The SELF list is already narrowed to created-or-participating calls, so a
      // row the caller didn't create is one they participate in.
      const relation: CallAdminRelation =
        actor.scope === 'ORG' ? 'ADMIN' : call.createdByUserId === actor.userId ? 'CREATOR' : 'PARTICIPANT';
      return {
        id: call.id,
        externalId: call.externalId,
        title: call.title,
        type: call.callType,
        origin: call.callOrigin,
        status: call.status,
        owner: userSummary(owners, call.createdByUserId),
        startedAt: call.startedAt,
        endedAt: call.endedAt,
        startsAt: call.startsAt,
        endsAt: call.endsAt,
        recurringSeriesId: call.recurringSeriesId,
        hasTranscript: !!call.transcript,
        transcriptUnlinked: getUnlinkedTranscript(call) !== null,
        summaryStatus: readSummaryStatus(call),
        relation,
        allowedActions: callAdminAccessService.allowedActions(relation, call),
      };
    });

    return {
      rows,
      nextCursor: nextCursor ? encodeCursor(nextCursor.startedAt, nextCursor.id) : null,
    };
  }

  async listSeries(
    actor: CallAdminActor,
    input: ListSeriesInput,
  ): Promise<{ rows: CallAdminSeriesRow[]; nextCursor: string | null }> {
    const cursor = input.cursor ? decodeCursor(input.cursor) : undefined;
    const { series, nextCursor } = await repositories.recurringCallSeries.findForAdminList(
      {
        workspaceId: actor.workspaceId,
        ...(input.mineOnly ? { participantUserId: actor.userId } : {}),
        statuses: input.statuses,
        organizerId: input.organizerId,
        search: input.search,
      },
      { limit: input.limit, ...(cursor ? { cursor: { createdAt: cursor.at, id: cursor.id } } : {}) },
    );

    const [organizers, nextInstances] = await Promise.all([
      findUserSummaries(series.map((row) => row.organizerId)),
      repositories.scheduledCalls.findNextScheduledInstancesBySeriesIds(
        series.map((row) => row.id),
        new Date(),
      ),
    ]);
    const nextBySeries = new Map(
      nextInstances.map((instance) => [instance.recurringSeriesId, instance]),
    );

    const rows = series.map((row): CallAdminSeriesRow => {
      const relation: CallAdminRelation =
        actor.scope === 'ORG' ? 'ADMIN' : row.organizerId === actor.userId ? 'CREATOR' : 'PARTICIPANT';
      const next = nextBySeries.get(row.id);
      return {
        id: row.id,
        title: row.title,
        status: row.status,
        organizer: userSummary(organizers, row.organizerId),
        recurrenceRule: row.recurrenceRule,
        timezone: row.timezone,
        startTime: row.startTime,
        endTime: row.endTime,
        startsOn: row.startsOn,
        endsOn: row.endsOn,
        nextInstance: next ? { externalId: next.externalId, startsAt: next.startsAt } : null,
        relation,
        allowedActions: callAdminAccessService.allowedSeriesActions(relation, row),
      };
    });

    return {
      rows,
      nextCursor: nextCursor ? encodeCursor(nextCursor.createdAt, nextCursor.id) : null,
    };
  }

  /** Load a call in the caller's workspace with their relation to it; 404 when absent. */
  async resolveCall(
    actor: CallAdminActor,
    externalId: string,
  ): Promise<{ call: Call; relation: CallAdminRelation }> {
    const call = await repositories.calls.findByExternalId(externalId);
    if (!call || call.workspaceId !== actor.workspaceId) {
      throw new CallAdminError('Call not found', 404);
    }
    const relation = await callAdminAccessService.getCallRelation(call, actor.userId, actor.scope);
    return { call, relation };
  }

  async resolveSeries(
    actor: CallAdminActor,
    seriesId: string,
  ): Promise<{ series: RecurringCallSeries; relation: CallAdminRelation }> {
    const series = await repositories.recurringCallSeries.findById(seriesId);
    if (!series || series.workspaceId !== actor.workspaceId) {
      throw new CallAdminError('Series not found', 404);
    }
    const relation = await callAdminAccessService.getSeriesRelation(series, actor.userId, actor.scope);
    return { series, relation };
  }

  async cancelSeries(series: RecurringCallSeries): Promise<{ cancelledCalls: number }> {
    return recurringCallService.cancelSeries(series.id);
  }

  async cancelCall(call: Call): Promise<void> {
    await recurringCallService.cancelScheduledCall(call, 'callAdmin.cancelCall');
  }

  /**
   * End a call stuck in ACTIVE/IN_PROGRESS after its LiveKit room went away. A room
   * that still exists means people may be in it, so that is refused rather than
   * ended out from under them.
   */
  async forceEnd(call: Call): Promise<void> {
    const rooms = await livekitService.listRooms([call.externalId]);
    const room = rooms.find((candidate) => candidate.name === call.externalId);
    if (room) {
      throw new CallAdminError('The call room is still live', 409, {
        roomExists: true,
        numParticipants: room.numParticipants ?? 0,
      });
    }
    await callSideEffectService.endOrphanedCall(call, 'admin_force_end');
  }

  /**
   * Detach the transcript from the call without deleting it from storage: clear
   * Call.transcript, remember the old pointer in metadata.unlinkedTranscript (which
   * every processing path honours), drop the thread attachments and the search doc.
   * Takes the transcript-processing lock so it can't interleave with a run that
   * would re-attach the transcript as it finishes.
   */
  async unlinkTranscript(call: Call, actorUserId: string): Promise<void> {
    const lockKey = isRecording(call)
      ? `lock:note-taker-transcript-processing:${call.externalId}`
      : `lock:transcript-processing:${call.externalId}`;
    const lockHandle = await acquireLock(lockKey, {
      ttlSeconds: 60,
      waitTimeoutMs: UNLINK_LOCK_WAIT_MS,
    });
    if (!lockHandle) {
      throw new CallAdminError('This transcript is being processed right now. Try again in a minute.', 409);
    }

    try {
      const current = await repositories.calls.findById(call.id);
      if (!current?.transcript) {
        throw new CallAdminError('This call has no linked transcript', 409);
      }

      const metadata = metadataRecord(current.metadata);
      metadata.unlinkedTranscript = {
        url: current.transcript,
        by: actorUserId,
        at: new Date().toISOString(),
      };
      // The note-taker path dedups on this count; left in place, a later reprocess
      // would see the same entries and skip.
      if (isRecording(current)) delete metadata.transcriptEntryCount;

      await repositories.calls.update(current.id, { transcript: null, metadata });

      // Recordings keep their transcript on the Call only; channel calls also post it
      // to the thread as attachments.
      if (!isRecording(current)) {
        const messageIds = await repositories.messageAttachments.deleteTranscriptsByCallId(current.externalId);
        for (const messageId of messageIds) {
          if ((await repositories.messageAttachments.countByMessageId(messageId)) === 0) {
            await repositories.messages.update(messageId, { hasAttachment: false });
          }
        }
      }
    } finally {
      await releaseLock(lockHandle);
    }

    try {
      await vespaQueue.addJob({
        schema: fileSchema,
        jobType: 'delete',
        docId: call.id,
        app: SubApp.TRANSCRIPT,
        workspaceId: call.workspaceId,
      });
    } catch (vespaError) {
      logger.error(`[${call.externalId}] transcript_vespa_delete_queue_failed`, { error: vespaError });
    }
  }

  /**
   * Clear the unlink marker and rebuild the transcript from storage in the
   * background, through the same reconcile the room_finished webhook uses.
   */
  async reprocessTranscript(call: Call): Promise<void> {
    const current = (await repositories.calls.findById(call.id)) ?? call;
    const metadata = metadataRecord(current.metadata);
    const hadMarker = 'unlinkedTranscript' in metadata;
    delete metadata.unlinkedTranscript;
    // With no transcript linked, a stored note-taker entry count only blocks the rerun.
    const hadEntryCount = isRecording(current) && 'transcriptEntryCount' in metadata;
    if (hadEntryCount) delete metadata.transcriptEntryCount;
    if (hadMarker || hadEntryCount) {
      await repositories.calls.update(current.id, { metadata });
    }

    const reconcile = isRecording(current)
      ? noteTakerTranscriptService.reconcileTranscript(current.externalId)
      : transcriptService.reconcileTranscriptFromGcs(current.externalId);
    void reconcile.catch((error) => {
      logger.error(`[${current.externalId}] admin_reprocess_transcript_failed`, { error });
    });
  }

  /**
   * Start a detailed-summary run and return once it is marked pending; the stale
   * 'pending' sweep in CallValidationWorker covers a run lost to a restart. This is
   * also the retry for a stuck or failed summary.
   */
  async regenerateSummary(
    call: Call,
    input: { templateId?: string; modelType?: SummaryModelType },
  ): Promise<void> {
    // The run is awaited nowhere, so the 202 comes back long before it ends and a second
    // click would start a second LLM run over the same call. Deliberately a lock and not a
    // `detailedSummaryStatus === 'pending'` check: a summary stuck in 'pending' is one of
    // the things this panel exists to repair, and the stale sweep only frees it an hour
    // later, so refusing on status would disable the retry exactly when it is needed.
    const lockHandle = await acquireLock(
      `lock:call-admin-regenerate-summary:${call.externalId}`,
      { ttlSeconds: REGENERATE_SUMMARY_LOCK_TTL_SECONDS },
    );
    if (!lockHandle) {
      throw new CallAdminError('A summary is already being generated for this call', 409);
    }

    // Once a run owns the lock it releases it when it settles; until then this method
    // still holds it and must hand it back on every path that starts nothing.
    let handedOff = false;
    try {
      if (isRecording(call)) {
        await noteTakerTranscriptService.markDetailedSummaryStatus(call, 'pending');
        handedOff = true;
        void noteTakerTranscriptService
          .regenerateSummary(call, input.templateId ?? call.summaryTemplateId ?? undefined, input.modelType)
          .catch((error) => {
            logger.error(`[${call.externalId}] admin_regenerate_summary_failed`, { error });
          })
          .finally(() => {
            void releaseLock(lockHandle);
          });
        return;
      }

      const callMessage = await repositories.messages.findHeadMessageByCallId(call.externalId);
      if (!callMessage) {
        throw new CallAdminError('This call has no thread to post the summary to', 409);
      }
      await noteTakerTranscriptService.markDetailedSummaryStatus(call, 'pending');
      handedOff = true;
      void this.generateThreadSummary(call, callMessage.conversationId).finally(() => {
        void releaseLock(lockHandle);
      });
    } finally {
      if (!handedOff) await releaseLock(lockHandle);
    }
  }

  /**
   * Channel calls post their detailed summary into the call thread; that path has no
   * status bookkeeping of its own, so it is tracked here to match recordings.
   */
  private async generateThreadSummary(call: Call, conversationId: string): Promise<void> {
    try {
      const transcript = await transcriptService.getTranscriptContent(call.externalId);
      if (!transcript) {
        logDetailedSummaryFailed(call.externalId, 'no_transcript');
        await noteTakerTranscriptService.markDetailedSummaryStatus(call, 'failed');
        return;
      }
      // Logs its own failure exits, so only the status is recorded here.
      const result = await callDocumentService.generateAndPostDetailedSummary(
        call.externalId,
        transcript,
        conversationId,
      );
      await noteTakerTranscriptService.markDetailedSummaryStatus(call, result.success ? 'ready' : 'failed');
    } catch (error) {
      logDetailedSummaryFailed(call.externalId, 'unexpected_error', error);
      await noteTakerTranscriptService.markDetailedSummaryStatus(call, 'failed');
    }
  }

  /**
   * Re-index a call's transcript document (same job shape as the indexing that follows
   * transcript processing). Best-effort: a search doc that missed an update must not
   * fail the operation that caused it.
   */
  private async refeedTranscriptDoc(
    callId: string,
    userId: string,
    workspaceId: string,
  ): Promise<void> {
    try {
      await vespaQueue.addJob({
        schema: fileSchema,
        jobType: 'feed',
        docId: callId,
        userId,
        app: SubApp.TRANSCRIPT,
        workspaceId,
      });
    } catch (vespaError) {
      logger.error(`[${callId}] transcript_vespa_feed_queue_failed`, { error: vespaError });
    }
  }

  /**
   * Move a call (and optionally its whole series: the series organizer plus every
   * future SCHEDULED instance) to another active member of the workspace. Returns a
   * warning when the calendar push cannot follow, because the push runs on the new
   * organizer's own Google connection.
   */
  async transferOwnership(
    call: Call,
    newOwnerUserId: string,
    applyToSeries: boolean,
  ): Promise<{ transferredCallIds: string[]; warning: string | null }> {
    const seriesId = applyToSeries ? call.recurringSeriesId : null;
    if (applyToSeries && !seriesId) {
      throw new CallAdminError('This call is not part of a recurring series', 400);
    }
    if (newOwnerUserId === call.createdByUserId && !seriesId) {
      throw new CallAdminError('That user already owns this call', 409);
    }

    const newOwner = await db.user.findFirst({
      where: {
        id: newOwnerUserId,
        workspaceId: call.workspaceId,
        leftAt: null,
        status: UserStatus.ACTIVE,
        userType: UserType.USER,
      },
      select: { id: true },
    });
    if (!newOwner) {
      throw new CallAdminError('The new owner must be an active member of this workspace', 400);
    }

    const transferred = await db.$transaction(
      async (tx) => {
        const seriesCalls: Array<
          Pick<Call, 'id' | 'status' | 'callOrigin' | 'metadata' | 'transcript'>
        > = [];
        if (seriesId) {
          await repositories.recurringCallSeries.update(seriesId, { organizerId: newOwnerUserId }, tx);
          const now = new Date();
          await tx.recurringCallParticipant.upsert({
            where: { recurringSeriesId_userId: { recurringSeriesId: seriesId, userId: newOwnerUserId } },
            create: {
              recurringSeriesId: seriesId,
              workspaceId: call.workspaceId,
              userId: newOwnerUserId,
              invitedBy: call.createdByUserId,
              invitedAt: now,
              response: InvitationResponse.INVITED,
              meetingStatus: MeetingStatus.ACCEPTED,
              respondedAt: now,
              isExternal: false,
            },
            update: { meetingStatus: MeetingStatus.ACCEPTED, respondedAt: now },
          });
          seriesCalls.push(
            ...(await tx.call.findMany({
              where: {
                recurringSeriesId: seriesId,
                status: CallStatus.SCHEDULED,
                id: { not: call.id },
                // Defensive: no calendar-origin call carries a recurringSeriesId today
                // (they sync with a plain `isRecurring` flag), but if one ever did, the
                // sweep must honour the same rule assertApplicable puts on the named call.
                callOrigin: { notIn: [...CALENDAR_CALL_ORIGINS] },
              },
              select: { id: true, status: true, callOrigin: true, metadata: true, transcript: true },
            })),
          );
        }

        const calls = [
          {
            id: call.id,
            status: call.status,
            callOrigin: call.callOrigin,
            metadata: call.metadata,
            transcript: call.transcript,
          },
          ...seriesCalls,
        ];
        await repositories.calls.transferOwnership(
          calls.map((transferredCall) => transferredCall.id),
          newOwnerUserId,
          tx,
        );
        // Recording access ignores participants, so the old owner needs an explicit share.
        if (isRecording(call) && call.createdByUserId !== newOwnerUserId) {
          await recordingSharingService.grantPreviousOwnerView(tx, call.id, call.createdByUserId);
        }
        return calls;
      },
      // A daily series keeps ~60 future instances, each a few writes.
      { timeout: 60_000 },
    );

    for (const transferredCall of transferred) {
      queueCallVespaFeed(transferredCall.id, { source: CallVespaFeedSource.CallAdminPanel });
      // The transcript has a search doc of its own, separate from the call's, and the
      // call feed above does not touch it. It takes both `ownerId`/`createdBy` and its
      // `permissions` list from the call, so left alone it would keep the previous owner
      // and leave the new one unable to find the transcript they now own.
      if (transferredCall.transcript) {
        await this.refeedTranscriptDoc(transferredCall.id, newOwnerUserId, call.workspaceId);
      }
      if (transferredCall.status === CallStatus.SCHEDULED) {
        await scheduledCallNotificationService.addReminderRecipient(transferredCall.id, newOwnerUserId);
      }
    }

    const pushed = transferred.filter(
      (transferredCall) =>
        transferredCall.status === CallStatus.SCHEDULED &&
        CALENDAR_PUSH_ORIGINS.has(transferredCall.callOrigin),
    );

    let warning: string | null = null;
    if (pushed.length > 0) {
      // The push job moves each invite from the previous owner's calendar to the
      // new owner's (callCalendarPushService). Warn when either side can't take part.
      queueCallCalendarPushMany(
        pushed.map((transferredCall) => transferredCall.id),
        'callAdmin.transferOwnership',
      );

      const previousOrganizers = new Set(
        pushed
          .map((transferredCall) => pushedOrganizerId(transferredCall.metadata))
          .filter((organizerId): organizerId is string => !!organizerId && organizerId !== newOwnerUserId),
      );

      if (!(await hasActiveGoogleCalendar(newOwnerUserId))) {
        warning =
          previousOrganizers.size > 0
            ? "The new owner has not connected Google Calendar, so the invite stays on the previous owner's calendar and won't pick up later changes."
            : 'The new owner has not connected Google Calendar, so the call was not added to their calendar.';
      } else {
        for (const organizerId of previousOrganizers) {
          if (!(await hasActiveGoogleCalendar(organizerId))) {
            warning =
              "The previous owner's Google Calendar is disconnected, so their copy of the invite couldn't be removed. Attendees may see the meeting twice until it is deleted in Google Calendar.";
            break;
          }
        }
      }
    }

    return { transferredCallIds: transferred.map((transferredCall) => transferredCall.id), warning };
  }
}

export const callAdminService = new CallAdminService();
