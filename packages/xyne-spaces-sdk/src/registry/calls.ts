/**
 * Calls Operation Registry
 *
 * Call metadata, scheduling, participation, and recordings.
 *
 * Live media is not part of this API. A call row points at a room provisioned on
 * the realtime server via `externalId` and `roomLink`; the operations here
 * create and manage the row, not the room. `initiate` therefore requires the
 * caller to supply an already-provisioned room — see its note.
 */

import { query, mutator } from './types.js';
import { newId, newIdMap, now } from '../core/ids.js';
import type { Call, CallParticipant } from '../types/index.js';

/** Page cursor for the call and recording listings, ordered by start time. */
export interface CallCursor {
  id: string;
  startedAt: number;
}

export const callsOperations = {
  // ----- Reads -----

  /**
   * Calls currently in progress and visible to the user.
   * Maps to: Zero query 'userActiveCalls'
   */
  listActive: query<void, Call[]>('userActiveCalls'),

  /**
   * Calls currently in progress in one channel.
   * Maps to: Zero query 'activeCallsInChannel'
   */
  listActiveInChannel: query<{ channelId: string }, Call[]>('activeCallsInChannel'),

  /**
   * Upcoming scheduled calls the user is invited to.
   * Maps to: Zero query 'userScheduledCallsV2'
   */
  listScheduled: query<void, Call[]>('userScheduledCallsV2'),

  /**
   * Past calls, most recent first.
   * Maps to: Zero query 'userCallHistoryV2'
   */
  listHistory: query<{ limit?: number; start?: CallCursor }, Call[]>(
    'userCallHistoryV2',
    {
      mapArgs: (args) => ({ limit: args.limit ?? 50, start: args.start ?? null }),
    }
  ),

  /**
   * Participants of a call.
   * Maps to: Zero query 'callParticipantsByCallId'
   */
  listParticipants: query<{ callId: string }, CallParticipant[]>(
    'callParticipantsByCallId'
  ),

  /**
   * A recurring call series.
   * Maps to: Zero query 'recurringSeriesById'
   */
  getRecurringSeries: query<{ seriesId: string }, unknown>('recurringSeriesById'),

  /**
   * Summary templates available for call notes.
   * Maps to: Zero query 'summaryTemplates'
   */
  /**
   * One call-summary template by id.
   * Maps to: Zero query 'summaryTemplateById'
   */
  getSummaryTemplate: query<{ templateId: string }, unknown | null>('summaryTemplateById'),

  listSummaryTemplates: query<void, unknown[]>('summaryTemplates', {
    // The query declares an empty object rather than no arguments at all.
    mapArgs: () => ({}),
  }),

  // ----- Recordings -----

  /**
   * Recordings from the user's own calls.
   * Maps to: Zero query 'userRecordings'
   */
  listRecordings: query<{ limit?: number; start?: CallCursor }, Call[]>(
    'userRecordings',
    {
      mapArgs: (args) => ({ limit: args.limit ?? 50, start: args.start ?? null }),
    }
  ),

  /**
   * Standalone recordings the user created.
   * Maps to: Zero query 'createdOatsRecordings'
   */
  listCreatedRecordings: query<{ limit?: number; start?: CallCursor }, Call[]>(
    'createdOatsRecordings',
    {
      mapArgs: (args) => ({ limit: args.limit ?? 50, start: args.start ?? null }),
    }
  ),

  /**
   * Standalone recordings shared with the user.
   * Maps to: Zero query 'sharedOatsRecordings'
   */
  listSharedRecordings: query<{ limit?: number; start?: CallCursor }, Call[]>(
    'sharedOatsRecordings',
    {
      mapArgs: (args) => ({ limit: args.limit ?? 50, start: args.start ?? null }),
    }
  ),

  /**
   * One recording by its room id.
   * Maps to: Zero query 'oatsRecordingByExternalId'
   */
  getRecording: query<{ callId: string }, Call | null>('oatsRecordingByExternalId'),

  /**
   * The thread attached to a call.
   * Maps to: Zero query 'getConversationByCallId'
   */
  getConversation: query<{ callId: string }, unknown>('getConversationByCallId'),

  // ----- Writes -----

  /**
   * Start a call.
   *
   * `externalId` and `roomLink` must refer to a room that already exists on the
   * realtime server — this operation records the call, it does not provision
   * media. Without a real room the call row will exist but nobody can join.
   * Maps to: Zero mutator 'calls.initiate'
   */
  initiate: mutator<
    {
      callId: string;
      channelId: string;
      callType: string;
      externalId: string;
      roomLink: string;
      targetUserIds?: string[];
    },
    void
  >('calls.initiate', {
    mapArgs: (args) => ({
      callId: args.callId,
      channelId: args.channelId,
      callType: args.callType,
      externalId: args.externalId,
      roomLink: args.roomLink,
      timestamp: now(),
      creatorParticipantId: newId(),
      ...(args.targetUserIds
        ? {
            targetUserIds: args.targetUserIds,
            targetParticipantIds: newIdMap(args.targetUserIds),
          }
        : {}),
    }),
  }),

  /**
   * Join a call.
   * Maps to: Zero mutator 'calls.join'
   */
  join: mutator<{ callId: string }, void>('calls.join', {
    mapArgs: (args) => ({
      callId: args.callId,
      timestamp: now(),
      participantId: newId(),
    }),
  }),

  /**
   * Leave a call.
   * Maps to: Zero mutator 'calls.leave'
   */
  leave: mutator<{ callId: string }, void>('calls.leave', {
    mapArgs: (args) => ({ callId: args.callId, timestamp: now() }),
  }),

  /**
   * Decline an incoming call.
   * Maps to: Zero mutator 'calls.reject'
   */
  reject: mutator<{ callId: string }, void>('calls.reject', {
    mapArgs: (args) => ({ callId: args.callId, timestamp: now() }),
  }),

  /**
   * Cancel a call, optionally the whole recurring series.
   * Maps to: Zero mutator 'calls.cancel'
   */
  cancel: mutator<{ callId: string; cancelEntireSeries?: boolean }, void>('calls.cancel', {
    mapArgs: (args) => ({ ...args, timestamp: now() }),
  }),

  /**
   * Invite more people to a call in progress.
   * Maps to: Zero mutator 'calls.invite'
   */
  invite: mutator<{ callId: string; userIds: string[] }, void>('calls.invite', {
    mapArgs: (args) => ({
      callId: args.callId,
      userIds: args.userIds,
      timestamp: now(),
      participantIds: newIdMap(args.userIds),
    }),
  }),

  /**
   * Attach a canvas to a call for shared notes.
   * Maps to: Zero mutator 'calls.linkNotesCanvas'
   */
  linkNotesCanvas: mutator<{ callId: string; notesCanvasId: string }, void>(
    'calls.linkNotesCanvas'
  ),

  /**
   * Bookmark a moment in a call, for the recording timeline.
   *
   * `timestampSeconds` is an offset from the start of the call, not a clock time.
   * Maps to: Zero mutator 'calls.markMoment'
   */
  markMoment: mutator<
    { callId: string; type: string; timestampSeconds: number; text: string },
    void
  >('calls.markMoment'),

  // ----- Lobby -----

  /**
   * Ask to be let into a call you were not invited to.
   * Maps to: Zero mutator 'calls.requestToJoin'
   */
  requestToJoin: mutator<{ callId: string }, void>('calls.requestToJoin', {
    mapArgs: (args) => ({
      callId: args.callId,
      participantId: newId(),
      timestamp: now(),
    }),
  }),

  /**
   * Withdraw a pending join request.
   * Maps to: Zero mutator 'calls.cancelJoinRequest'
   */
  cancelJoinRequest: mutator<{ callId: string }, void>('calls.cancelJoinRequest', {
    mapArgs: (args) => ({ callId: args.callId, timestamp: now() }),
  }),

  /**
   * Admit someone waiting in the lobby.
   * Maps to: Zero mutator 'calls.approveLobbyRequest'
   */
  approveLobbyRequest: mutator<{ callId: string; participantId: string }, void>(
    'calls.approveLobbyRequest'
  ),

  /**
   * Turn away someone waiting in the lobby.
   * Maps to: Zero mutator 'calls.rejectLobbyRequest'
   */
  rejectLobbyRequest: mutator<{ callId: string; participantId: string }, void>(
    'calls.rejectLobbyRequest'
  ),
} as const;
