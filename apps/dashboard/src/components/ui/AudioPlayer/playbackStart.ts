/**
 * Guards the "loading" leg of playback so it always ends.
 *
 * `audio.play()` only rejects for some failures: a network error after the metadata
 * has loaded, or a source that stalls, leaves the promise pending forever — and the
 * player spinning with it. These helpers turn those cases into rejections.
 */

/** How long the audio element may take to start playing before the attempt fails. */
export const AUDIO_START_TIMEOUT_MS = 20_000;
/** How long the full recording download may take before it is given up on. */
export const AUDIO_DOWNLOAD_TIMEOUT_MS = 120_000;

/** The recording's media is missing, expired, empty or could not be reached in time. */
export class RecordingUnavailableError extends Error {
  constructor(message = 'Recording not available') {
    super(message);
    this.name = 'RecordingUnavailableError';
  }
}

/** Rejects with `RecordingUnavailableError` when `promise` has not settled within `timeoutMs`. */
export const withTimeout = <T>(
  promise: Promise<T>,
  timeoutMs: number,
  onTimeout?: () => void,
): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    // Reject before `onTimeout` aborts the work: the AbortError it causes must not win
    // the race, as callers treat aborts as an unmount and leave the state alone.
    timer = setTimeout(() => {
      reject(new RecordingUnavailableError('Timed out loading recording'));
      onTimeout?.();
    }, timeoutMs);
  });
  return Promise.race([promise, timedOut]).finally(() => clearTimeout(timer));
};

type PlayableMedia = Pick<HTMLMediaElement, 'play' | 'addEventListener' | 'removeEventListener'>;

/** Starts playback; rejects if the element reports an error or does not start in time. */
export const startPlayback = (
  media: PlayableMedia,
  timeoutMs = AUDIO_START_TIMEOUT_MS,
): Promise<void> => {
  let onError = (): void => {};
  const failed = new Promise<never>((_, reject) => {
    onError = (): void => reject(new RecordingUnavailableError());
  });
  media.addEventListener('error', onError);

  return withTimeout(Promise.race([media.play(), failed]), timeoutMs).finally(() =>
    media.removeEventListener('error', onError),
  );
};

/** Downloads the recording; an empty file or a stalled download counts as unavailable. */
export const downloadRecording = async (
  load: (signal: AbortSignal) => Promise<Blob>,
  controller: AbortController,
  timeoutMs = AUDIO_DOWNLOAD_TIMEOUT_MS,
): Promise<Blob> => {
  const blob = await withTimeout(load(controller.signal), timeoutMs, () => controller.abort());
  if (blob.size === 0) throw new RecordingUnavailableError();
  return blob;
};
