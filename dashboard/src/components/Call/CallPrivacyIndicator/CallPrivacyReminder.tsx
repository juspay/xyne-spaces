import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import type { CallPrivacyAction } from './callPrivacyActions';
import { useCallPrivacyReminderConfig } from './callPrivacyReminderCacConfig';
import { playAudio } from '../../../utils/audioPlayer';
import { cn } from '../../../utils/classNames';

// Timers for the call transcription/recording disclosure are sourced from
// Superposition CAC (see callPrivacyReminderCacConfig.ts).
const REMINDER_SOUND_PATH = '/sounds/notification.wav';
const SOUND_DEDUPE_MS = 5_000;
const REMINDER_FOLD_DURATION_MS = 700;
const FALLBACK_REMINDER_CLOCK_LIMIT = 50;

export interface CallReminderClock {
  nextReminderAt: number;
  visibleUntil: number;
  initialShown: boolean;
  reminderIntervalMs?: number;
}

export function createCallReminderClock(): CallReminderClock {
  return { nextReminderAt: 0, visibleUntil: 0, initialShown: false };
}

// Best-effort fallback for callers that do not pass a clockRef. Full-call views
// should prefer clockRef lifecycle ownership; this bounded store only preserves
// reminder state across remounts for no-ref callers without unbounded retention.
const fallbackReminderClocks = new Map<string, CallReminderClock>();

function readFallbackReminderClock(callId: string): CallReminderClock {
  const existing = fallbackReminderClocks.get(callId);
  if (existing) {
    fallbackReminderClocks.delete(callId);
    fallbackReminderClocks.set(callId, existing);
    return existing;
  }

  const clock = createCallReminderClock();
  fallbackReminderClocks.set(callId, clock);
  if (fallbackReminderClocks.size > FALLBACK_REMINDER_CLOCK_LIMIT) {
    const oldestCallId = fallbackReminderClocks.keys().next().value;
    if (oldestCallId) fallbackReminderClocks.delete(oldestCallId);
  }
  return clock;
}

function resolveReminderClock(
  clockRef: MutableRefObject<CallReminderClock> | undefined,
  callId: string | undefined,
): CallReminderClock | null {
  if (clockRef) return clockRef.current;
  if (callId) {
    return readFallbackReminderClock(callId);
  }
  return null;
}

interface CallPrivacyReminderProps {
  title: string;
  actions: CallPrivacyAction[];
  isRecordingActive: boolean;
  callId?: string | undefined;
  triggerKey?: number | undefined;
  enabled?: boolean | undefined;
  // Session-scoped reminder clock, owned by an always-mounted parent so it
  // persists across mini <-> full view switches.
  clockRef?: MutableRefObject<CallReminderClock> | undefined;
}

interface ReminderContent {
  title: string;
  action: CallPrivacyAction;
}

export function useCallPrivacyReminder({
  title,
  actions,
  isRecordingActive,
  callId,
  triggerKey,
  enabled = true,
  clockRef,
}: CallPrivacyReminderProps): {
  reminder: React.ReactElement | null;
  isReminderVisible: boolean;
} {
  const { intervalMs: REMINDER_INTERVAL_MS, visibleMs: REMINDER_VISIBLE_MS } =
    useCallPrivacyReminderConfig();

  const [visible, setVisible] = useState(false);
  const [foldingClosed, setFoldingClosed] = useState(false);
  const [reminderContent, setReminderContent] = useState<ReminderContent | null>(null);
  const hideTimerRef = useRef<number | null>(null);
  const foldTimerRef = useRef<number | null>(null);
  const previousRecordingActiveRef = useRef(isRecordingActive);
  const previousTriggerKeyRef = useRef(triggerKey);
  const latestReminderRef = useRef<ReminderContent | null>(null);
  const lastSoundAtRef = useRef(0);
  const suppressNextRecordingActiveSoundRef = useRef(false);
  const activeAction =
    actions.find(action => action.tone === (isRecordingActive ? 'recording' : 'ai')) ?? actions[0];
  const latestReminder = useMemo<ReminderContent | null>(
    () => (activeAction ? { title, action: activeAction } : null),
    [activeAction, title],
  );

  useEffect(() => {
    latestReminderRef.current = latestReminder;
  }, [latestReminder]);

  const clearHideTimer = useCallback((): void => {
    if (hideTimerRef.current) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const clearFoldTimer = useCallback((): void => {
    if (foldTimerRef.current) {
      window.clearTimeout(foldTimerRef.current);
      foldTimerRef.current = null;
    }
  }, []);

  // Show the popup for `visibleMs` more milliseconds. Callers own the continuous
  // clock; this only drives the local visual state + hide timer + optional sound.
  const showReminder = useCallback(
    (visibleMs: number, opts?: { playSound?: boolean }): void => {
      const nextReminder = latestReminderRef.current;
      if (!nextReminder || visibleMs <= 0) return;

      clearHideTimer();
      clearFoldTimer();
      setReminderContent(nextReminder);
      setFoldingClosed(false);
      setVisible(true);

      if (opts?.playSound) {
        const now = Date.now();
        if (now - lastSoundAtRef.current > SOUND_DEDUPE_MS) {
          lastSoundAtRef.current = now;
          playAudio(REMINDER_SOUND_PATH, 0.25);
        }
      }

      hideTimerRef.current = window.setTimeout(() => {
        setVisible(false);
        setFoldingClosed(true);
        hideTimerRef.current = null;
        foldTimerRef.current = window.setTimeout(() => {
          setFoldingClosed(false);
          foldTimerRef.current = null;
        }, REMINDER_FOLD_DURATION_MS);
      }, visibleMs);
    },
    [clearHideTimer, clearFoldTimer],
  );

  // Ring the disclosure now for a full visible window and advance the session
  // clock's visible window, so a later view switch resumes (not restarts) it.
  const ringNow = useCallback(
    (opts?: { playSound?: boolean }): void => {
      const clock = resolveReminderClock(clockRef, callId);
      if (clock) {
        clock.visibleUntil = Date.now() + REMINDER_VISIBLE_MS;
      }
      showReminder(REMINDER_VISIBLE_MS, opts);
    },
    [clockRef, callId, showReminder, REMINDER_VISIBLE_MS],
  );

  useEffect(() => {
    if (!enabled) {
      setVisible(false);
      setFoldingClosed(false);
      previousRecordingActiveRef.current = isRecordingActive;
      previousTriggerKeyRef.current = triggerKey;
      clearHideTimer();
      clearFoldTimer();
    }
  }, [enabled, isRecordingActive, triggerKey, clearHideTimer, clearFoldTimer]);

  // Initial disclosure (once per call) + recurring reminder on a continuous,
  // cross-view clock. On every mini <-> full switch this effect re-runs, but the
  // session-scoped clock (owned by the parent ref) ensures:
  //   - the initial sound + popup fire only the first time full view is shown,
  //   - a plain switch never re-rings or re-opens the popup,
  //   - the recurring cadence and the visible window are measured in wall-clock
  //     time and are not restarted by the switch.
  useEffect(() => {
    if (!enabled) return;

    const clock = resolveReminderClock(clockRef, callId);
    if (!clock) {
      // No clock available: fall back to a simple once-on-mount disclosure so
      // behaviour degrades gracefully.
      showReminder(REMINDER_VISIBLE_MS, { playSound: true });
      return clearHideTimer;
    }

    const now = Date.now();
    if (!clock.initialShown) {
      clock.initialShown = true;
      clock.visibleUntil = now + REMINDER_VISIBLE_MS;
      clock.nextReminderAt = REMINDER_INTERVAL_MS > 0 ? now + REMINDER_INTERVAL_MS : 0;
      clock.reminderIntervalMs = REMINDER_INTERVAL_MS;
      showReminder(REMINDER_VISIBLE_MS, { playSound: true });
    } else if (clock.visibleUntil > now) {
      // A reminder was still within its visible window when the view switched;
      // resume it for the remaining time only (no re-ring, no restart).
      showReminder(clock.visibleUntil - now, { playSound: false });
    }

    if (clock.initialShown && clock.reminderIntervalMs !== REMINDER_INTERVAL_MS) {
      clock.reminderIntervalMs = REMINDER_INTERVAL_MS;
      clock.nextReminderAt = REMINDER_INTERVAL_MS > 0 ? now + REMINDER_INTERVAL_MS : 0;
    }

    let timer: number | undefined;
    const scheduleNext = (): void => {
      if (REMINDER_INTERVAL_MS <= 0) return;
      const delay = Math.max(0, clock.nextReminderAt - Date.now());
      timer = window.setTimeout(() => {
        const firedAt = Date.now();
        clock.visibleUntil = firedAt + REMINDER_VISIBLE_MS;
        do {
          clock.nextReminderAt += REMINDER_INTERVAL_MS;
        } while (clock.nextReminderAt <= firedAt);
        showReminder(REMINDER_VISIBLE_MS, { playSound: false });
        scheduleNext();
      }, delay);
    };
    scheduleNext();

    return (): void => {
      if (timer !== undefined) {
        window.clearTimeout(timer);
      }
      clearHideTimer();
      clearFoldTimer();
    };
  }, [
    enabled,
    callId,
    clockRef,
    showReminder,
    clearHideTimer,
    clearFoldTimer,
    REMINDER_INTERVAL_MS,
    REMINDER_VISIBLE_MS,
  ]);

  useEffect(() => {
    if (!enabled) {
      previousRecordingActiveRef.current = isRecordingActive;
      return;
    }

    if (isRecordingActive && !previousRecordingActiveRef.current) {
      if (suppressNextRecordingActiveSoundRef.current) {
        suppressNextRecordingActiveSoundRef.current = false;
      } else {
        ringNow({ playSound: true });
      }
    }
    previousRecordingActiveRef.current = isRecordingActive;
  }, [enabled, isRecordingActive, ringNow]);

  useEffect(() => {
    if (!enabled) {
      previousTriggerKeyRef.current = triggerKey;
      return;
    }

    if (triggerKey !== previousTriggerKeyRef.current) {
      previousTriggerKeyRef.current = triggerKey;
      suppressNextRecordingActiveSoundRef.current = true;
      ringNow({ playSound: true });
    }
  }, [enabled, triggerKey, ringNow]);

  const reminderAction = reminderContent?.action;
  const ReminderIcon = reminderAction?.Icon;
  const hasReminder = Boolean(ReminderIcon);
  const isReminderActive = visible || foldingClosed;

  const reminder =
    isReminderActive && reminderContent && reminderAction && hasReminder ? (
      <div
        className={cn(
          'pointer-events-none absolute right-0 top-0 z-[3] flex h-10 items-center overflow-hidden rounded-full border text-white shadow-lg',
          'transition-[max-width,opacity,transform] ease-out',
          reminderAction.tone === 'recording'
            ? 'border-red-300/70 bg-[#2b2022]'
            : 'border-sky-300/70 bg-[#20272d]',
          visible
            ? 'max-w-[min(calc(100vw-2rem),340px)] opacity-100 translate-x-0'
            : 'max-w-10 opacity-100 translate-x-0',
        )}
        style={{ transitionDuration: `${REMINDER_FOLD_DURATION_MS}ms` }}
        role='status'
        aria-live='polite'
        aria-hidden={!isReminderActive}
      >
        <div className='flex min-w-0 items-center gap-2.5 py-2 pl-3 pr-12'>
          {ReminderIcon && (
            <ReminderIcon
              className={cn(
                'h-4 w-4 shrink-0 transition-transform ease-out',
                reminderAction.tone === 'recording' ? 'text-red-200' : 'text-pink-200',
              )}
              style={{ transitionDuration: `${REMINDER_FOLD_DURATION_MS}ms` }}
            />
          )}
          <div className='min-w-0 whitespace-nowrap'>
            <div className='truncate text-xs font-semibold leading-4 text-gray-100'>
              {reminderAction.title}
            </div>
            <div className='truncate text-[11px] leading-3 text-gray-300'>
              {reminderAction.description}
            </div>
          </div>
        </div>
      </div>
    ) : null;

  return { reminder, isReminderVisible: isReminderActive };
}
