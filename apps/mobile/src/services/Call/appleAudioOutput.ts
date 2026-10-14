/**
 * Speaker ↔ phone (earpiece) for iOS calls.
 *
 * iOS has no "use this output" call. The audio session's mode decides where the built-in output
 * goes: `videoChat` plays through the speaker and takes the earpiece out of the route list (so
 * the system picker only ever offers "Speaker"), `voiceChat` uses the earpiece. LiveKit applies
 * its session policy again each time the audio engine starts or stops, so a choice is written
 * to that policy as well as to the live session — otherwise the next engine change undoes it.
 * A Bluetooth or wired headset still wins over either.
 */
import {
  AudioSession,
  setupIOSAudioManagement,
  type AppleAudioConfiguration,
} from '@livekit/react-native';

export type AppleAudioOutput = 'speaker' | 'earpiece';

/** LiveKit's own session while the mic is live; the two outputs differ only in the mode. */
const SPEAKER_SESSION: AppleAudioConfiguration = {
  audioCategory: 'playAndRecord',
  audioCategoryOptions: ['allowBluetooth', 'mixWithOthers'],
  audioMode: 'videoChat',
};

const SESSIONS: Record<AppleAudioOutput, AppleAudioConfiguration> = {
  speaker: SPEAKER_SESSION,
  earpiece: { ...SPEAKER_SESSION, audioMode: 'voiceChat' },
};

/** Mirrors LiveKit's policy, which is process-wide and outlives the call screen. */
let current: AppleAudioOutput = 'speaker';
const listeners = new Set<() => void>();

function setCurrent(output: AppleAudioOutput): void {
  if (current === output) return;
  current = output;
  listeners.forEach(listener => listener());
}

function applyPolicy(output: AppleAudioOutput): void {
  if (output === 'speaker') {
    setupIOSAudioManagement(true);
    return;
  }
  // LiveKit's listen-only session is playback, which has no earpiece: keep the call session
  // for listening too, so the earpiece holds before the mic is first turned on.
  setupIOSAudioManagement(false, { recording: SESSIONS.earpiece, playout: SESSIONS.earpiece });
}

export function getAppleAudioOutput(): AppleAudioOutput {
  return current;
}

export function subscribeAppleAudioOutput(listener: () => void): () => void {
  listeners.add(listener);
  return (): void => {
    listeners.delete(listener);
  };
}

export async function selectAppleAudioOutput(output: AppleAudioOutput): Promise<void> {
  applyPolicy(output);
  try {
    await AudioSession.setAppleAudioConfiguration(SESSIONS[output]);
  } catch (error) {
    applyPolicy(current);
    throw error;
  }
  setCurrent(output);
}

/**
 * Every call starts on the speaker, LiveKit's default. Only the policy is restored — the engine
 * applies it when the call's audio starts — so the session CallKit activates is left alone.
 */
export function resetAppleAudioOutput(): void {
  if (current === 'speaker') return;
  applyPolicy('speaker');
  setCurrent('speaker');
}
