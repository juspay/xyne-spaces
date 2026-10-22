import { CallType } from '@xyne/shared';
import { db } from '@/database/client';
import { withWorkspaceScope } from '@/database/tenant/context';
import { vespaQueue } from '@/queues/vespaQueue';
import { logger } from '@/utils/logger';
import { callSchema, fileSchema, SubApp } from '@/vespa/src/types';

export enum CallVespaFeedSource {
  CallControllerCancelOtherActiveJoinRequests = 'CallController.cancelOtherActiveJoinRequests',
  CallControllerInitiateCallRemovedUserExistingRoom = 'CallController.initiateCall.removedUserExistingRoom',
  CallControllerInitiateCallClearRemovedByHostExistingRoom = 'CallController.initiateCall.clearRemovedByHostExistingRoom',
  CallControllerJoinCallRemovedUserReknock = 'CallController.joinCall.removedUserReknock',
  CallControllerJoinCallClearRemovedByHost = 'CallController.joinCall.clearRemovedByHost',
  CallControllerInviteParticipantsReinvite = 'CallController.inviteParticipants.reinvite',
  CallControllerDeclineCallInvitation = 'CallController.declineCallInvitation',
  RecurringCallServiceCreateInstance = 'RecurringCallService.createInstance',
  RecurringCallServiceRegenerateFutureInstancesCancelledInstance = 'RecurringCallService.regenerateFutureInstances.cancelledInstance',
  ScheduleCallControllerCreateScheduledCall = 'ScheduleCallController.createScheduledCall',
  ScheduleCallControllerUpdateRecurringSeriesTimeChanged = 'ScheduleCallController.updateRecurringSeries.timeChanged',
  ScheduleCallControllerUpdateRecurringSeriesCascade = 'ScheduleCallController.updateRecurringSeries.cascade',
  CallRepositorySetRecordingUrl = 'CallRepository.setRecordingUrl',
  CallRepositoryUpdate = 'CallRepository.update',
  CallRepositoryCreateParticipant = 'CallRepository.createParticipant',
  CallRepositoryUpdateParticipantMeetingStatus = 'CallRepository.updateParticipantMeetingStatus',
  CallRepositoryUpdateRecurringSeriesMeetingStatus = 'CallRepository.updateRecurringSeriesMeetingStatus',
  CallRepositoryMarkAllParticipantsAsLeft = 'CallRepository.markAllParticipantsAsLeft',
  CallRepositoryUpdateParticipantResponse = 'CallRepository.updateParticipantResponse',
  CallRepositoryMarkParticipantAsLeft = 'CallRepository.markParticipantAsLeft',
  CallRepositoryEndCall = 'CallRepository.endCall',
  CallRepositoryHandleParticipantLeaving = 'CallRepository.handleParticipantLeaving',
  CallRepositoryHandleRoomFinished = 'CallRepository.handleRoomFinished',
  CallRepositoryActivateScheduledCall = 'CallRepository.activateScheduledCall',
  CallRepositoryCreateCallWithParticipantsAndMessage = 'CallRepository.createCallWithParticipantsAndMessage',
  CallRepositoryUpdateScheduledCall = 'CallRepository.updateScheduledCall',
  CallRepositoryCreateLobbyRequest = 'CallRepository.createLobbyRequest',
  CallRepositoryMarkExternalParticipantRequested = 'CallRepository.markExternalParticipantRequested',
  CallRepositoryAcceptExternalParticipantSession = 'CallRepository.acceptExternalParticipantSession',
  CallRepositoryExternalJoin = 'CallRepository.externalJoin',
  CallRepositoryUpdateParticipantMetadata = 'CallRepository.updateParticipantMetadata',
  CallRepositoryMarkParticipantRemovedByHost = 'CallRepository.markParticipantRemovedByHost',
  CallRepositoryRestoreParticipantState = 'CallRepository.restoreParticipantState',
  CallRepositoryRejoinLobby = 'CallRepository.rejoinLobby',
  CallRepositoryCancelByIds = 'CallRepository.cancelByIds',
  CallRepositoryUpsertExternalCalendarCallCreate = 'CallRepository.upsertExternalCalendarCall.create',
  CallRepositoryUpsertExternalCalendarCallUpdate = 'CallRepository.upsertExternalCalendarCall.update',
  CallRepositoryCancelByExternalId = 'CallRepository.cancelByExternalId',
  ScheduledCallRepositoryCancelCall = 'ScheduledCallRepository.cancelCall',
  RecurringCallServiceCancelSeries = 'RecurringCallService.cancelSeries',
  RecurringCallServiceDeleteSeries = 'RecurringCallService.deleteSeries',
  CallAdminPanel = 'CallAdminPanel',
}

export const queueCallVespaFeed = (
  callId?: string | null,
  context?: (Record<string, unknown> & { source?: CallVespaFeedSource }),
): void => {
  if (!callId) return;

  vespaQueue.addJob({
    schema: callSchema,
    jobType: 'feed',
    docId: callId,
  }).catch((error) => {
    logger.error('[CallVespaQueue] Failed to queue call Vespa feed:', {
      callId,
      context,
      errorMessage: error,
    });
  });
};

export const queueCallVespaDelete = (
  callId?: string | null,
  context?: Record<string, unknown>,
): void => {
  if (!callId) return;

  vespaQueue.addJob({
    schema: callSchema,
    jobType: 'delete',
    docId: callId,
  }).catch((error) => {
    logger.error('[CallVespaQueue] Failed to queue call Vespa delete:', {
      callId,
      context,
      errorMessage: error,
    });
  });
};

type TranscriptDocCall = { id: string; workspaceId?: string | null };

/** Transcript doc fields a field-scoped update may refresh (vespaFileWorker's TRANSCRIPT fast path). */
export type TranscriptDocField = 'fileName' | 'permissions' | 'isPrivate' | 'labels';

/**
 * Queue one job for a call's transcript doc (file schema, subApp TRANSCRIPT, docId = call id).
 * Never throws: a failure is logged and reported as `false`, so indexing can't undo the
 * operation that triggered it.
 */
const queueTranscriptDocJob = async (
  call: TranscriptDocCall,
  job: {
    jobType: 'feed' | 'update' | 'delete';
    fields?: TranscriptDocField[];
    userId?: string;
    nameOnly?: boolean;
  },
): Promise<boolean> => {
  try {
    await vespaQueue.addJob({
      schema: fileSchema,
      docId: call.id,
      app: SubApp.TRANSCRIPT,
      ...job,
      ...(call.workspaceId ? { workspaceId: call.workspaceId } : {}),
    });
    return true;
  } catch (error) {
    logger.error('[CallVespaQueue] Failed to queue transcript doc job:', {
      callId: call.id,
      jobType: job.jobType,
      fields: job.fields,
      errorMessage: error,
    });
    return false;
  }
};

/**
 * A call's transcript is a separate Vespa file doc (docId = call.id) carrying its title, and
 * for a recording also its share ACL and confirmed label slugs. Editing any of those only
 * re-feeds the call doc, so push the change to the transcript doc too — field-scoped, so the
 * transcript isn't re-embedded. Resolves `false` only when the job could not be queued.
 */
export const queueTranscriptFieldsUpdate = async (
  call: TranscriptDocCall & { callType?: string | null; transcript?: string | null },
  fields: TranscriptDocField[],
): Promise<boolean> => {
  if (fields.length === 0) return true;
  // Every recording has a transcript doc (see queueRecordingTranscriptFeed); any other
  // call has one only once its transcript exists.
  if (call.callType !== CallType.HEADLESS && !call.transcript) return true;
  // nameOnly: none of these fields need the transcript, so the worker skips downloading it.
  return queueTranscriptDocJob(call, { jobType: 'update', fields, nameOnly: true });
};

/**
 * Refresh a recording's transcript doc fields from just its id or externalId — for callers
 * that hold no Call row (share commands, tag edits). Looked up under workspace scope: the
 * actor may no longer be able to read the recording (after a self-revoke, say) and the
 * refresh must still run. Non-recordings are skipped; failures are logged, never thrown.
 */
export const queueRecordingTranscriptRefresh = async (
  where: { id: string } | { externalId: string },
  fields: TranscriptDocField[],
): Promise<void> => {
  try {
    const call = await withWorkspaceScope(() =>
      db.call.findUnique({ where, select: { id: true, workspaceId: true, callType: true } }),
    );
    if (!call || call.callType !== CallType.HEADLESS) return;
    await queueTranscriptFieldsUpdate(call, fields);
  } catch (error) {
    logger.error('[CallVespaQueue] Failed to look up recording for transcript refresh:', {
      ...where,
      fields,
      errorMessage: error,
    });
  }
};

/**
 * Index a recording's transcript doc as soon as the recording ends, before (or without) a
 * transcript: recordings search reads only transcript docs, so a recording whose
 * transcript is late or never comes would otherwise be unfindable by title, owner or label.
 * mapTranscript leaves `chunks` empty when there is no transcript; the feed that follows
 * transcript processing (noteTakerTranscriptService.queueVespaIndexing) fills them in.
 */
export const queueRecordingTranscriptFeed = (
  call: TranscriptDocCall & { createdByUserId: string },
): Promise<boolean> =>
  queueTranscriptDocJob(call, { jobType: 'feed', userId: call.createdByUserId });

/** Remove a deleted recording's transcript doc; deleting the call only drops the call doc. */
export const queueRecordingTranscriptDelete = (call: TranscriptDocCall): Promise<boolean> =>
  queueTranscriptDocJob(call, { jobType: 'delete' });
