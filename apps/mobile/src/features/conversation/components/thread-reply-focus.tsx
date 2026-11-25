import { useEffect } from 'react';
import { useLocalSearchParams } from 'expo-router';

import { useChatInputHandlers } from '@/src/components/input-composer';

import { THREAD_REPLY_FOCUS_DELAY_MS } from '../constants';

/**
 * Inside the thread card's composer: a thread opened to reply (All threads'
 * Reply) puts the caret in the field once the card has arrived, so the
 * keyboard does not rise into a card still sliding in.
 */
export function ThreadReplyFocus(): null {
  const { focus } = useLocalSearchParams<{ focus?: string }>();
  const { inputRef } = useChatInputHandlers();
  const wantsFocus = focus === '1';

  useEffect(() => {
    if (!wantsFocus) return undefined;
    const timer = setTimeout(() => inputRef.current?.focus(), THREAD_REPLY_FOCUS_DELAY_MS);
    return (): void => clearTimeout(timer);
  }, [inputRef, wantsFocus]);

  return null;
}
