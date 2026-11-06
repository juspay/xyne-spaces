import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadRecording, RecordingUnavailableError, startPlayback } from './playbackStart';

/** A media element whose `play()` never settles — what a stalled or expired source does. */
const stalledMedia = (): EventTarget & { play: () => Promise<void> } =>
  Object.assign(new EventTarget(), { play: () => new Promise<void>(() => {}) });

const settle = async <T>(promise: Promise<T>): Promise<{ ok: boolean; err?: unknown }> =>
  promise.then(
    () => ({ ok: true }),
    (err: unknown) => ({ ok: false, err }),
  );

describe('startPlayback', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('resolves once the media plays', async () => {
    const media = Object.assign(new EventTarget(), { play: () => Promise.resolve() });
    await expect(startPlayback(media, 1_000)).resolves.toBeUndefined();
  });

  it('rejects when the media errors without play() settling', async () => {
    const media = stalledMedia();
    const result = settle(startPlayback(media, 1_000));
    media.dispatchEvent(new Event('error'));
    const { ok, err } = await result;
    expect(ok).toBe(false);
    expect(err).toBeInstanceOf(RecordingUnavailableError);
  });

  it('rejects when the media never starts', async () => {
    const result = settle(startPlayback(stalledMedia(), 1_000));
    await vi.advanceTimersByTimeAsync(1_000);
    const { ok, err } = await result;
    expect(ok).toBe(false);
    expect(err).toBeInstanceOf(RecordingUnavailableError);
  });

  it('passes through a rejection from play()', async () => {
    const failure = new DOMException('no source', 'NotSupportedError');
    const media = Object.assign(new EventTarget(), { play: () => Promise.reject(failure) });
    await expect(startPlayback(media, 1_000)).rejects.toBe(failure);
  });
});

describe('downloadRecording', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('returns the downloaded recording', async () => {
    const blob = new Blob(['audio'], { type: 'audio/mp4' });
    await expect(
      downloadRecording(() => Promise.resolve(blob), new AbortController()),
    ).resolves.toBe(blob);
  });

  it('treats an empty file as unavailable', async () => {
    const load = (): Promise<Blob> => Promise.resolve(new Blob([]));
    await expect(downloadRecording(load, new AbortController())).rejects.toBeInstanceOf(
      RecordingUnavailableError,
    );
  });

  it('aborts and rejects a download that stalls', async () => {
    const controller = new AbortController();
    const load = (signal: AbortSignal): Promise<Blob> =>
      new Promise((_, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    const result = settle(downloadRecording(load, controller, 1_000));
    await vi.advanceTimersByTimeAsync(1_000);
    const { ok, err } = await result;
    expect(ok).toBe(false);
    expect(err).toBeInstanceOf(RecordingUnavailableError);
    expect(controller.signal.aborted).toBe(true);
  });
});
