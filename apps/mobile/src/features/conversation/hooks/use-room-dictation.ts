import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

import { useChatInputHandlers } from '@/src/components/input-composer';
import { composerNativeSetValue } from '@/src/components/input-composer/utils/conversation-input.utils';
import { useLatestRef } from '@/src/components/input-composer/utils/use-latest-ref';
import { useDictation, type DictationStatus } from '@/src/features/xyne-ai/hooks/useDictation';

import { consumeDictationEcho, queueDictationWrite } from '../model/typing-bar';

const PERMISSION_MESSAGE =
  'Allow microphone and speech recognition access in Settings to dictate messages.';

/** Stable for the bar's lifetime, so holding them never re-renders anything. */
type RoomDictationControls = {
  /** Reports every native text change (typed, pasted or echoed) to the echo guard. */
  onNativeText: (text: string) => void;
  /** Stops dictation, keeping the text (used when another entry point opens). */
  interrupt: () => void;
  start: () => void;
  stop: () => void;
  cancel: () => void;
};

/**
 * Dictation for the typing bar. It runs only on an empty field, so it starts
 * from nothing and writes through the editor like a restored draft does.
 * Typing while it listens stops it; the editor echoing its own writes does not.
 */
export function useRoomDictation(): { status: DictationStatus; controls: RoomDictationControls } {
  const { inputRef } = useChatInputHandlers();
  const [text, setTextState] = useState('');
  // Every value written but not yet echoed back, oldest first.
  const pending = useRef<readonly string[]>([]);

  const setText = useCallback(
    (next: string): void => {
      pending.current = queueDictationWrite(pending.current, next);
      inputRef.current?.setValue(composerNativeSetValue(next, ''));
      setTextState(next);
    },
    [inputRef],
  );

  const dictation = useDictation(text, setText, { permissionMessage: PERMISSION_MESSAGE });
  const latest = useLatestRef(dictation);

  const onNativeText = useCallback(
    (next: string): void => {
      setTextState(next);
      if (latest.current.status === 'idle') {
        pending.current = [];
        return;
      }
      const result = consumeDictationEcho(next, pending.current);
      pending.current = result.pending;
      if (!result.echo) latest.current.interrupt();
    },
    [latest],
  );

  const controls = useMemo<RoomDictationControls>(
    () => ({
      onNativeText,
      interrupt: (): void => latest.current.interrupt(),
      start: (): void => {
        pending.current = [];
        // Focus so the words show in the field as they are heard.
        inputRef.current?.focus();
        void latest.current.start();
      },
      stop: (): void => void latest.current.stop(),
      cancel: (): void => latest.current.cancel(),
    }),
    [inputRef, latest, onNativeText],
  );

  return { status: dictation.status, controls };
}

/**
 * Split so the field and "+" (which only hold controls) never re-render while
 * dictation runs; only what shows the status does.
 */
export const RoomDictationStatusContext = createContext<DictationStatus>('idle');
export const RoomDictationControlsContext = createContext<RoomDictationControls | null>(null);

export const useRoomDictationStatus = (): DictationStatus => useContext(RoomDictationStatusContext);

export function useRoomDictationControls(): RoomDictationControls {
  const controls = useContext(RoomDictationControlsContext);
  if (!controls) {
    throw new Error('useRoomDictationControls must be used within <RoomDictationProvider>');
  }
  return controls;
}
