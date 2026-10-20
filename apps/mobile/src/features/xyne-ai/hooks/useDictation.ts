import { useEffect, useRef, useState } from 'react';
import { Alert, Linking, Platform } from 'react-native';
import {
  ExpoSpeechRecognitionModule as Speech,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition';

import { callRuntimeNativeService } from '@/src/services/CallRuntimeNativeService';
import { showMessageToast } from '@/src/utils/toast';

import {
  EMPTY_TRANSCRIPT,
  applyResult,
  dictatedText,
  type Transcript,
} from '../model/dictationText';

const FINAL_RESULT_TIMEOUT_MS = 1500;
const QUIET_ERRORS = new Set(['aborted', 'no-speech']);

export type DictationStatus = 'idle' | 'listening' | 'stopping';

interface Session {
  base: string;
  transcript: Transcript;
  /** Whether results still go into the input. */
  writes: boolean;
  ended: Promise<void>;
  end: () => void;
}

export interface Dictation {
  status: DictationStatus;
  start: () => Promise<void>;
  /** Stops listening and resolves with the text once the last words are in. */
  stop: () => Promise<string>;
  /** Stops and puts the text back as it was before dictation. */
  cancel: () => void;
  /** Stops because the text is being changed elsewhere, keeping it as it is. */
  interrupt: () => void;
}

const DEFAULT_PERMISSION_MESSAGE =
  'Allow microphone and speech recognition access in Settings to dictate to Xyne AI.';

export interface DictationOptions {
  /** Body of the alert shown when microphone access is off. Unset keeps the Xyne AI wording. */
  permissionMessage?: string;
}

const showPermissionAlert = (message: string): void =>
  Alert.alert('Microphone access is off', message, [
    { text: 'Not now', style: 'cancel' },
    { text: 'Open Settings', onPress: (): void => void Linking.openSettings() },
  ]);

// The recogniser leaves the iOS audio session active, which keeps other apps' audio paused.
const releaseAudioSession = (): void => {
  if (Platform.OS === 'ios') Speech.setAudioSessionActiveIOS(false);
};

const wait = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

export function useDictation(
  text: string,
  setText: (text: string) => void,
  options: DictationOptions = {},
): Dictation {
  const permissionMessage = options.permissionMessage ?? DEFAULT_PERMISSION_MESSAGE;
  const [status, setStatus] = useState<DictationStatus>('idle');
  // Lives until the recogniser reports `end`, so a new session never overlaps the old one.
  const session = useRef<Session | null>(null);
  const latestText = useRef(text);
  latestText.current = text;

  useSpeechRecognitionEvent('result', ({ results, isFinal }) => {
    const current = session.current;
    if (!current?.writes) return;
    current.transcript = applyResult(current.transcript, results[0]?.transcript ?? '', isFinal);
    setText(dictatedText(current.base, current.transcript));
  });

  useSpeechRecognitionEvent('error', ({ error }) => {
    if (!session.current?.writes) return;
    session.current.writes = false;
    if (error === 'not-allowed') showPermissionAlert(permissionMessage);
    else if (!QUIET_ERRORS.has(error))
      showMessageToast('Dictation stopped. Please try again.', 'error');
  });

  useSpeechRecognitionEvent('end', () => {
    session.current?.end();
    session.current = null;
    setStatus('idle');
    releaseAudioSession();
  });

  useEffect(
    () => (): void => {
      if (!session.current) return;
      Speech.abort();
      releaseAudioSession();
    },
    [],
  );

  const start = async (): Promise<void> => {
    if (session.current) return;
    if (callRuntimeNativeService.getActiveCall()) {
      Alert.alert('End the call to use dictation.');
      return;
    }
    let end = (): void => undefined;
    const ended = new Promise<void>(resolve => (end = resolve));
    session.current = {
      base: latestText.current,
      transcript: EMPTY_TRANSCRIPT,
      writes: true,
      ended,
      end,
    };
    setStatus('listening');

    const { granted, canAskAgain } = await Speech.requestPermissionsAsync();
    if (!granted) {
      session.current = null;
      setStatus('idle');
      if (!canAskAgain) showPermissionAlert(permissionMessage);
      return;
    }
    Speech.start({
      lang: 'en-US',
      interimResults: true,
      continuous: true,
      addsPunctuation: true,
      iosTaskHint: 'dictation',
      volumeChangeEventOptions: { enabled: true },
    });
  };

  const stop = async (): Promise<string> => {
    const current = session.current;
    if (!current?.writes) return latestText.current;
    setStatus('stopping');
    Speech.stop();
    await Promise.race([current.ended, wait(FINAL_RESULT_TIMEOUT_MS)]);
    current.writes = false;
    return dictatedText(current.base, current.transcript);
  };

  const abort = (restoreText: boolean): void => {
    const current = session.current;
    if (!current?.writes) return;
    current.writes = false;
    if (restoreText) setText(current.base);
    setStatus('stopping');
    Speech.abort();
  };

  return {
    status,
    start,
    stop,
    cancel: (): void => abort(true),
    interrupt: (): void => abort(false),
  };
}
