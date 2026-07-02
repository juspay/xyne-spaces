import { useCallback, useEffect, useRef, useState } from 'react';
import type { CallPrivacyAction } from './callPrivacyActions';
import { playAudio } from '../../../utils/audioPlayer';
import { cn } from '../../../utils/classNames';

const REMINDER_INTERVAL_MS = 120_000;
const REMINDER_VISIBLE_MS = 6_000;
const REMINDER_SOUND_PATH = '/sounds/notification.wav';
const SOUND_DEDUPE_MS = 5_000;

interface CallPrivacyReminderProps {
  title: string;
  actions: CallPrivacyAction[];
  isRecordingActive: boolean;
  triggerKey?: number | undefined;
  enabled?: boolean | undefined;
}

interface ReminderContent {
  title: string;
  action: CallPrivacyAction;
}

export function useCallPrivacyReminder({
  title,
  actions,
  isRecordingActive,
  triggerKey,
  enabled = true,
}: CallPrivacyReminderProps): {
  reminder: React.ReactElement | null;
  isReminderVisible: boolean;
} {
  const [visible, setVisible] = useState(false);
  const [reminderContent, setReminderContent] = useState<ReminderContent | null>(null);
  const hideTimerRef = useRef<number | null>(null);
  const previousRecordingActiveRef = useRef(isRecordingActive);
  const previousTriggerKeyRef = useRef(triggerKey);
  const latestReminderRef = useRef<ReminderContent | null>(null);
  const lastSoundAtRef = useRef(0);
  const suppressNextRecordingActiveSoundRef = useRef(false);
  const activeAction =
    actions.find(action => action.tone === (isRecordingActive ? 'recording' : 'ai')) ?? actions[0];

  latestReminderRef.current = activeAction ? { title, action: activeAction } : null;

  const showReminder = useCallback((opts?: { playSound?: boolean }): void => {
    const nextReminder = latestReminderRef.current;
    if (!nextReminder) return;

    if (hideTimerRef.current) {
      window.clearTimeout(hideTimerRef.current);
    }

    setReminderContent(nextReminder);
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
      hideTimerRef.current = null;
    }, REMINDER_VISIBLE_MS);
  }, []);

  useEffect(() => {
    if (!enabled) {
      setVisible(false);
      previousRecordingActiveRef.current = isRecordingActive;
      previousTriggerKeyRef.current = triggerKey;
      if (hideTimerRef.current) {
        window.clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
    }
  }, [enabled, isRecordingActive, triggerKey]);

  useEffect(() => {
    if (!enabled) return;

    showReminder({ playSound: true });
    const interval = window.setInterval(() => {
      showReminder({ playSound: false });
    }, REMINDER_INTERVAL_MS);

    return (): void => {
      window.clearInterval(interval);
      if (hideTimerRef.current) {
        window.clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
    };
  }, [enabled, showReminder]);

  useEffect(() => {
    if (!enabled) {
      previousRecordingActiveRef.current = isRecordingActive;
      return;
    }

    if (isRecordingActive && !previousRecordingActiveRef.current) {
      if (suppressNextRecordingActiveSoundRef.current) {
        suppressNextRecordingActiveSoundRef.current = false;
        previousRecordingActiveRef.current = isRecordingActive;
        return;
      }
      showReminder({ playSound: true });
    }
    previousRecordingActiveRef.current = isRecordingActive;
  }, [enabled, isRecordingActive, showReminder]);

  useEffect(() => {
    if (!enabled) {
      previousTriggerKeyRef.current = triggerKey;
      return;
    }

    if (triggerKey !== previousTriggerKeyRef.current) {
      previousTriggerKeyRef.current = triggerKey;
      suppressNextRecordingActiveSoundRef.current = true;
      showReminder({ playSound: true });
    }
  }, [enabled, triggerKey, showReminder]);

  const reminderAction = reminderContent?.action;
  const ActiveIcon = reminderAction?.Icon;

  const reminder =
    visible && reminderContent && reminderAction && ActiveIcon ? (
      <div
        className={cn(
          'absolute right-0 top-[calc(100%+0.75rem)] z-[75] w-[min(92vw,320px)] overflow-hidden rounded-lg border border-white/10 bg-[#25272a] text-white shadow-2xl',
          'animate-in slide-in-from-top-2 fade-in duration-300',
        )}
        role='status'
        aria-live='polite'
      >
        <div className='flex items-stretch'>
          <div className='flex w-2 shrink-0 items-center justify-center bg-sky-400/20'>
            <div className='flex h-12 items-end gap-[2px]'>
              {[0, 1, 2].map(index => (
                <span
                  key={index}
                  className='block w-[2px] rounded-full bg-sky-300 animate-pulse'
                  style={{
                    height: `${10 + index * 5}px`,
                    animationDelay: `${index * 140}ms`,
                    animationDuration: '900ms',
                  }}
                />
              ))}
            </div>
          </div>
          <div className='flex min-w-0 flex-1 items-center gap-3 px-4 py-3'>
            <ActiveIcon
              className={cn(
                'h-5 w-5 shrink-0',
                reminderAction.tone === 'recording' ? 'text-red-200' : 'text-pink-200',
              )}
            />
            <div className='min-w-0'>
              <div className='text-sm font-semibold text-gray-100'>{reminderContent.title}</div>
              <div className='truncate text-xs text-gray-300'>
                {reminderAction.title} · {reminderAction.description}
              </div>
            </div>
          </div>
        </div>
      </div>
    ) : null;

  return { reminder, isReminderVisible: visible };
}
