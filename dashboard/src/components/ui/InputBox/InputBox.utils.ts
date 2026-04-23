import { useRef, useEffect, useCallback } from 'react';

export const TIMING_CONSTANTS = {
  SEARCH_DEBOUNCE_MS: 300,
  TYPING_DEBOUNCE_MS: 1000,
};

export const useTypingDebounce = (
  callback: (() => void) | undefined,
  delay: number = TIMING_CONSTANTS.TYPING_DEBOUNCE_MS,
): (() => void) => {
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isFirstCallRef = useRef(true);

  useEffect(() => {
    return (): void => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return useCallback((): void => {
    if (!callback) return;

    //Call immediately on first keystroke
    if (isFirstCallRef.current) {
      callback();
      isFirstCallRef.current = false; // Mark as "already fired"
    }

    // Cancel any existing timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = setTimeout(() => {
      isFirstCallRef.current = true;
    }, delay);
  }, [callback, delay]);
};
export const formatTypingMessage = (typingUsers: Array<{ username: string }>): string => {
  if (typingUsers.length === 0) return '';
  if (typingUsers.length === 1 && typingUsers[0]) return `${typingUsers[0].username} is typing`;
  if (typingUsers.length === 2 && typingUsers[0] && typingUsers[1])
    return `${typingUsers[0].username} and ${typingUsers[1].username} are typing`;
  if (typingUsers[0])
    return `${typingUsers[0].username} and ${typingUsers.length - 1} others are typing`;
  return '';
};
