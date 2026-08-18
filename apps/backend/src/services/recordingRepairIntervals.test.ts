import { coalesceRecordingRepairCoverage } from './recordingRepairIntervals';

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
});
