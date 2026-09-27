import { beforeEach, describe, expect, it } from 'vitest';
import { useAttachmentUploadStore } from './useAttachmentUploadStore';

const store = (): ReturnType<typeof useAttachmentUploadStore.getState> =>
  useAttachmentUploadStore.getState();

describe('useAttachmentUploadStore', () => {
  beforeEach(() => {
    useAttachmentUploadStore.setState({ uploads: {} });
  });

  it('tracks an upload from start through processing', () => {
    store().start('a', 1000);
    expect(store().uploads.a).toEqual({ phase: 'uploading', loaded: 0, total: 1000 });
    store().progress('a', 400, 1000);
    expect(store().uploads.a).toEqual({ phase: 'uploading', loaded: 400, total: 1000 });
    store().progress('a', 1000, 1000);
    expect(store().uploads.a?.phase).toBe('processing');
  });

  it('keeps bytes on failure and does not let late progress overwrite it', () => {
    store().start('a', 1000);
    store().progress('a', 300, 1000);
    store().fail('a', 'Network Error');
    store().progress('a', 900, 1000);
    expect(store().uploads.a).toEqual({
      phase: 'failed',
      loaded: 300,
      total: 1000,
      error: 'Network Error',
    });
  });

  it('ignores progress for untracked (cancelled) uploads', () => {
    store().progress('ghost', 10, 100);
    expect(store().uploads.ghost).toBeUndefined();
  });

  it('restarts cleanly on retry and clears on completion', () => {
    store().start('a', 1000);
    store().fail('a', 'boom');
    store().start('a', 1000);
    expect(store().uploads.a).toEqual({ phase: 'uploading', loaded: 0, total: 1000 });
    store().clear(['a']);
    expect(store().uploads).toEqual({});
  });

  it('clear is a no-op when nothing matches', () => {
    store().start('a', 1);
    const before = store().uploads;
    store().clear(['nope']);
    expect(store().uploads).toBe(before);
  });
});
