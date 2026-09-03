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
import type {
  Call,
  CallParticipant,
  CallType,
  Conversation,
  RecurringCallSeries,
  SummaryTemplate,
} from '../types/index.js';

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

  /**
   * List calls in progress in one channel.
   *
   * @param channelId - Channel to read.
   * @returns Calls currently live there.
   * @example
   * const live = await sdk.calls.listActiveInChannel('channel-1');
   */
  listActiveInChannel(channelId: string): Promise<Call[]> {
    return this.call(callsOperations.listActiveInChannel, { channelId });
  }

  /**
   * List the caller's upcoming scheduled calls.
   *
   * @returns Calls they are invited to that have not started.
   * @example
   * const upcoming = await sdk.calls.listScheduled();
   */
  listScheduled(): Promise<Call[]> {
    return this.call(callsOperations.listScheduled, undefined);
  }

  /**
   * List past calls, most recent first.
   *
   * @param options.limit - Page size.
   * @param options.start - Cursor from the last item of the previous page.
   * @returns One page of finished calls.
   * @example
   * const history = await sdk.calls.listHistory({ limit: 20 });
   */
  listHistory(options?: { limit?: number; start?: CallCursor }): Promise<Call[]> {
    return this.call(callsOperations.listHistory, options ?? {});
  }

  /**
   * List a call's participants.
   *
   * @param callId - Id of the call.
   * @returns Everyone who joined, with their join and leave times.
   * @example
   * const people = await sdk.calls.listParticipants('call-1');
   */
  listParticipants(callId: string): Promise<CallParticipant[]> {
    return this.call(callsOperations.listParticipants, { callId });
  }

  /**
   * Get a recurring call series and its schedule.
   *
   * @param seriesId - Id of the series.
   * @returns The series, or `null` if it does not exist.
   * @example
   * const series = await sdk.calls.getRecurringSeries('series-1');
   */
  getRecurringSeries(seriesId: string): Promise<RecurringCallSeries | null> {
    return this.call(callsOperations.getRecurringSeries, { seriesId });
  }

  /**
   * Get one call-summary template by id.
   *
   * @param templateId - Id of the template.
   * @returns The template, or `null` if it does not exist.
   * @example
   * const template = await sdk.calls.getSummaryTemplate('template-1');
   */
  getSummaryTemplate(templateId: string): Promise<SummaryTemplate | null> {
    return this.call(callsOperations.getSummaryTemplate, { templateId });
  }

  /**
   * List the summary templates available for call notes.
   *
   * @returns Templates the caller can use.
   * @example
   * const templates = await sdk.calls.listSummaryTemplates();
   */
  listSummaryTemplates(): Promise<SummaryTemplate[]> {
    return this.call(callsOperations.listSummaryTemplates, undefined);
  }

  /**
   * Get the thread attached to a call.
   *
   * @param callId - Id of the call.
   * @returns The call's thread, or `null` if it has none.
   * @example
   * const thread = await sdk.calls.getConversation('call-1');
   */
  getConversation(callId: string): Promise<Conversation | null> {
    return this.call(callsOperations.getConversation, { callId });
  }

  // ----- Recordings -----

  /**
   * List recordings from the caller's own calls.
   *
   * @param options.limit - Page size.
   * @param options.start - Cursor from the previous page.
   * @returns One page of recorded calls, newest first.
   * @example
   * const recordings = await sdk.calls.listRecordings({ limit: 20 });
   */
  listRecordings(options?: { limit?: number; start?: CallCursor }): Promise<Call[]> {
    return this.call(callsOperations.listRecordings, options ?? {});
  }

  /**
   * List standalone recordings the caller created.
   *
   * @param options.limit - Page size.
   * @param options.start - Cursor from the previous page.
   * @param options.participantId - Restrict to recordings involving one person.
   * @returns One page of recordings, newest first.
   * @example
   * const mine = await sdk.calls.listCreatedRecordings({ limit: 20 });
   */
  listCreatedRecordings(options?: { limit?: number; start?: CallCursor }): Promise<Call[]> {
    return this.call(callsOperations.listCreatedRecordings, options ?? {});
  }

  /**
   * List standalone recordings shared with the caller.
   *
   * @param options.limit - Page size.
   * @param options.start - Cursor from the previous page.
   * @param options.participantId - Restrict to recordings involving one person.
   * @returns One page of recordings, newest first.
   * @example
   * const shared = await sdk.calls.listSharedRecordings({ limit: 20 });
   */
  listSharedRecordings(options?: { limit?: number; start?: CallCursor }): Promise<Call[]> {
    return this.call(callsOperations.listSharedRecordings, options ?? {});
  }

  /**
   * Get one recording by its realtime room id.
   *
   * @param callId - The room's external id.
   * @returns The recording, or `null` if there is none.
   * @example
   * const recording = await sdk.calls.getRecording('room-1');
   */
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
   * @param data - The call to record.
   * @param data.channelId - Channel the call belongs to.
   * @param data.callType - Whether it is audio, video, or headless.
   * @param data.externalId - Id of the already-provisioned room.
   * @param data.roomLink - Join URL for that room.
   * @param data.targetUserIds - People to ring. Omit for an open call.
   * @returns The new call's id.
   * @example
   * const { callId } = await sdk.calls.initiate({
   *   channelId: 'channel-1',
   *   callType: 'VIDEO',
   *   externalId: 'room-1',
   *   roomLink: 'https://rooms.example/room-1',
   * });
   */
  async initiate(data: {
    channelId: string;
    callType: CallType;
    externalId: string;
    roomLink: string;
    targetUserIds?: string[];
  }): Promise<{ callId: string }> {
    const callId = newId();
    await this.call(callsOperations.initiate, { callId, ...data });
    return { callId };
  }

  /**
   * Join a call.
   *
   * @param callId - Id of the call.
   * @example
   * await sdk.calls.join('call-1');
   */
  join(callId: string): Promise<void> {
    return this.call(callsOperations.join, { callId });
  }

  /**
   * Leave a call.
   *
   * @param callId - Id of the call.
   * @example
   * await sdk.calls.leave('call-1');
   */
  leave(callId: string): Promise<void> {
    return this.call(callsOperations.leave, { callId });
  }

  /**
   * Decline an incoming call.
   *
   * @param callId - Id of the call.
   * @example
   * await sdk.calls.reject('call-1');
   */
  reject(callId: string): Promise<void> {
    return this.call(callsOperations.reject, { callId });
  }

  /**
   * Cancel a call.
   *
   * @param callId - Id of the call.
   * @param options.cancelEntireSeries - Cancel every future occurrence too,
   * when the call belongs to a recurring series.
   * @example
   * await sdk.calls.cancel('call-1', { cancelEntireSeries: true });
   */
  cancel(callId: string, options?: { cancelEntireSeries?: boolean }): Promise<void> {
    return this.call(callsOperations.cancel, { callId, ...options });
  }

  /**
   * Invite more people to a call in progress.
   *
   * @param callId - Id of the call.
   * @param userIds - People to invite.
   * @example
   * await sdk.calls.invite('call-1', ['user-2', 'user-3']);
   */
  invite(callId: string, userIds: string[]): Promise<void> {
    return this.call(callsOperations.invite, { callId, userIds });
  }

  /**
   * Attach a canvas to a call for shared notes.
   *
   * @param callId - Id of the call.
   * @param notesCanvasId - Canvas to attach.
   * @example
   * await sdk.calls.linkNotesCanvas('call-1', 'canvas-1');
   */
  linkNotesCanvas(callId: string, notesCanvasId: string): Promise<void> {
    return this.call(callsOperations.linkNotesCanvas, { callId, notesCanvasId });
  }

  /**
   * Bookmark a moment in a call.
   *
   * @param data - The moment to mark.
   * @param data.callId - Call being marked.
   * @param data.type - What kind of moment it is.
   * @param data.timestampSeconds - Offset from the start of the call, in
   * seconds — not a clock time.
   * @param data.text - Note describing the moment.
   * @example
   * await sdk.calls.markMoment({
   *   callId: 'call-1',
   *   type: 'DECISION',
   *   timestampSeconds: 720,
   *   text: 'Agreed to roll back',
   * });
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

  /**
   * Ask to be let into a call the caller was not invited to.
   *
   * @param callId - Id of the call.
   * @example
   * await sdk.calls.requestToJoin('call-1');
   */
  requestToJoin(callId: string): Promise<void> {
    return this.call(callsOperations.requestToJoin, { callId });
  }

  /**
   * Withdraw a pending join request.
   *
   * @param callId - Id of the call.
   * @example
   * await sdk.calls.cancelJoinRequest('call-1');
   */
  cancelJoinRequest(callId: string): Promise<void> {
    return this.call(callsOperations.cancelJoinRequest, { callId });
  }

  /**
   * Admit someone waiting in the lobby.
   *
   * @param callId - Id of the call.
   * @param participantId - The waiting participant's id.
   * @example
   * await sdk.calls.approveLobbyRequest('call-1', 'participant-1');
   */
  approveLobbyRequest(callId: string, participantId: string): Promise<void> {
    return this.call(callsOperations.approveLobbyRequest, { callId, participantId });
  }

  /**
   * Turn away someone waiting in the lobby.
   *
   * @param callId - Id of the call.
   * @param participantId - The waiting participant's id.
   * @example
   * await sdk.calls.rejectLobbyRequest('call-1', 'participant-1');
   */
  rejectLobbyRequest(callId: string, participantId: string): Promise<void> {
    return this.call(callsOperations.rejectLobbyRequest, { callId, participantId });
  }
}
