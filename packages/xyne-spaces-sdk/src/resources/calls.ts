/**
 * Calls Resource
 *
 * Call metadata, scheduling, participation, lobby control, and recordings.
 *
 * Live audio and video are handled by the realtime server, not this API. These
 * methods manage the call record around a room that exists elsewhere.
 */

import { Resource } from './base.js';
import { callsOperations, type CallCursor } from '../registry/calls.js';
import { newId } from '../core/ids.js';
import type { Call, CallParticipant } from '../types/index.js';

export class CallsResource extends Resource {
  /**
   * List calls currently in progress.
   *
   * @example
   * const live = await sdk.calls.listActive();
   */
  listActive(): Promise<Call[]> {
    return this.call(callsOperations.listActive, undefined);
  }

  /** List calls in progress in one channel. */
  listActiveInChannel(channelId: string): Promise<Call[]> {
    return this.call(callsOperations.listActiveInChannel, { channelId });
  }

  /** List upcoming scheduled calls. */
  listScheduled(): Promise<Call[]> {
    return this.call(callsOperations.listScheduled, undefined);
  }

  /**
   * List past calls, most recent first.
   *
   * @param options.start - Cursor from the last item of the previous page
   */
  listHistory(options?: { limit?: number; start?: CallCursor }): Promise<Call[]> {
    return this.call(callsOperations.listHistory, options ?? {});
  }

  /** List a call's participants. */
  listParticipants(callId: string): Promise<CallParticipant[]> {
    return this.call(callsOperations.listParticipants, { callId });
  }

  /** Get a recurring call series. */
  getRecurringSeries(seriesId: string): Promise<unknown> {
    return this.call(callsOperations.getRecurringSeries, { seriesId });
  }

  /** List the summary templates available for call notes. */
  /** Get one call-summary template by id. */
  getSummaryTemplate(templateId: string): Promise<unknown | null> {
    return this.call(callsOperations.getSummaryTemplate, { templateId });
  }

  listSummaryTemplates(): Promise<unknown[]> {
    return this.call(callsOperations.listSummaryTemplates, undefined);
  }

  /** Get the thread attached to a call. */
  getConversation(callId: string): Promise<unknown> {
    return this.call(callsOperations.getConversation, { callId });
  }

  // ----- Recordings -----

  /** List recordings from the user's own calls. */
  listRecordings(options?: { limit?: number; start?: CallCursor }): Promise<Call[]> {
    return this.call(callsOperations.listRecordings, options ?? {});
  }

  /** List standalone recordings the user created. */
  listCreatedRecordings(options?: { limit?: number; start?: CallCursor }): Promise<Call[]> {
    return this.call(callsOperations.listCreatedRecordings, options ?? {});
  }

  /** List standalone recordings shared with the user. */
  listSharedRecordings(options?: { limit?: number; start?: CallCursor }): Promise<Call[]> {
    return this.call(callsOperations.listSharedRecordings, options ?? {});
  }

  /** Get one recording by its room id. */
  getRecording(callId: string): Promise<Call | null> {
    return this.call(callsOperations.getRecording, { callId });
  }

  // ----- Lifecycle -----

  /**
   * Start a call.
   *
   * `externalId` and `roomLink` must point at a room already provisioned on the
   * realtime server. This records the call; it does not create the media room,
   * so passing invented values yields a call nobody can join.
   *
   * @returns The id of the new call
   */
  async initiate(data: {
    channelId: string;
    callType: string;
    externalId: string;
    roomLink: string;
    targetUserIds?: string[];
  }): Promise<{ callId: string }> {
    const callId = newId();
    await this.call(callsOperations.initiate, { callId, ...data });
    return { callId };
  }

  /** Join a call. */
  join(callId: string): Promise<void> {
    return this.call(callsOperations.join, { callId });
  }

  /** Leave a call. */
  leave(callId: string): Promise<void> {
    return this.call(callsOperations.leave, { callId });
  }

  /** Decline an incoming call. */
  reject(callId: string): Promise<void> {
    return this.call(callsOperations.reject, { callId });
  }

  /**
   * Cancel a call.
   *
   * @param options.cancelEntireSeries - Cancel every future occurrence too
   */
  cancel(callId: string, options?: { cancelEntireSeries?: boolean }): Promise<void> {
    return this.call(callsOperations.cancel, { callId, ...options });
  }

  /** Invite more people to a call in progress. */
  invite(callId: string, userIds: string[]): Promise<void> {
    return this.call(callsOperations.invite, { callId, userIds });
  }

  /** Attach a canvas to a call for shared notes. */
  linkNotesCanvas(callId: string, notesCanvasId: string): Promise<void> {
    return this.call(callsOperations.linkNotesCanvas, { callId, notesCanvasId });
  }

  /**
   * Bookmark a moment in a call.
   *
   * @param timestampSeconds - Offset from the start of the call, not a clock time
   */
  markMoment(data: {
    callId: string;
    type: string;
    timestampSeconds: number;
    text: string;
  }): Promise<void> {
    return this.call(callsOperations.markMoment, data);
  }

  // ----- Lobby -----

  /** Ask to be let into a call you were not invited to. */
  requestToJoin(callId: string): Promise<void> {
    return this.call(callsOperations.requestToJoin, { callId });
  }

  /** Withdraw a pending join request. */
  cancelJoinRequest(callId: string): Promise<void> {
    return this.call(callsOperations.cancelJoinRequest, { callId });
  }

  /** Admit someone waiting in the lobby. */
  approveLobbyRequest(callId: string, participantId: string): Promise<void> {
    return this.call(callsOperations.approveLobbyRequest, { callId, participantId });
  }

  /** Turn away someone waiting in the lobby. */
  rejectLobbyRequest(callId: string, participantId: string): Promise<void> {
    return this.call(callsOperations.rejectLobbyRequest, { callId, participantId });
  }
}
