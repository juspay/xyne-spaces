/**
 * Regression tests for review feedback on the compat video rendition worker:
 * 1. `ready` status is not trusted when compat.mp4 is missing.
 * 2. Queue job ids hash the NORMALIZED storage path.
 * 3. enqueue() reports failure instead of pretending the job is queued.
 */
// @xyne/storage ships ESM in dist/, which this jest setup cannot parse; the
// only things used here are pure helpers, so stub them faithfully.
jest.mock('@xyne/storage', () => ({
  normalizeStoragePath: (url: string) => {
    const match = url.match(/^(?:gs|s3|az):\/\/[^/]+\/(.+)$/);
    return match ? match[1] : url;
  },
  isPreconditionFailed: () => false,
}));
const mockAdd = jest.fn();
jest.mock('bull', () =>
  jest.fn().mockImplementation(() => ({ add: mockAdd, on: jest.fn(), close: jest.fn() }))
);
jest.mock('@/services/redisService', () => ({ redisService: { getRedisConfig: () => ({}) } }));
jest.mock('@/services/storage', () => ({ storageService: {} }));
jest.mock('@/utils/ffmpeg', () => ({
  MediaTimeoutError: class extends Error {},
  probeVideo: jest.fn(),
  transcodeToCompatMp4: jest.fn(),
}));

import { generateVideoRendition, videoRenditionCacheBase } from '../videoRenditionService';
import {
  renditionJobId,
  STALE_WAITING_MS,
  videoRenditionQueue,
} from '../../queues/videoRenditionQueue';

const PATH = 'attachments/CONVERSATION/temp/2026/10/x-img_2311.mov';

function storageWith(status: object, compatExists: boolean) {
  const base = videoRenditionCacheBase(PATH);
  return {
    fileExists: jest.fn(async (p: string) =>
      p === `${base}/status.json` ? true : p === `${base}/compat.mp4` ? compatExists : false
    ),
    getFileBuffer: jest.fn(async () =>
      Buffer.from(JSON.stringify({ v: 1, at: Date.now(), reasons: [], ...status }))
    ),
    // Throwing here = "original deleted" → generateVideoRendition returns 'missing'.
    getFileMetadata: jest.fn(async () => {
      throw new Error('gone');
    }),
    uploadFileV2: jest.fn(),
  };
}

describe('generateVideoRendition — ready status vs missing object', () => {
  it('honours ready when compat.mp4 exists (no regeneration)', async () => {
    const storage = storageWith({ status: 'ready' }, true);
    await expect(generateVideoRendition(storage as never, PATH)).resolves.toBe('ready');
    expect(storage.getFileMetadata).not.toHaveBeenCalled();
  });

  it('regenerates when status is ready but compat.mp4 is gone', async () => {
    const storage = storageWith({ status: 'ready' }, false);
    // Falls through past the status check and reaches the source lookup.
    await expect(generateVideoRendition(storage as never, PATH)).resolves.toBe('missing');
    expect(storage.getFileMetadata).toHaveBeenCalledWith(PATH);
  });

  it('still honours not_needed without checking for an object', async () => {
    const storage = storageWith({ status: 'not_needed' }, false);
    await expect(generateVideoRendition(storage as never, PATH)).resolves.toBe('not_needed');
    expect(storage.getFileMetadata).not.toHaveBeenCalled();
  });
});

describe('videoRenditionQueue', () => {
  beforeEach(() => mockAdd.mockReset());

  it('uses the same job id for gs://bucket/path and path', () => {
    expect(renditionJobId(`gs://xyne-bucket/${PATH}`)).toBe(renditionJobId(PATH));
    expect(renditionJobId(PATH)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns true when the job is queued', async () => {
    mockAdd.mockResolvedValue({ id: 'j', timestamp: Date.now(), getState: async () => 'waiting' });
    await expect(videoRenditionQueue.enqueue({ storagePath: PATH })).resolves.toBe(true);
  });

  it('returns false when Redis rejects the add', async () => {
    mockAdd.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(videoRenditionQueue.enqueue({ storagePath: PATH })).resolves.toBe(false);
  });

  it('returns false when the existing job has been waiting too long (no worker)', async () => {
    mockAdd.mockResolvedValue({
      id: 'j',
      timestamp: Date.now() - STALE_WAITING_MS - 1000,
      getState: async () => 'waiting',
    });
    await expect(videoRenditionQueue.enqueue({ storagePath: PATH })).resolves.toBe(false);
  });

  it('returns true for an old job that is actively processing', async () => {
    mockAdd.mockResolvedValue({
      id: 'j',
      timestamp: Date.now() - STALE_WAITING_MS - 1000,
      getState: async () => 'active',
    });
    await expect(videoRenditionQueue.enqueue({ storagePath: PATH })).resolves.toBe(true);
  });
});
