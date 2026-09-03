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

import { op } from './types.js';
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
   */
  listActive: op<void, Call[]>('calls.listActive', 'query'),

  /**
   * Calls currently in progress in one channel.
   */
  listActiveInChannel: op<{ channelId: string }, Call[]>('calls.listActiveInChannel', 'query'),

  /**
   * Upcoming scheduled calls the user is invited to.
   */
  listScheduled: op<void, Call[]>('calls.listScheduled', 'query'),

  /**
   * Past calls, most recent first.
   */
  listHistory: op<{ limit?: number; start?: CallCursor }, Call[]>('calls.listHistory', 'query'),

  /**
   * Participants of a call.
   */
  listParticipants: op<{ callId: string }, CallParticipant[]>('calls.listParticipants', 'query'),

  /**
   * A recurring call series.
   */
  getRecurringSeries: op<{ seriesId: string }, unknown>('calls.getRecurringSeries', 'query'),

  /**
   * Summary templates available for call notes.
   */
  /**
   * One call-summary template by id.
   */
  getSummaryTemplate: op<{ templateId: string }, unknown | null>('calls.getSummaryTemplate', 'query'),

  listSummaryTemplates: op<void, unknown[]>('calls.listSummaryTemplates', 'query'),

  // ----- Recordings -----

  /**
   * Recordings from the user's own calls.
   */
  listRecordings: op<{ limit?: number; start?: CallCursor }, Call[]>('calls.listRecordings', 'query'),

  /**
   * Standalone recordings the user created.
   */
  listCreatedRecordings: op<{ limit?: number; start?: CallCursor; participantId?: string }, Call[]>('calls.listCreatedRecordings', 'query'),

  /**
   * Standalone recordings shared with the user.
   */
  listSharedRecordings: op<{ limit?: number; start?: CallCursor; participantId?: string }, Call[]>('calls.listSharedRecordings', 'query'),

  /**
   * One recording by its room id.
   */
  getRecording: op<{ callId: string }, Call | null>('calls.getRecording', 'query'),

  /**
   * The thread attached to a call.
   */
  getConversation: op<{ callId: string }, unknown>('calls.getConversation', 'query'),

  // ----- Writes -----

  /**
   * Start a call.
   *
   * `externalId` and `roomLink` must refer to a room that already exists on the
   * realtime server — this operation records the call, it does not provision
   * media. Without a real room the call row will exist but nobody can join.
   */
  initiate: op<{
      callId: string;
      channelId: string;
      callType: string;
      externalId: string;
      roomLink: string;
      targetUserIds?: string[];
    }, void>('calls.initiate', 'mutator'),

  /**
   * Join a call.
   */
  join: op<{ callId: string }, void>('calls.join', 'mutator'),

  /**
   * Leave a call.
   */
  leave: op<{ callId: string }, void>('calls.leave', 'mutator'),

  /**
   * Decline an incoming call.
   */
  reject: op<{ callId: string }, void>('calls.reject', 'mutator'),

  /**
   * Cancel a call, optionally the whole recurring series.
   */
  cancel: op<{ callId: string; cancelEntireSeries?: boolean }, void>('calls.cancel', 'mutator'),

  /**
   * Invite more people to a call in progress.
   */
  invite: op<{ callId: string; userIds: string[] }, void>('calls.invite', 'mutator'),

  /**
   * Attach a canvas to a call for shared notes.
   */
  linkNotesCanvas: op<{ callId: string; notesCanvasId: string }, void>('calls.linkNotesCanvas', 'mutator'),

  /**
   * Bookmark a moment in a call, for the recording timeline.
   *
   * `timestampSeconds` is an offset from the start of the call, not a clock time.
   */
  markMoment: op<{ callId: string; type: string; timestampSeconds: number; text: string }, void>('calls.markMoment', 'mutator'),

  // ----- Lobby -----

  /**
   * Ask to be let into a call you were not invited to.
   */
  requestToJoin: op<{ callId: string }, void>('calls.requestToJoin', 'mutator'),

  /**
   * Withdraw a pending join request.
   */
  cancelJoinRequest: op<{ callId: string }, void>('calls.cancelJoinRequest', 'mutator'),

  /**
   * Admit someone waiting in the lobby.
   */
  approveLobbyRequest: op<{ callId: string; participantId: string }, void>('calls.approveLobbyRequest', 'mutator'),

  /**
   * Turn away someone waiting in the lobby.
   */
  rejectLobbyRequest: op<{ callId: string; participantId: string }, void>('calls.rejectLobbyRequest', 'mutator'),
} as const;
