import {
  coalesceRecordingRepairCoverage,
  outagesAreFullyCovered,
  recordingRepairOutagesHash,
  validateRecordingRepairOutages,
} from './recordingRepairIntervals';

describe('recording repair intervals', () => {
  it('coalesces adjacent reason-split intervals before VAD/STT', () => {
    expect(coalesceRecordingRepairCoverage([
      { startedAt: 1_000, endedAt: 2_000 },
      { startedAt: 2_000, endedAt: 3_000 },
      { startedAt: 4_000, endedAt: 5_000 },
    ])).toEqual([
      { startedAt: 1_000, endedAt: 3_000 },
      { startedAt: 4_000, endedAt: 5_000 },
    ]);
  });

  it('rejects nominal outage coverage containing a real gap', () => {
    expect(outagesAreFullyCovered(
      [{ startedAt: 1_000, endedAt: 4_000 }],
      [
        { startedAt: 1_000, endedAt: 2_000 },
        { startedAt: 2_100, endedAt: 4_000 },
      ],
    )).toBe(false);
  });

  it('hashes normalized finalized outages deterministically', () => {
    const first = validateRecordingRepairOutages([{
      startedAt: '2026-08-14T10:00:00.000Z',
      endedAt: '2026-08-14T10:00:10.000Z',
      reasons: ['livekit_disconnected', 'agent_left'],
    }]);
    const retry = validateRecordingRepairOutages([{
      startedAt: '2026-08-14T10:00:00.000Z',
      endedAt: '2026-08-14T10:00:10.000Z',
      reasons: ['agent_left', 'livekit_disconnected'],
    }]);

    expect(recordingRepairOutagesHash(first)).toBe(recordingRepairOutagesHash(retry));
  });
});
