import { describe, expect, it } from 'vitest';
import {
  describeUploadBlock,
  formatUploadBytes,
  nextUploadPhase,
  runWithConcurrency,
  summarizeUploads,
  uploadPercent,
  type AttachmentUploadState,
} from './attachmentUploadProgress';

describe('uploadPercent', () => {
  it('rounds and clamps to 0..100', () => {
    expect(uploadPercent({ loaded: 0, total: 0 })).toBe(0);
    expect(uploadPercent({ loaded: 512, total: 1024 })).toBe(50);
    expect(uploadPercent({ loaded: 2048, total: 1024 })).toBe(100);
    expect(uploadPercent({ loaded: 1, total: 3 })).toBe(33);
  });
});

describe('nextUploadPhase', () => {
  it('moves to processing once every byte is sent', () => {
    expect(nextUploadPhase(10, 100)).toBe('uploading');
    expect(nextUploadPhase(100, 100)).toBe('processing');
    expect(nextUploadPhase(0, 0)).toBe('uploading');
  });
});

describe('summarizeUploads', () => {
  const uploads: Record<string, AttachmentUploadState> = {
    a: { phase: 'uploading', loaded: 50, total: 100 },
    b: { phase: 'processing', loaded: 300, total: 300 },
    c: { phase: 'failed', loaded: 10, total: 100, error: 'Network Error' },
    other: { phase: 'uploading', loaded: 0, total: 999 },
  };

  it('only counts the requested attachments and weights percent by bytes', () => {
    const summary = summarizeUploads(uploads, ['a', 'b', 'c', 'missing']);
    expect(summary).toEqual({ inProgress: 2, failed: 1, loaded: 350, total: 400, percent: 88 });
  });

  it('is empty when nothing tracked', () => {
    expect(summarizeUploads(uploads, [])).toEqual({
      inProgress: 0,
      failed: 0,
      loaded: 0,
      total: 0,
      percent: 0,
    });
  });
});

describe('describeUploadBlock', () => {
  it('prioritises failures over progress', () => {
    expect(describeUploadBlock({ inProgress: 2, failed: 1, loaded: 0, total: 0, percent: 0 })).toBe(
      '1 file failed to upload — retry or remove it',
    );
    expect(describeUploadBlock({ inProgress: 0, failed: 3, loaded: 0, total: 0, percent: 0 })).toBe(
      '3 files failed to upload — retry or remove them',
    );
  });

  it('describes progress and returns null when idle', () => {
    expect(
      describeUploadBlock({ inProgress: 2, failed: 0, loaded: 1, total: 2, percent: 64 }),
    ).toBe('Uploading 2 files… 64%');
    expect(
      describeUploadBlock({ inProgress: 1, failed: 0, loaded: 1, total: 2, percent: 50 }),
    ).toBe('Uploading 1 file… 50%');
    expect(
      describeUploadBlock({ inProgress: 0, failed: 0, loaded: 0, total: 0, percent: 0 }),
    ).toBeNull();
  });
});

describe('formatUploadBytes', () => {
  it('formats B / KB / MB', () => {
    expect(formatUploadBytes(512)).toBe('512 B');
    expect(formatUploadBytes(40 * 1024)).toBe('40 KB');
    expect(formatUploadBytes(2.8 * 1024 * 1024)).toBe('2.8 MB');
  });
});

describe('runWithConcurrency', () => {
  it('never runs more than the limit at once and processes every item', async () => {
    let active = 0;
    let peak = 0;
    const seen: number[] = [];
    await runWithConcurrency([1, 2, 3, 4, 5, 6, 7], 3, async item => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 5));
      seen.push(item);
      active -= 1;
    });
    expect(peak).toBe(3);
    expect(seen.sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('handles fewer items than the limit and empty input', async () => {
    const seen: string[] = [];
    await runWithConcurrency(['x'], 3, item => {
      seen.push(item);
      return Promise.resolve();
    });
    await runWithConcurrency([], 3, () => {
      seen.push('never');
      return Promise.resolve();
    });
    expect(seen).toEqual(['x']);
  });
});
