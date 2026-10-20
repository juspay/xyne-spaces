import { useCallback, useEffect, useRef, useState } from 'react';

import { useChatInputHandlers } from '@/src/components/input-composer';
import { composerNativeSetValue } from '@/src/components/input-composer/utils/conversation-input.utils';
import { useDictation, type DictationStatus } from '@/src/features/xyne-ai/hooks/useDictation';
import { haptics } from '@/src/utils/haptics';

import { consumeDictationEcho, queueDictationWrite } from '../model/typing-bar';

const PERMISSION_MESSAGE =
  'Allow microphone and speech recognition access in Settings to dictate messages.';

export type RoomDictation = {
  status: DictationStatus;
  listening: boolean;
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
export function useRoomDictation(): RoomDictation {
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
  const statusRef = useRef(dictation.status);
  const interruptRef = useRef(dictation.interrupt);
  useEffect(() => {
    statusRef.current = dictation.status;
    interruptRef.current = dictation.interrupt;
  });

  const onNativeText = useCallback((next: string): void => {
    setTextState(next);
    if (statusRef.current === 'idle') {
      pending.current = [];
      return;
    }
    const result = consumeDictationEcho(next, pending.current);
    pending.current = result.pending;
    if (!result.echo) interruptRef.current();
  }, []);

  const interrupt = useCallback((): void => interruptRef.current(), []);

  const start = (): void => {
    void haptics.buttonTap();
    pending.current = [];
    // Focus so the words show in the field as they are heard.
    inputRef.current?.focus();
    void dictation.start();
  };

  return {
    status: dictation.status,
    listening: dictation.status === 'listening',
    onNativeText,
    interrupt,
    start,
    stop: (): void => void dictation.stop(),
    cancel: dictation.cancel,
  };
}
