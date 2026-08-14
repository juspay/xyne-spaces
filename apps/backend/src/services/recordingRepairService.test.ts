const claim = jest.fn();
const isLiveTranscriptFinalized = jest.fn();
const markMerged = jest.fn();
const markFailed = jest.fn();
const heartbeat = jest.fn();
const assertLease = jest.fn();
const hasUnmergedForCall = jest.fn();
const listDeletableCaptureIdsForCall = jest.fn();
const listChunks = jest.fn();
const readChunk = jest.fn();
const deleteChunks = jest.fn();
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
  recordingRepairStorageService: { listChunks, readChunk, deleteChunks },
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

import { RecordingRepairService } from './recordingRepairService';

describe('RecordingRepairService', () => {
  const chunk = {
    path: 'repair.webm',
    sequence: 0,
    startedAt: 1_000,
    endedAt: 11_000,
    sha256: 'a'.repeat(64),
    mimeType: 'audio/webm',
    size: 4,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    isLiveTranscriptFinalized.mockResolvedValue(true);
    claim.mockResolvedValue({
      status: 'PROCESSING',
      leaseId: 'lease-1',
      outages: [{ startedAt: 5_000, endedAt: 7_000, reasons: ['browser_offline'] }],
    });
    listChunks.mockResolvedValue([chunk]);
    readChunk.mockResolvedValue(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
    deleteChunks.mockResolvedValue(undefined);
    heartbeat.mockResolvedValue(true);
    assertLease.mockResolvedValue(undefined);
    hasUnmergedForCall.mockResolvedValue(false);
    listDeletableCaptureIdsForCall.mockResolvedValue([]);
    refreshRecordingArtifacts.mockResolvedValue(undefined);
  });

  it('sends only the exact outage intersection to VAD/STT', async () => {
    transcribeRecordingRepair.mockResolvedValue({
      speechDetected: true,
      text: 'recovered',
      audioDurationSeconds: 2,
      segments: [{ startSeconds: 0, endSeconds: 2, text: 'recovered' }],
    });

    await new RecordingRepairService().process('call-1', 'capture-1');

    expect(transcribeRecordingRepair).toHaveBeenCalledWith(
      expect.objectContaining({ originalname: '0.webm' }),
      { startOffsetMs: 4_000, endOffsetMs: 6_000 }
    );
    expect(applyRecordingRepair).toHaveBeenCalledWith(
      'call-1',
      [expect.objectContaining({ text: 'recovered', timestamp: 5 })],
      [{ startedAt: 5_000, endedAt: 7_000 }],
      expect.any(Function)
    );
    expect(markMerged).toHaveBeenCalledWith('call-1', 'capture-1', 'lease-1');
  });

  it('does not delete canonical transcript coverage when VAD finds silence', async () => {
    transcribeRecordingRepair.mockResolvedValue({
      speechDetected: false,
      text: '',
      audioDurationSeconds: 2,
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

  it('rejects client metadata that claims substantially more audio than was decoded', async () => {
    transcribeRecordingRepair.mockResolvedValue({
      speechDetected: true,
      text: 'too short',
      audioDurationSeconds: 0.5,
      segments: [{ startSeconds: 0, endSeconds: 0.5, text: 'too short' }],
    });

    await expect(new RecordingRepairService().process('call-1', 'capture-1')).rejects.toThrow(
      'Decoded repair audio duration differs from metadata'
    );
    expect(applyRecordingRepair).not.toHaveBeenCalled();
    expect(markFailed).toHaveBeenCalledWith(
      'call-1',
      'capture-1',
      expect.stringContaining('differs from metadata'),
      'lease-1',
      false
    );
  });

  it('uses VAD segment boundaries for transcript timestamps and replacement coverage', async () => {
    transcribeRecordingRepair.mockResolvedValue({
      speechDetected: true,
      text: 'first second',
      audioDurationSeconds: 2,
      segments: [{ startSeconds: 0.4, endSeconds: 1.4, text: 'first second' }],
    });

    await new RecordingRepairService().process('call-1', 'capture-1');

    expect(applyRecordingRepair).toHaveBeenCalledWith(
      'call-1',
      [expect.objectContaining({ text: 'first second', timestamp: 5.4 })],
      [{ startedAt: 5_400, endedAt: 6_400 }],
      expect.any(Function)
    );
  });
});
