import { AuthProvider } from '@xyne/shared';
import {
  type MeetTranscriptCall,
  asMeetTranscriptOwner,
  findCalendarMeetCallsEnded,
  findCalendarMeetCallsStarting,
  findGoogleCalendarSourceId,
  findMeetTranscriptCall,
  findMeetTranscriptUserIds,
} from '@/bypassAcl/meetTranscriptServices';
import { config } from '@/config/env';
import { getCalendarCredentialsBySourceId } from '@/services/calendarTokenRefresh';
import {
  GoogleMeetApiError,
  type MeetConferenceRecord,
  enableMeetAutoTranscription,
  listMeetConferenceRecords,
  listMeetParticipants,
  listMeetTranscriptEntries,
  listMeetTranscripts,
  meetCodeFrom,
  meetParticipantName,
} from '@/services/googleMeetApi';
import { noteTakerTranscriptService } from '@/services/noteTakerTranscriptService';
import { redisService } from '@/services/redisService';
import { type TranscriptEntry, transcriptService } from '@/services/transcriptService';
import { logger } from '@/utils/logger';

/**
 * Google Meet's own transcript on the organiser's calendar call. No bot joins.
 *
 * For Google Calendar meetings organised by a user who turned "Google Meet
 * transcripts" on (user_preferences.meetTranscripts), each pass (every minute,
 * queues/meetTranscriptQueue.ts):
 *
 * 1. Before the meeting: turns Meet's automatic transcription on for it. Meet then
 *    transcribes once someone allowed to transcribe joins, and tells everyone.
 * 2. After it ends: reads Meet's transcript through the Meet REST API, stores it as
 *    the call's transcript and runs the usual transcript pipeline.
 *
 * Both use the organiser's own Google Calendar connection: Google only lets the
 * organiser change a meeting's settings and read its records. Progress is kept in
 * Redis, not on the call, because calendar sync rewrites the call's metadata.
 */

const TAG = '[MEET-TRANSCRIPT]';
const MINUTE = 60_000;

/** Turn transcription on for meetings starting from 5 min ago to 20 min ahead. */
const ENABLE_BEFORE_MS = 20 * MINUTE;
const ENABLE_AFTER_MS = 5 * MINUTE;
/** Look for a transcript from 2 min to 3 h after the scheduled end (meetings overrun). */
const FETCH_FROM_MS = 2 * MINUTE;
const FETCH_UNTIL_MS = 180 * MINUTE;
/** A sitting belongs to an event when it started from 30 min before its start to its end. */
const EARLY_START_MS = 30 * MINUTE;
/** Wait between tries for one meeting: 2, 4, 8, then every 15 minutes. */
const MAX_WAIT_MINUTES = 15;
/** Meetings handled per pass, so one pass stays well inside its minute. */
const MAX_PER_PASS = 25;

const enableKey = (callId: string) => `meet-transcript:enable:${callId}`;
const waitKey = (callId: string) => `meet-transcript:wait:${callId}`;
const triesKey = (callId: string) => `meet-transcript:tries:${callId}`;

interface CalendarCallMetadata {
  calendarOwnerEmail?: string;
  organizer?: { email?: string; self?: boolean } | null;
}

/** Whether this calendar copy belongs to the meeting's organiser. */
export function organisesMeeting(call: Pick<MeetTranscriptCall, 'metadata'>): boolean {
  const meta = (call.metadata && typeof call.metadata === 'object' ? call.metadata : {}) as CalendarCallMetadata;
  const owner = meta.calendarOwnerEmail?.trim().toLowerCase();
  const organizer = meta.organizer?.email?.trim().toLowerCase();
  return meta.organizer?.self === true || (!!owner && owner === organizer);
}

/** The sittings of the Meet link that belong to this calendar event (a link is reused by every occurrence). */
export function recordsOfEvent(
  records: MeetConferenceRecord[],
  call: Pick<MeetTranscriptCall, 'startsAt' | 'endsAt'>,
): MeetConferenceRecord[] {
  if (!call.startsAt || !call.endsAt) return [];
  const from = call.startsAt.getTime() - EARLY_START_MS;
  const to = call.endsAt.getTime();
  return records.filter((record) => {
    const started = record.startTime ? Date.parse(record.startTime) : NaN;
    return started >= from && started <= to;
  });
}

export type MeetTranscriptFetch =
  | { state: 'ready'; entries: TranscriptEntry[] }
  /** Nothing to save yet: the meeting hasn't run, is still running, or made no transcript. */
  | { state: 'waiting'; reason: 'no_meeting' | 'still_running' | 'no_transcript' };

/** Reads Meet's transcript of this event, as transcript entries in time order. */
export async function fetchMeetTranscript(
  accessToken: string,
  meetingCode: string,
  call: Pick<MeetTranscriptCall, 'startsAt' | 'endsAt'>,
): Promise<MeetTranscriptFetch> {
  const records = recordsOfEvent(await listMeetConferenceRecords(accessToken, meetingCode), call);
  if (records.length === 0) return { state: 'waiting', reason: 'no_meeting' };
  if (records.some((record) => !record.endTime)) return { state: 'waiting', reason: 'still_running' };

  const entries: TranscriptEntry[] = [];
  for (const record of records) {
    const transcripts = await listMeetTranscripts(accessToken, record.name);
    if (transcripts.some((transcript) => transcript.state === 'STARTED')) return { state: 'waiting', reason: 'still_running' };
    if (transcripts.length === 0) continue;
    const participants = await listMeetParticipants(accessToken, record.name);
    const names = new Map(participants.map((participant) => [participant.name, meetParticipantName(participant)]));
    for (const transcript of transcripts) {
      for (const entry of await listMeetTranscriptEntries(accessToken, transcript.name)) {
        const text = entry.text?.trim();
        const startedAt = entry.startTime ? Date.parse(entry.startTime) : NaN;
        if (!text || Number.isNaN(startedAt)) continue;
        entries.push({
          user: names.get(entry.participant ?? '') ?? 'Unknown speaker',
          text,
          timestamp: startedAt / 1000,
          participant_identity: entry.participant ?? '',
        });
      }
    }
  }
  if (entries.length === 0) return { state: 'waiting', reason: 'no_transcript' };
  entries.sort((a, b) => a.timestamp - b.timestamp);
  return { state: 'ready', entries };
}

class MeetTranscriptService {
  get enabled(): boolean {
    return config.meetTranscripts.enabled;
  }

  async runOnce(now = new Date()): Promise<{ enabled: number; saved: number }> {
    if (!this.enabled) return { enabled: 0, saved: 0 };
    const time = now.getTime();
    const [starting, ended] = await Promise.all([
      findCalendarMeetCallsStarting(new Date(time - ENABLE_AFTER_MS), new Date(time + ENABLE_BEFORE_MS)),
      findCalendarMeetCallsEnded(new Date(time - FETCH_UNTIL_MS), new Date(time - FETCH_FROM_MS)),
    ]);
    const organised = [...starting, ...ended].filter(organisesMeeting);
    const optedIn = await findMeetTranscriptUserIds([...new Set(organised.map((call) => call.createdByUserId))]);
    const mine = (calls: MeetTranscriptCall[]) =>
      calls.filter((call) => organisesMeeting(call) && optedIn.has(call.createdByUserId)).slice(0, MAX_PER_PASS);

    let enabled = 0;
    for (const call of mine(starting)) {
      if (await this.enableTranscription(call)) enabled++;
    }
    let saved = 0;
    for (const call of mine(ended)) {
      if (await this.saveTranscript(call)) saved++;
    }
    return { enabled, saved };
  }

  private async accessTokenFor(userId: string): Promise<string | null> {
    const sourceId = await findGoogleCalendarSourceId(userId);
    if (!sourceId) return null;
    const credentials = await getCalendarCredentialsBySourceId(sourceId, AuthProvider.GOOGLE);
    return credentials?.accessToken ?? null;
  }

  /** Turns Meet's automatic transcription on for one upcoming meeting. True when it did. */
  private async enableTranscription(call: MeetTranscriptCall): Promise<boolean> {
    const code = meetCodeFrom(call.roomLink ?? '');
    if (!code) return false;
    // One try per meeting at a time; the key's lifetime decides when the next one is.
    if (!(await redisService.set(enableKey(call.id), 'trying', 5 * 60, true))) return false;
    const log = { callId: call.id, userId: call.createdByUserId, meetingCode: code };
    try {
      const accessToken = await this.accessTokenFor(call.createdByUserId);
      if (!accessToken) {
        logger.warn(`${TAG} enable_skipped`, { ...log, reason: 'no_google_connection' });
        return false;
      }
      await enableMeetAutoTranscription(accessToken, code);
      await redisService.set(enableKey(call.id), 'on', 6 * 3600);
      logger.info(`${TAG} transcription_enabled`, log);
      return true;
    } catch (error) {
      // 403/404: the connection lacks the Meet permission (reconnect Google Calendar),
      // the plan has no transcripts, or the user doesn't own the meeting. Retrying
      // every few minutes can't fix those, so leave this meeting alone.
      const permanent = error instanceof GoogleMeetApiError && (error.status === 403 || error.status === 404);
      if (permanent) await redisService.set(enableKey(call.id), 'failed', 6 * 3600);
      logger.warn(`${TAG} enable_failed`, { ...log, permanent, error: error instanceof Error ? error.message : String(error) });
      return false;
    }
  }

  /** Fetches and saves Meet's transcript of one ended meeting. True when it was saved. */
  private async saveTranscript(call: MeetTranscriptCall): Promise<boolean> {
    const code = meetCodeFrom(call.roomLink ?? '');
    if (!code) return false;
    const tries = Number(await redisService.get(triesKey(call.id))) || 0;
    const waitMinutes = Math.min(2 ** (tries + 1), MAX_WAIT_MINUTES);
    // Claims this try and spaces out the next one.
    if (!(await redisService.set(waitKey(call.id), '1', waitMinutes * 60, true))) return false;
    await redisService.set(triesKey(call.id), String(tries + 1), 4 * 3600);

    const log = { callId: call.id, userId: call.createdByUserId, meetingCode: code, tries: tries + 1 };
    try {
      const accessToken = await this.accessTokenFor(call.createdByUserId);
      if (!accessToken) {
        logger.warn(`${TAG} fetch_skipped`, { ...log, reason: 'no_google_connection' });
        return false;
      }
      const result = await fetchMeetTranscript(accessToken, code, call);
      if (result.state === 'waiting') {
        logger.info(`${TAG} not_ready`, { ...log, reason: result.reason });
        return false;
      }
      const full = await findMeetTranscriptCall(call.id);
      if (!full || full.transcript) return false;
      await asMeetTranscriptOwner(full, async () => {
        await transcriptService.storeRawTranscript(full.externalId, result.entries);
        await noteTakerTranscriptService.processTranscript(full, true);
      });
      logger.info(`${TAG} transcript_saved`, { ...log, lines: result.entries.length });
      return true;
    } catch (error) {
      logger.warn(`${TAG} fetch_failed`, { ...log, error: error instanceof Error ? error.message : String(error) });
      return false;
    }
  }
}

export const meetTranscriptService = new MeetTranscriptService();
