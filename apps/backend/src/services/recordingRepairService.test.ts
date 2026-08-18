import { createHash } from 'crypto';
import type { RecordingCaptureManifest } from '@xyne/shared';

const claim = jest.fn();
const isLiveTranscriptFinalized = jest.fn();
const markMerged = jest.fn();
const markFailed = jest.fn();
const heartbeat = jest.fn();
const assertLease = jest.fn();
const hasUnmergedForCall = jest.fn();
const listDeletableCaptureIdsForCall = jest.fn();
const readManifest = jest.fn();
const readAudio = jest.fn();
const deleteCaptureObjects = jest.fn();
const transcribeRecordingRepair = jest.fn();
const applyRecordingRepair = jest.fn();
const refreshRecordingArtifacts = jest.fn();

jest.mock('@/services/recordingRepairStateService', () => ({
  recordingRepairStateService: {
    claim,
    isLiveTranscriptFinalized,
    markMerged,
    markFailed,
    heartbeat,
    assertLease,
    hasUnmergedForCall,
    listDeletableCaptureIdsForCall,
  },
}));
jest.mock('@/services/recordingRepairStorageService', () => ({
  recordingRepairStorageService: { readManifest, readAudio, deleteCaptureObjects },
}));
jest.mock('@/services/voiceInputService', () => ({
  voiceInputService: { transcribeRecordingRepair },
}));
jest.mock('@/services/noteTakerTranscriptService', () => ({
  noteTakerTranscriptService: { applyRecordingRepair, refreshRecordingArtifacts },
}));
jest.mock('@/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
// @xyne/shared ships ESM dist that jest's CJS runtime can't load; provide the three
// pure helpers the worker uses. neededChunkSequences mirrors the real prefix logic.
jest.mock('@xyne/shared', () => ({
  serializeManifestForHash: (): string => '',
  validateManifestStructure: (): string | null => null,
  neededChunkSequences: (m: {
    offlineAtStart: boolean;
    chunks: Array<{ sequence: number; startedAtMs: number; endedAtMs: number }>;
    outages: Array<{ startedAtMs: number; endedAtMs: number }>;
  }): number[] => {
    if (m.offlineAtStart) return m.chunks.map((c) => c.sequence);
    let max = -1;
    for (const c of m.chunks) {
      if (m.outages.some((o) => c.startedAtMs < o.endedAtMs && c.endedAtMs > o.startedAtMs)) {
        max = Math.max(max, c.sequence);
      }
    }
    return max < 0 ? [] : m.chunks.filter((c) => c.sequence <= max).map((c) => c.sequence);
  },
}));

import { RecordingRepairService } from './recordingRepairService';

// EBML magic so isStandaloneWebm() accepts the uploaded recording.
const webmAudio = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x02]);
const chunkSha = createHash('sha256').update(webmAudio).digest('hex');

function manifest(overrides: Partial<RecordingCaptureManifest> = {}): RecordingCaptureManifest {
  return {
    version: 1,
    callId: 'call-1',
    captureId: 'capture-1',
    startedAt: 1_000,
    endedAt: 11_000,
    mimeType: 'audio/webm',
    audioBitsPerSecond: 48_000,
    offlineAtStart: false,
    // One 10s chunk: media time m ms → wall (1000 + m) ms.
    chunks: [
      { sequence: 0, byteOffset: 0, byteLength: 6, startedAtMs: 1_000, endedAtMs: 11_000, sha256: chunkSha },
    ],
    outages: [{ startedAtMs: 6_000, endedAtMs: 8_000, reasons: ['browser_offline'] }],
    markedMoments: [],
    uploadedSequences: [0],
    completed: true,
    manifestHash: null,
    ...overrides,
  };
}

describe('RecordingRepairService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    isLiveTranscriptFinalized.mockResolvedValue(true);
    // manifestHash null → the worker skips the integrity check for the test.
    claim.mockResolvedValue({ status: 'PROCESSING', leaseId: 'lease-1', manifestHash: null });
    readManifest.mockResolvedValue(manifest());
    readAudio.mockResolvedValue(webmAudio);
    deleteCaptureObjects.mockResolvedValue(undefined);
    heartbeat.mockResolvedValue(true);
    assertLease.mockResolvedValue(undefined);
    hasUnmergedForCall.mockResolvedValue(false);
    listDeletableCaptureIdsForCall.mockResolvedValue([]);
    refreshRecordingArtifacts.mockResolvedValue(undefined);
  });

  it('transcribes the whole recording and maps segments into outage windows', async () => {
    transcribeRecordingRepair.mockResolvedValue({
      speechDetected: true,
      text: 'recovered',
      audioDurationSeconds: 10,
      // media [5s,7s] → wall [6000,8000] = inside the outage window.
      segments: [{ startSeconds: 5, endSeconds: 7, text: 'recovered' }],
    });

    await new RecordingRepairService().process('call-1', 'capture-1');

    // The whole file is handed over as-is — no media offsets.
    expect(transcribeRecordingRepair).toHaveBeenCalledWith(
      expect.objectContaining({ originalname: 'capture-1.webm' })
    );
    expect(applyRecordingRepair).toHaveBeenCalledWith(
      'call-1',
      [expect.objectContaining({ text: 'recovered', timestamp: 6 })],
      [{ startedAt: 6_000, endedAt: 8_000 }],
      expect.any(Function)
    );
    expect(markMerged).toHaveBeenCalledWith('call-1', 'capture-1', 'lease-1');
  });

  it('does not replace transcript coverage when VAD finds silence', async () => {
    transcribeRecordingRepair.mockResolvedValue({
      speechDetected: false,
      text: '',
      audioDurationSeconds: 10,
      segments: [],
    });

    await new RecordingRepairService().process('call-1', 'capture-1');

    expect(applyRecordingRepair).not.toHaveBeenCalled();
    expect(markMerged).toHaveBeenCalledWith('call-1', 'capture-1', 'lease-1');
  });

  it('does not claim a repair before the live transcript commit signal', async () => {
    isLiveTranscriptFinalized.mockResolvedValue(false);

    await expect(new RecordingRepairService().process('call-1', 'capture-1')).rejects.toThrow(
      'Live transcript has not been finalized yet'
    );
    expect(claim).not.toHaveBeenCalled();
  });

  it('fails a recording that has no WebM header', async () => {
    readAudio.mockResolvedValue(Buffer.from([0x00, 0x00, 0x00, 0x00]));

    await expect(new RecordingRepairService().process('call-1', 'capture-1')).rejects.toThrow(
      'no WebM header'
    );
    expect(applyRecordingRepair).not.toHaveBeenCalled();
    expect(markFailed).toHaveBeenCalledWith(
      'call-1',
      'capture-1',
      expect.stringContaining('no WebM header'),
      'lease-1',
      false
    );
  });

  it('rejects decoded audio whose duration disagrees with the manifest', async () => {
    transcribeRecordingRepair.mockResolvedValue({
      speechDetected: true,
      text: 'too short',
      audioDurationSeconds: 0.5,
      segments: [{ startSeconds: 0, endSeconds: 0.5, text: 'too short' }],
    });

    await expect(new RecordingRepairService().process('call-1', 'capture-1')).rejects.toThrow(
      'duration differs from manifest'
    );
    expect(applyRecordingRepair).not.toHaveBeenCalled();
    expect(markFailed).toHaveBeenCalledWith(
      'call-1',
      'capture-1',
      expect.stringContaining('duration differs from manifest'),
      'lease-1',
      false
    );
  });
});
