/**
 * Google Meet REST API (v2): Meet's own transcript of a meeting, and the setting that
 * makes Meet transcribe a meeting automatically.
 *
 * Calls are made as one user, with their Google Calendar connection's access token
 * (scopes: GOOGLE_MEET_TRANSCRIPT_SCOPES in routes/calendarOAuth.ts). Google only
 * shows a user the records of meetings they organise, and only the organiser can
 * change a meeting's settings.
 *
 * A transcript exists only when transcription ran in the meeting, and Google deletes
 * the entries served here 30 days after the meeting ends.
 */

const MEET_API = 'https://meet.googleapis.com/v2';

export class GoogleMeetApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`Google Meet API ${status}: ${body}`);
    this.name = 'GoogleMeetApiError';
  }
}

export type MeetAutoGeneration = 'AUTO_GENERATION_TYPE_UNSPECIFIED' | 'ON' | 'OFF';

export interface MeetSpace {
  /** Resource name, `spaces/{id}`: what `patch` needs (the meeting code is only an alias). */
  name: string;
  meetingUri?: string;
  meetingCode?: string;
  config?: {
    accessType?: string;
    artifactConfig?: {
      transcriptionConfig?: { autoTranscriptionGeneration?: MeetAutoGeneration };
      recordingConfig?: { autoRecordingGeneration?: MeetAutoGeneration };
      smartNotesConfig?: { autoSmartNotesGeneration?: MeetAutoGeneration };
    };
  };
}

/** One sitting of a meeting: a meeting code used twice has two records. */
export interface MeetConferenceRecord {
  name: string;
  startTime?: string;
  endTime?: string;
  space?: string;
}

export interface MeetTranscript {
  name: string;
  /** FILE_GENERATED once the Google Doc exists; entries are readable from ENDED. */
  state?: 'STATE_UNSPECIFIED' | 'STARTED' | 'ENDED' | 'FILE_GENERATED';
  startTime?: string;
  endTime?: string;
  docsDestination?: { document?: string; exportUri?: string };
}

export interface MeetTranscriptEntry {
  name: string;
  /** `conferenceRecords/{record}/participants/{participant}`. */
  participant?: string;
  text?: string;
  languageCode?: string;
  startTime?: string;
  endTime?: string;
}

export interface MeetParticipant {
  name: string;
  signedinUser?: { user?: string; displayName?: string };
  anonymousUser?: { displayName?: string };
  phoneUser?: { displayName?: string };
}

/** `abc-defg-hij` from a Meet link or a bare code; null when it is neither. */
export function meetCodeFrom(linkOrCode: string): string | null {
  const match = /(?:meet\.google\.com\/)?([a-z]{3}-[a-z]{4}-[a-z]{3})(?:[/?#]|$)/i.exec(linkOrCode.trim());
  return match ? match[1].toLowerCase() : null;
}

export function meetParticipantName(participant: MeetParticipant | undefined): string {
  return (
    participant?.signedinUser?.displayName ||
    participant?.anonymousUser?.displayName ||
    participant?.phoneUser?.displayName ||
    'Unknown speaker'
  );
}

async function meetFetch<T>(accessToken: string, path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`${MEET_API}/${path}`, {
    method: init.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init.body !== undefined && { 'Content-Type': 'application/json' }),
    },
    ...(init.body !== undefined && { body: JSON.stringify(init.body) }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new GoogleMeetApiError(res.status, await res.text());
  return (await res.json()) as T;
}

/** Follows nextPageToken until the list ends (or `maxPages`, as a guard). */
async function listAll<T>(accessToken: string, path: string, field: string, pageSize: number, maxPages = 50): Promise<T[]> {
  const items: T[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const query = new URLSearchParams({ pageSize: String(pageSize), ...(pageToken && { pageToken }) });
    const data = await meetFetch<Record<string, unknown>>(accessToken, `${path}${path.includes('?') ? '&' : '?'}${query}`);
    items.push(...((data[field] as T[] | undefined) ?? []));
    pageToken = data.nextPageToken as string | undefined;
    if (!pageToken) break;
  }
  return items;
}

export function getMeetSpace(accessToken: string, meetingCode: string): Promise<MeetSpace> {
  return meetFetch<MeetSpace>(accessToken, `spaces/${encodeURIComponent(meetingCode)}`);
}

/**
 * Makes Meet transcribe this meeting automatically. Only the meeting's organiser may;
 * transcription then starts when someone allowed to transcribe joins.
 */
export async function enableMeetAutoTranscription(accessToken: string, meetingCode: string): Promise<MeetSpace> {
  const space = await getMeetSpace(accessToken, meetingCode);
  if (space.config?.artifactConfig?.transcriptionConfig?.autoTranscriptionGeneration === 'ON') return space;
  const mask = 'config.artifactConfig.transcriptionConfig.autoTranscriptionGeneration';
  return meetFetch<MeetSpace>(accessToken, `${space.name}?updateMask=${mask}`, {
    method: 'PATCH',
    body: { config: { artifactConfig: { transcriptionConfig: { autoTranscriptionGeneration: 'ON' } } } },
  });
}

/** Past sittings of this meeting that the user organised, newest first. */
export function listMeetConferenceRecords(accessToken: string, meetingCode: string): Promise<MeetConferenceRecord[]> {
  const filter = encodeURIComponent(`space.meeting_code = "${meetingCode}"`);
  return listAll<MeetConferenceRecord>(accessToken, `conferenceRecords?filter=${filter}`, 'conferenceRecords', 25, 4);
}

export function listMeetTranscripts(accessToken: string, conferenceRecord: string): Promise<MeetTranscript[]> {
  return listAll<MeetTranscript>(accessToken, `${conferenceRecord}/transcripts`, 'transcripts', 100, 4);
}

export function listMeetTranscriptEntries(accessToken: string, transcript: string): Promise<MeetTranscriptEntry[]> {
  return listAll<MeetTranscriptEntry>(accessToken, `${transcript}/entries`, 'transcriptEntries', 100, 200);
}

export function listMeetParticipants(accessToken: string, conferenceRecord: string): Promise<MeetParticipant[]> {
  return listAll<MeetParticipant>(accessToken, `${conferenceRecord}/participants`, 'participants', 250, 8);
}
