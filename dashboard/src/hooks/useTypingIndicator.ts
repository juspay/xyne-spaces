// ============================================================================
// USE TYPING INDICATOR HOOK
// ============================================================================
// Custom hook for managing typing indicator state and websocket communication
// Handles start/stop typing events, timeouts, and cleanup
// ============================================================================

import { useState, useRef, useCallback, useEffect } from 'react';
import { websocketService } from '../services/clients/socketClient';

export const useTypingIndicator = (
  sessionId?: string,
): {
  isTyping: boolean;
  handleTyping: () => void;
  startTyping: () => void;
  stopTyping: () => void;
} => {
  // --------------------------------------------------------------------------
  // STATE
  // --------------------------------------------------------------------------
  const [isTyping, setIsTyping] = useState(false);
  const isTypingRef = useRef(false);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const sessionIdRef = useRef(sessionId);

  // --------------------------------------------------------------------------
  // EFFECT - Update Session ID Ref
  // --------------------------------------------------------------------------
  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  // --------------------------------------------------------------------------
  // HANDLERS - Stop Typing (declared first to avoid circular dependency)
  // --------------------------------------------------------------------------
  const stopTyping = useCallback((): void => {
    const currentSessionId = sessionIdRef.current;
    if (!currentSessionId || !isTypingRef.current) return;

    setIsTyping(false);
    isTypingRef.current = false;
    websocketService.stopTyping(currentSessionId);

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }
  }, []);

  // --------------------------------------------------------------------------
  // HANDLERS - Start Typing
  // --------------------------------------------------------------------------
  const startTyping = useCallback((): void => {
    const currentSessionId = sessionIdRef.current;
    if (!currentSessionId || isTypingRef.current) return;

    setIsTyping(true);
    isTypingRef.current = true;
    websocketService.startTyping(currentSessionId);

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    typingTimeoutRef.current = setTimeout(() => {
      stopTyping();
    }, 3000);
  }, [stopTyping]);

  // --------------------------------------------------------------------------
  // HANDLERS - Handle Typing (debounced)
  // --------------------------------------------------------------------------
  const handleTyping = useCallback((): void => {
    if (!sessionIdRef.current) return;

    if (!isTypingRef.current) {
      startTyping();
    } else {
      // Refresh timeout if already typing
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
      typingTimeoutRef.current = setTimeout(() => {
        stopTyping();
      }, 3000);
    }
  }, [startTyping, stopTyping]);

  // --------------------------------------------------------------------------
  // EFFECT - Cleanup on Unmount
  // --------------------------------------------------------------------------
  useEffect(() => {
    return (): void => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
      if (isTypingRef.current && sessionIdRef.current) {
        websocketService.stopTyping(sessionIdRef.current);
      }
    };
  }, []);

  // --------------------------------------------------------------------------
  // EFFECT - Stop Typing on Visibility Change or Blur
  // --------------------------------------------------------------------------
  useEffect(() => {
    const handleVisibilityChange = (): void => {
      if (document.hidden && isTypingRef.current && sessionIdRef.current) {
        stopTyping();
      }
    };

    const handleWindowBlur = (): void => {
      if (isTypingRef.current && sessionIdRef.current) {
        stopTyping();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleWindowBlur);

    return (): void => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleWindowBlur);
    };
  }, [isTyping, stopTyping]);

  // --------------------------------------------------------------------------
  // RETURN
  // --------------------------------------------------------------------------
  return {
    isTyping,
    handleTyping,
    startTyping,
    stopTyping,
  };
};
