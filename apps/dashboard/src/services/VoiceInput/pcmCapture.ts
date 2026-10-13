import workletUrl from './pcmCaptureWorklet.js?url';

// 100 ms of 16 kHz mono PCM16 — the frame size the voice stream endpoint expects.
const FRAME_SAMPLES = 1600;

const LEVEL_GAIN = 8;

const DEVICE_GONE = ['OverconstrainedError', 'NotFoundError'];

async function openMicrophone(
  audio: MediaTrackConstraints,
  deviceId?: string | null,
): Promise<MediaStream> {
  if (deviceId) {
    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: { ...audio, deviceId: { exact: deviceId } },
      });
    } catch (error) {
      if (!(error instanceof Error && DEVICE_GONE.includes(error.name))) throw error;
    }
  }
  return navigator.mediaDevices.getUserMedia({ audio });
}

export interface PcmCapture {
  label: string;
  /** Flushes the partial last frame. */
  stop(): void;
}

export const isPcmCaptureSupported = (): boolean =>
  !!navigator.mediaDevices?.getUserMedia && typeof AudioWorkletNode !== 'undefined';

const frameLevel = (samples: Int16Array): number => {
  let sum = 0;
  for (const sample of samples) sum += (sample / 0x8000) ** 2;
  return Math.min(1, Math.sqrt(sum / samples.length) * LEVEL_GAIN);
};

// One audio context and worklet module per page, reused by every capture. Device-default rate:
// Firefox rejects a mic source on a context with another rate, so the worklet downsamples to 16 kHz.
let shared: { context: AudioContext; workletLoaded: Promise<void> } | null = null;

function sharedAudio(): NonNullable<typeof shared> {
  if (!shared) {
    const context = new AudioContext();
    const workletLoaded = context.audioWorklet.addModule(workletUrl);
    const created = { context, workletLoaded };
    shared = created;
    // A failed load is retried by the next capture with a fresh context.
    workletLoaded.catch(() => {
      if (shared === created) shared = null;
      void context.close();
    });
  }
  return shared;
}

let activeCaptures = 0;

/** Raw PCM16 LE, mono, 16 kHz, in 100 ms frames. Throws if unsupported or mic access is refused. */
export async function startPcmCapture(params: {
  onFrame: (frame: ArrayBuffer) => void;
  onLevel?: (level: number) => void;
  deviceId?: string | null | undefined;
  onStep?: (step: string, detail?: string) => void;
}): Promise<PcmCapture> {
  const step = params.onStep ?? ((): void => undefined);
  if (!isPcmCaptureSupported()) {
    throw new Error('Audio capture is not supported in this browser');
  }
  // voiceIsolation (Chrome/Safari) is not in the DOM typings yet, and unsupported browsers must not be sent it.
  const audio: MediaTrackConstraints & { voiceIsolation?: boolean } = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: 1,
  };
  if ('voiceIsolation' in navigator.mediaDevices.getSupportedConstraints()) {
    audio.voiceIsolation = true;
  }
  // Started inside the user's press: Safari only lets an audio context run when it was resumed there.
  const { context, workletLoaded } = sharedAudio();
  step('Audio context', context.state);
  const running = context.resume();
  activeCaptures++;
  // The last capture to end puts the context back to sleep (a context that failed to load is already closed).
  let released = false;
  const release = (): void => {
    if (released) return;
    released = true;
    if (--activeCaptures === 0) context.suspend().catch(() => undefined);
  };
  let stream: MediaStream;
  step('Requesting microphone', params.deviceId ? 'chosen device' : 'default device');
  try {
    stream = await openMicrophone(audio, params.deviceId);
  } catch (error) {
    release();
    throw error;
  }
  step('Microphone granted', stream.getAudioTracks()[0]?.label ?? '');

  try {
    await Promise.all([running, workletLoaded]);
    step('Audio running', `context ${context.state}, worklet loaded, ${context.sampleRate} Hz`);
    const source = context.createMediaStreamSource(stream);
    const worklet = new AudioWorkletNode(context, 'pcm-capture', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 1,
    });
    // Some browsers only pull a worklet that reaches the destination; keep it silent.
    const mute = context.createGain();
    mute.gain.value = 0;

    let frame = new Int16Array(FRAME_SAMPLES);
    let filled = 0;
    const emit = (): void => {
      const samples = frame.slice(0, filled);
      params.onFrame(samples.buffer);
      params.onLevel?.(frameLevel(samples));
      frame = new Int16Array(FRAME_SAMPLES);
      filled = 0;
    };
    worklet.port.onmessage = (event: MessageEvent<ArrayBuffer>): void => {
      const samples = new Int16Array(event.data);
      let offset = 0;
      while (offset < samples.length) {
        const take = Math.min(FRAME_SAMPLES - filled, samples.length - offset);
        frame.set(samples.subarray(offset, offset + take), filled);
        filled += take;
        offset += take;
        if (filled === FRAME_SAMPLES) emit();
      }
    };

    source.connect(worklet);
    worklet.connect(mute);
    mute.connect(context.destination);

    return {
      label: stream.getAudioTracks()[0]?.label ?? '',
      stop(): void {
        worklet.port.postMessage('stop');
        source.disconnect();
        worklet.disconnect();
        mute.disconnect();
        worklet.port.onmessage = null;
        stream.getTracks().forEach(track => track.stop());
        if (filled > 0) emit();
        release();
      },
    };
  } catch (error) {
    stream.getTracks().forEach(track => track.stop());
    release();
    throw error;
  }
}
