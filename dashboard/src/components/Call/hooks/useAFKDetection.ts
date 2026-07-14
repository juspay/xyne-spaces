import { useState, useRef, useCallback, useEffect } from 'react';
import { playAudio, AUDIO_PATHS } from '../../../utils/audioPlayer';

const AFK_IDLE_TIMEOUT_SECONDS = 120;
const AFK_WARNING_TIMEOUT_SECONDS = 120;
const AFK_STAY_COOLDOWN_SECONDS = 300; // User clicked "Stay" - give them 5 minutes before next warning

interface UseAFKDetectionOptions {
  isLoneParticipant: boolean;
  onEndCall: () => void;
}

interface UseAFKDetectionReturn {
  showAFKModal: boolean;
  secondsRemaining: number; // Countdown for display in modal
  handleStay: () => void;
  handleLeave: () => void;
}

/**
 * Hook to detect AFK (away from keyboard) state when user is alone in a call.
 * Shows a warning modal after idle timeout, then auto-ends call if no response.
 */
export function useAFKDetection({
  isLoneParticipant,
  onEndCall,
}: UseAFKDetectionOptions): UseAFKDetectionReturn {
  const [showAFKModal, setShowAFKModal] = useState(false);
  const [secondsRemaining, setSecondsRemaining] = useState(0);

  // Timer refs
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const disconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const displayIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Guard against race conditions (user action vs auto-disconnect)
  const isWarningActiveRef = useRef(false);

  // Keep onEndCall stable in a ref to avoid stale closures in timers
  const onEndCallRef = useRef(onEndCall);
  onEndCallRef.current = onEndCall;

  // Clear all timers and reset state
  const clearAllTimers = useCallback(() => {
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
    if (disconnectTimerRef.current) {
      clearTimeout(disconnectTimerRef.current);
      disconnectTimerRef.current = null;
    }
    if (displayIntervalRef.current) {
      clearInterval(displayIntervalRef.current);
      displayIntervalRef.current = null;
    }
    isWarningActiveRef.current = false;
    setShowAFKModal(false);
    setSecondsRemaining(0);
  }, []);

  // Start the warning phase: show modal, start countdown display, schedule disconnect.
  const startWarningPhase = useCallback(() => {
    // Mark warning as active to guard against race conditions
    isWarningActiveRef.current = true;

    playAudio(AUDIO_PATHS.AFK_WARNING);
    setSecondsRemaining(AFK_WARNING_TIMEOUT_SECONDS);
    setShowAFKModal(true);

    // Schedule guaranteed disconnect - independent of display updates
    disconnectTimerRef.current = setTimeout(() => {
      // Only proceed if warning is still active (user didn't click Stay/Leave)
      if (!isWarningActiveRef.current) return;

      clearAllTimers();
      onEndCallRef.current();
    }, AFK_WARNING_TIMEOUT_SECONDS * 1000);

    // Display interval - pure UI update, no side effects
    displayIntervalRef.current = setInterval(() => {
      setSecondsRemaining(prev => (prev > 0 ? prev - 1 : 0));
    }, 1000);
  }, [clearAllTimers]);

  // Start the idle timer. When it fires, the warning phase begins.
  const startIdleTimer = useCallback(
    (durationSeconds: number) => {
      // Clear any existing idle timer
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current);
      }

      idleTimerRef.current = setTimeout(() => {
        idleTimerRef.current = null;
        startWarningPhase();
      }, durationSeconds * 1000);
    },
    [startWarningPhase],
  );

  // User clicked "Stay" - clear timers and restart 5-minute cooldown.
  const handleStay = useCallback(() => {
    if (!isWarningActiveRef.current) return;

    clearAllTimers();
    startIdleTimer(AFK_STAY_COOLDOWN_SECONDS);
  }, [clearAllTimers, startIdleTimer]);

  // User clicked "Leave" - clear timers and end call immediately.
  const handleLeave = useCallback(() => {
    if (!isWarningActiveRef.current) return;

    clearAllTimers();
    onEndCallRef.current();
  }, [clearAllTimers]);

  // Start/stop AFK detection based on lone participant status
  useEffect(() => {
    if (isLoneParticipant) {
      startIdleTimer(AFK_IDLE_TIMEOUT_SECONDS);
    } else {
      clearAllTimers();
    }
    return clearAllTimers;
  }, [isLoneParticipant, startIdleTimer, clearAllTimers]);

  return {
    showAFKModal,
    secondsRemaining,
    handleStay,
    handleLeave,
  };
}
