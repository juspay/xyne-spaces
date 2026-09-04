jest.mock('@/config/env', () => ({
  config: { gcs: { transcriptionBucketName: 'transcripts-test' } },
}));
jest.mock('@/utils/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), debug: jest.fn(), warn: jest.fn() },
}));

// In-memory stand-in for the transcription bucket.
const files = new Map<string, Buffer>();
jest.mock('@/services/storage', () => ({
  getStorageService: () => ({
    fileExists: async (path: string) => files.has(path),
    getFileBuffer: async (path: string) => files.get(path)!,
    uploadFileV2: async (buffer: Buffer, options: { path: string }) => {
      files.set(options.path, buffer);
      return { path: options.path };
    },
  }),
}));

// Only the pure helpers are needed; keep the real consolidation out of the test.
jest.mock('@/services/transcriptService', () => ({
  transcriptService: {
    parseTranscriptEntries: (jsonl: string) =>
      jsonl
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line)),
    formatTranscript: (entries: Array<{ user: string; text: string; timestamp: number }>) =>
      entries.map((e) => `[${Math.round(e.timestamp - entries[0].timestamp)}] ${e.user}: ${e.text}`).join('\n'),
  },
}));

import { speakerSegmentService, LocalSpeakerSegmentsSchema } from './speakerSegmentService';

const CALL_ID = 'call-abc';
const T0_MS = 1_700_000_000_000; // recordingStartedAt
const t0 = T0_MS / 1000;

function entry(endOffsetSeconds: number, text: string, user = 'Riya'): string {
  return JSON.stringify({
    user,
    text,
    timestamp: t0 + endOffsetSeconds,
    spoken_at: t0 + endOffsetSeconds,
    participant_identity: 'riya-identity',
  });
}

function readIdentified(): Array<{ user: string; text: string }> {
  const raw = files.get(`transcriptions/${CALL_ID}_identified.jsonl`)!.toString('utf-8');
  return raw.trim().split('\n').map((line) => JSON.parse(line));
}

beforeEach(() => files.clear());

describe('LocalSpeakerSegmentsSchema', () => {
  it('rejects segments that end before they start', () => {
    const result = LocalSpeakerSegmentsSchema.safeParse({
      recordingStartedAt: T0_MS,
      segments: [{ start: 5, end: 4, speaker: 0 }],
    });
    expect(result.success).toBe(false);
  });

  it('accepts a well-formed payload', () => {
    const result = LocalSpeakerSegmentsSchema.safeParse({
      recordingStartedAt: T0_MS,
      durationSeconds: 12,
      segments: [{ start: 0, end: 4, speaker: 0 }],
    });
    expect(result.success).toBe(true);
  });
});

describe('speakerSegmentService.materializeIdentifiedTranscript', () => {
  it('defers when the plain transcript has not been written yet', async () => {
    await speakerSegmentService.storeSegments(CALL_ID, 'user-1', {
      recordingStartedAt: T0_MS,
      segments: [{ start: 0, end: 4, speaker: 0 }],
    });
    expect(await speakerSegmentService.materializeIdentifiedTranscript(CALL_ID)).toBe(false);
    expect(files.has(`transcriptions/${CALL_ID}_identified.jsonl`)).toBe(false);
  });

  it('relabels a single-mic transcript as Speaker 1 / Speaker 2 in order of appearance', async () => {
    // Two people alternate; the agent labelled every line with the recorder's name.
    files.set(
      `transcriptions/${CALL_ID}.jsonl`,
      Buffer.from(
        [
          entry(4.5, 'Hello everyone thanks for joining the call today'),
          entry(9.5, 'Sounds good I have a few updates on the backend'),
          entry(14.5, 'Great let us start with the migration timeline'),
          entry(19.5, 'Sure the migration finishes next week'),
        ].join('\n') + '\n',
      ),
    );
    await speakerSegmentService.storeSegments(CALL_ID, 'user-1', {
      recordingStartedAt: T0_MS,
      // Diarizer numbers clusters arbitrarily: the first voice is cluster 3.
      segments: [
        { start: 0.2, end: 4.1, speaker: 3 },
        { start: 4.3, end: 9.0, speaker: 1 },
        { start: 9.4, end: 14.0, speaker: 3 },
        { start: 14.3, end: 19.0, speaker: 1 },
      ],
    });

    expect(await speakerSegmentService.materializeIdentifiedTranscript(CALL_ID)).toBe(true);
    expect(readIdentified().map((e) => e.user)).toEqual([
      'Speaker 1',
      'Speaker 2',
      'Speaker 1',
      'Speaker 2',
    ]);
    expect(files.has(`attachments/${CALL_ID}_identified_formatted.txt`)).toBe(true);
  });

  it('keeps voiceprint names for clusters the identifier recognised', async () => {
    files.set(
      `transcriptions/${CALL_ID}.jsonl`,
      Buffer.from([entry(4.5, 'first line here'), entry(9.5, 'second line here')].join('\n') + '\n'),
    );
    // Voiceprint identifier knew the second voice, not the first.
    files.set(
      `transcriptions/${CALL_ID}_identified.jsonl`,
      Buffer.from(
        [entry(4.5, 'first line here', 'Unknown'), entry(9.5, 'second line here', 'Arjun')].join('\n') + '\n',
      ),
    );
    await speakerSegmentService.storeSegments(CALL_ID, 'user-1', {
      recordingStartedAt: T0_MS,
      segments: [
        { start: 0.2, end: 4.1, speaker: 0 },
        { start: 4.3, end: 9.2, speaker: 1 },
      ],
    });

    await speakerSegmentService.materializeIdentifiedTranscript(CALL_ID);
    expect(readIdentified().map((e) => e.user)).toEqual(['Speaker 1', 'Arjun']);
  });

  it('calibrates a constant STT finalisation lag instead of mislabelling shifted lines', async () => {
    // Speech: A 0-4s, B 4.3-9s, A 9.4-14s, B 14.3-19s. The agent stamps each
    // line ~3s AFTER the speaker stopped, so uncorrected windows land on the
    // NEXT speaker's segment.
    const LAG = 3.0;
    files.set(
      `transcriptions/${CALL_ID}.jsonl`,
      Buffer.from(
        [
          entry(4.0 + LAG, 'hello everyone thanks for joining the call today'),
          entry(9.0 + LAG, 'sounds good I have a few updates on the backend'),
          entry(14.0 + LAG, 'great let us start with the migration timeline'),
          entry(19.0 + LAG, 'sure the migration finishes next week'),
        ].join('\n') + '\n',
      ),
    );
    await speakerSegmentService.storeSegments(CALL_ID, 'user-1', {
      recordingStartedAt: T0_MS,
      segments: [
        { start: 0.2, end: 4.0, speaker: 0 },
        { start: 4.3, end: 9.0, speaker: 1 },
        { start: 9.4, end: 14.0, speaker: 0 },
        { start: 14.3, end: 19.0, speaker: 1 },
      ],
    });

    await speakerSegmentService.materializeIdentifiedTranscript(CALL_ID);
    expect(readIdentified().map((e) => e.user)).toEqual([
      'Speaker 1',
      'Speaker 2',
      'Speaker 1',
      'Speaker 2',
    ]);
  });

  it('falls back to the previous speaker when an utterance matches no segment', async () => {
    files.set(
      `transcriptions/${CALL_ID}.jsonl`,
      Buffer.from([entry(4.5, 'covered by a segment'), entry(40, 'far away from any segment')].join('\n') + '\n'),
    );
    await speakerSegmentService.storeSegments(CALL_ID, 'user-1', {
      recordingStartedAt: T0_MS,
      segments: [{ start: 0.2, end: 4.1, speaker: 0 }],
    });

    await speakerSegmentService.materializeIdentifiedTranscript(CALL_ID);
    expect(readIdentified().map((e) => e.user)).toEqual(['Speaker 1', 'Speaker 1']);
  });
});
