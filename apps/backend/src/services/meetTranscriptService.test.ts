jest.mock('@/utils/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), debug: jest.fn(), warn: jest.fn() },
}));
jest.mock('@xyne/shared', () => ({ AuthProvider: { GOOGLE: 'GOOGLE' } }));
jest.mock('@/config/env', () => ({ config: { meetTranscripts: { enabled: true } } }));
jest.mock('@/bypassAcl/meetTranscriptServices', () => ({
  findCalendarMeetCallsStarting: jest.fn(),
  findCalendarMeetCallsEnded: jest.fn(),
  findMeetTranscriptUserIds: jest.fn(),
  findGoogleCalendarSourceId: jest.fn(),
  findMeetTranscriptCall: jest.fn(),
  asMeetTranscriptOwner: jest.fn((_call: unknown, fn: () => Promise<unknown>) => fn()),
}));
jest.mock('@/services/calendarTokenRefresh', () => ({ getCalendarCredentialsBySourceId: jest.fn() }));
jest.mock('@/services/googleMeetApi', () => ({
  ...jest.requireActual('@/services/googleMeetApi'),
  enableMeetAutoTranscription: jest.fn(),
  listMeetConferenceRecords: jest.fn(),
  listMeetTranscripts: jest.fn(),
  listMeetTranscriptEntries: jest.fn(),
  listMeetParticipants: jest.fn(),
}));
jest.mock('@/services/noteTakerTranscriptService', () => ({
  noteTakerTranscriptService: { processTranscript: jest.fn() },
}));
jest.mock('@/services/transcriptService', () => ({ transcriptService: { storeRawTranscript: jest.fn() } }));
jest.mock('@/services/redisService', () => ({ redisService: { set: jest.fn(), get: jest.fn() } }));

import {
  type MeetTranscriptCall,
  findCalendarMeetCallsEnded,
  findCalendarMeetCallsStarting,
  findGoogleCalendarSourceId,
  findMeetTranscriptCall,
  findMeetTranscriptUserIds,
} from '@/bypassAcl/meetTranscriptServices';
import { getCalendarCredentialsBySourceId } from '@/services/calendarTokenRefresh';
import {
  GoogleMeetApiError,
  enableMeetAutoTranscription,
  listMeetConferenceRecords,
  listMeetParticipants,
  listMeetTranscriptEntries,
  listMeetTranscripts,
} from '@/services/googleMeetApi';
import { noteTakerTranscriptService } from '@/services/noteTakerTranscriptService';
import { redisService } from '@/services/redisService';
import { transcriptService } from '@/services/transcriptService';
import { fetchMeetTranscript, meetTranscriptService, organisesMeeting, recordsOfEvent } from './meetTranscriptService';

const NOW = new Date('2026-11-24T10:00:00Z');
const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

function call(overrides: Partial<MeetTranscriptCall> = {}): MeetTranscriptCall {
  return {
    id: 'call-1',
    externalId: 'gcal__u1__evt',
    workspaceId: 'ws-1',
    createdByUserId: 'u1',
    title: 'Sync',
    roomLink: 'https://meet.google.com/abc-defg-hij',
    startsAt: at(-60),
    endsAt: at(-30),
    metadata: { calendarOwnerEmail: 'me@juspay.in', organizer: { email: 'me@juspay.in', self: true } },
    transcript: null,
    ...overrides,
  } as MeetTranscriptCall;
}

const record = (startMinutes: number, ended = true) => ({
  name: `conferenceRecords/r${startMinutes}`,
  startTime: at(startMinutes).toISOString(),
  ...(ended && { endTime: at(startMinutes + 30).toISOString() }),
});

beforeEach(() => {
  jest.clearAllMocks();
  (findCalendarMeetCallsStarting as jest.Mock).mockResolvedValue([]);
  (findCalendarMeetCallsEnded as jest.Mock).mockResolvedValue([]);
  (findMeetTranscriptUserIds as jest.Mock).mockResolvedValue(new Set(['u1']));
  (findGoogleCalendarSourceId as jest.Mock).mockResolvedValue('src');
  (getCalendarCredentialsBySourceId as jest.Mock).mockResolvedValue({ accessToken: 'tok' });
  (redisService.set as jest.Mock).mockResolvedValue(true);
  (redisService.get as jest.Mock).mockResolvedValue(null);
  (listMeetParticipants as jest.Mock).mockResolvedValue([
    { name: 'conferenceRecords/r-60/participants/p1', signedinUser: { displayName: 'Asha' } },
  ]);
});

describe('organisesMeeting', () => {
  it("is true only for the organiser's own calendar copy", () => {
    expect(organisesMeeting(call())).toBe(true);
    expect(organisesMeeting(call({ metadata: { calendarOwnerEmail: 'Me@juspay.in', organizer: { email: 'me@juspay.in' } } }))).toBe(true);
    expect(organisesMeeting(call({ metadata: { calendarOwnerEmail: 'me@juspay.in', organizer: { email: 'boss@other.com' } } }))).toBe(false);
    expect(organisesMeeting(call({ metadata: null }))).toBe(false);
  });
});

describe('recordsOfEvent', () => {
  it("keeps this occurrence's sittings and drops other days' (a recurring meeting reuses its link)", () => {
    const records = [record(-60), record(-75), record(-60 - 24 * 60), record(-20)];
    expect(recordsOfEvent(records, call()).map((r) => r.name)).toEqual(['conferenceRecords/r-60', 'conferenceRecords/r-75']);
  });
});

describe('fetchMeetTranscript', () => {
  it('waits while the meeting has not run or is still running', async () => {
    (listMeetConferenceRecords as jest.Mock).mockResolvedValueOnce([]);
    await expect(fetchMeetTranscript('tok', 'abc-defg-hij', call())).resolves.toEqual({ state: 'waiting', reason: 'no_meeting' });
    (listMeetConferenceRecords as jest.Mock).mockResolvedValueOnce([record(-60, false)]);
    await expect(fetchMeetTranscript('tok', 'abc-defg-hij', call())).resolves.toEqual({ state: 'waiting', reason: 'still_running' });
  });

  it('waits when transcription was not on', async () => {
    (listMeetConferenceRecords as jest.Mock).mockResolvedValue([record(-60)]);
    (listMeetTranscripts as jest.Mock).mockResolvedValue([]);
    await expect(fetchMeetTranscript('tok', 'abc-defg-hij', call())).resolves.toEqual({ state: 'waiting', reason: 'no_transcript' });
  });

  it('returns the lines in time order with speaker names', async () => {
    (listMeetConferenceRecords as jest.Mock).mockResolvedValue([record(-60)]);
    (listMeetTranscripts as jest.Mock).mockResolvedValue([{ name: 't1', state: 'FILE_GENERATED' }]);
    (listMeetTranscriptEntries as jest.Mock).mockResolvedValue([
      { participant: 'someone-else', text: 'second', startTime: at(-50).toISOString() },
      { participant: 'conferenceRecords/r-60/participants/p1', text: ' first ', startTime: at(-55).toISOString() },
      { participant: 'x', text: '  ', startTime: at(-54).toISOString() },
    ]);
    const result = await fetchMeetTranscript('tok', 'abc-defg-hij', call());
    expect(result).toEqual({
      state: 'ready',
      entries: [
        { user: 'Asha', text: 'first', timestamp: at(-55).getTime() / 1000, participant_identity: 'conferenceRecords/r-60/participants/p1' },
        { user: 'Unknown speaker', text: 'second', timestamp: at(-50).getTime() / 1000, participant_identity: 'someone-else' },
      ],
    });
  });
});

describe('runOnce', () => {
  it("turns transcription on for an opted-in organiser's upcoming meeting, once", async () => {
    (findCalendarMeetCallsStarting as jest.Mock).mockResolvedValue([call({ startsAt: at(10), endsAt: at(40) })]);
    await expect(meetTranscriptService.runOnce(NOW)).resolves.toEqual({ enabled: 1, saved: 0 });
    expect(enableMeetAutoTranscription).toHaveBeenCalledWith('tok', 'abc-defg-hij');

    (redisService.set as jest.Mock).mockResolvedValue(false); // already tried
    await expect(meetTranscriptService.runOnce(NOW)).resolves.toEqual({ enabled: 0, saved: 0 });
    expect(enableMeetAutoTranscription).toHaveBeenCalledTimes(1);
  });

  it('leaves guests and users who did not opt in alone', async () => {
    const guest = call({ id: 'g', metadata: { calendarOwnerEmail: 'me@juspay.in', organizer: { email: 'boss@other.com' } } });
    const notOptedIn = call({ id: 'n', createdByUserId: 'u2' });
    (findCalendarMeetCallsStarting as jest.Mock).mockResolvedValue([guest, notOptedIn]);
    (findCalendarMeetCallsEnded as jest.Mock).mockResolvedValue([guest, notOptedIn]);
    await expect(meetTranscriptService.runOnce(NOW)).resolves.toEqual({ enabled: 0, saved: 0 });
    expect(enableMeetAutoTranscription).not.toHaveBeenCalled();
    expect(listMeetConferenceRecords).not.toHaveBeenCalled();
  });

  it('stops trying a meeting Google refuses', async () => {
    (findCalendarMeetCallsStarting as jest.Mock).mockResolvedValue([call({ startsAt: at(10), endsAt: at(40) })]);
    (enableMeetAutoTranscription as jest.Mock).mockRejectedValue(new GoogleMeetApiError(403, 'no scope'));
    await expect(meetTranscriptService.runOnce(NOW)).resolves.toEqual({ enabled: 0, saved: 0 });
    expect(redisService.set).toHaveBeenCalledWith('meet-transcript:enable:call-1', 'failed', 6 * 3600);
  });

  it('saves the transcript of an ended meeting and runs the transcript pipeline', async () => {
    const full = { ...call(), status: 'SCHEDULED' };
    (findCalendarMeetCallsEnded as jest.Mock).mockResolvedValue([call()]);
    (findMeetTranscriptCall as jest.Mock).mockResolvedValue(full);
    (listMeetConferenceRecords as jest.Mock).mockResolvedValue([record(-60)]);
    (listMeetTranscripts as jest.Mock).mockResolvedValue([{ name: 't1', state: 'ENDED' }]);
    (listMeetTranscriptEntries as jest.Mock).mockResolvedValue([{ participant: 'p', text: 'hello', startTime: at(-55).toISOString() }]);

    await expect(meetTranscriptService.runOnce(NOW)).resolves.toEqual({ enabled: 0, saved: 1 });
    expect(transcriptService.storeRawTranscript).toHaveBeenCalledWith('gcal__u1__evt', [
      expect.objectContaining({ text: 'hello' }),
    ]);
    expect(noteTakerTranscriptService.processTranscript).toHaveBeenCalledWith(full, true);
  });

  it('waits longer between tries, and saves nothing while there is no transcript', async () => {
    (findCalendarMeetCallsEnded as jest.Mock).mockResolvedValue([call()]);
    (redisService.get as jest.Mock).mockResolvedValue('2');
    (listMeetConferenceRecords as jest.Mock).mockResolvedValue([]);
    await expect(meetTranscriptService.runOnce(NOW)).resolves.toEqual({ enabled: 0, saved: 0 });
    expect(redisService.set).toHaveBeenCalledWith('meet-transcript:wait:call-1', '1', 8 * 60, true);
    expect(transcriptService.storeRawTranscript).not.toHaveBeenCalled();
  });
});
