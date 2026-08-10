import { useEffect, useRef, useState } from 'react';
import { Bot } from 'lucide-react';
import { cn } from '../../../utils/classNames';
import { useCallPrivacyReminder } from './CallPrivacyReminder';
import type { MutableRefObject } from 'react';
import type { CallReminderClock } from './CallPrivacyReminder';
import type { CallPrivacyAction, CallPrivacyActionTone } from './callPrivacyActions';

interface CallPrivacyIndicatorProps {
  title: string;
  description: string[];
  actions: CallPrivacyAction[];
  callId?: string | undefined;
  activeTone?: CallPrivacyActionTone | undefined;
  isTranscriptionEnabled?: boolean | undefined;
  isHost?: boolean | undefined;
  onToggleTranscription?: (() => void) | undefined;
  reminderTriggerKey?: number | undefined;
  reminderEnabled?: boolean | undefined;
  reminderClockRef?: MutableRefObject<CallReminderClock> | undefined;
  trackMetadata?: Record<string, unknown> | undefined;
}

/** Host-only switch that lives in the "Transcribing" row of the popover. */
function TranscriptionToggle({
  enabled,
  onToggle,
}: {
  enabled: boolean;
  onToggle: () => void;
}): React.ReactElement {
  return (
    <button
      type='button'
      role='switch'
      aria-checked={enabled}
      aria-label={enabled ? 'Turn off transcription' : 'Turn on transcription'}
      title={
        enabled ? 'Turn off transcription (stops capturing audio)' : 'Turn transcription back on'
      }
      onClick={onToggle}
      data-testid='transcription-toggle-switch'
      data-track-category='CALLS'
      data-track-name='TRANSCRIPTION_TOGGLE'
      data-track-metadata={JSON.stringify({ enabled })}
      className={cn(
        'relative h-5 w-9 flex-shrink-0 rounded-full transition-colors',
        enabled ? 'bg-sky-400/80' : 'bg-gray-600',
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform',
          enabled ? 'translate-x-4' : 'translate-x-0.5',
        )}
      />
    </button>
  );
}

function CallPrivacyActionRow({
  action,
  isTranscriptionEnabled = true,
  canToggleTranscription = false,
  onToggleTranscription,
}: {
  action: CallPrivacyAction;
  isTranscriptionEnabled?: boolean;
  canToggleTranscription?: boolean;
  onToggleTranscription?: (() => void) | undefined;
}): React.ReactElement {
  const Icon = action.Icon;
  const isRecording = action.tone === 'recording';
  const paused = action.id === 'transcribing' && !isTranscriptionEnabled;

  return (
    <div className='flex items-center justify-between gap-3 px-4 py-3'>
      <div className='flex min-w-0 items-center gap-3'>
        <Icon
          className={cn(
            'h-4.5 w-4.5 flex-shrink-0',
            isRecording ? 'text-red-200' : paused ? 'text-gray-400' : 'text-pink-200',
          )}
        />
        <div className='min-w-0'>
          <div className='text-sm font-semibold text-gray-100'>{action.title}</div>
          <div className='text-xs text-gray-300'>
            {paused ? 'Paused — audio not captured' : action.description}
          </div>
        </div>
      </div>

      {canToggleTranscription && onToggleTranscription ? (
        <TranscriptionToggle enabled={isTranscriptionEnabled} onToggle={onToggleTranscription} />
      ) : action.statusLabel ? (
        <span className='flex flex-shrink-0 items-center gap-1.5 rounded-full bg-red-500/15 px-2.5 py-1 text-[11px] font-semibold text-red-200'>
          <span className='h-2 w-2 rounded-full bg-red-400 animate-pulse' />
          {action.statusLabel}
        </span>
      ) : (
        <span
          className={cn(
            'h-3 w-3 flex-shrink-0 rounded-sm',
            isRecording ? 'bg-red-300' : paused ? 'bg-gray-500' : 'bg-pink-200',
          )}
        />
      )}
    </div>
  );
}

export function CallPrivacyIndicator({
  title,
  description,
  actions,
  callId,
  activeTone = 'ai',
  isTranscriptionEnabled = true,
  isHost = false,
  onToggleTranscription,
  reminderTriggerKey,
  reminderEnabled = true,
  reminderClockRef,
  trackMetadata,
}: CallPrivacyIndicatorProps): React.ReactElement {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const isRecordingTone = activeTone === 'recording';
  const isPaused = !isTranscriptionEnabled;
  const activeAction = actions.find(action => action.tone === activeTone) ?? actions[0];
  // Keep the robot face consistent; the slash overlay (below) conveys the paused state,
  // rather than swapping to a different icon.
  const ActiveIcon = activeAction?.Icon ?? Bot;
  const { reminder, isReminderVisible } = useCallPrivacyReminder({
    title,
    actions,
    isRecordingActive: isRecordingTone,
    callId,
    triggerKey: reminderTriggerKey,
    enabled: reminderEnabled,
    clockRef: reminderClockRef,
  });

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent): void => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return (): void => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div ref={containerRef} className='relative visual-regression-hide'>
      <button
        type='button'
        onClick={() => setIsOpen(prev => !prev)}
        className={cn(
          'relative z-[2] flex h-10 w-10 items-center justify-center rounded-full border-2 transition-colors shadow-lg',
          isPaused
            ? 'border-gray-500 bg-gray-500/10 text-gray-400 hover:bg-gray-500/20'
            : isRecordingTone
              ? 'border-red-300 bg-red-500/15 text-red-200 hover:bg-red-500/25'
              : 'border-sky-300 bg-sky-400/15 text-pink-200 hover:bg-sky-400/25',
        )}
        aria-label='Call transcription and recording status'
        aria-expanded={isOpen}
        title={
          isPaused
            ? 'Transcription paused — audio not being captured'
            : (activeAction?.title ?? title)
        }
        data-track-category='CALLS'
        data-track-name='OPEN_CALL_PRIVACY_INDICATOR'
        data-track-metadata={JSON.stringify(trackMetadata ?? {})}
      >
        <span
          className={cn(
            'absolute inset-[-5px] rounded-full border-4 transition-opacity duration-200',
            isRecordingTone ? 'border-red-400/30' : 'border-sky-400/60',
            (isReminderVisible || isPaused) && 'opacity-0',
          )}
        />
        <span className='relative flex items-center justify-center'>
          <ActiveIcon
            className={cn(
              'h-5 w-5 transition-opacity duration-200',
              isReminderVisible && 'opacity-0',
            )}
          />
          {isPaused && !isReminderVisible && (
            <span className='pointer-events-none absolute inset-0 flex items-center justify-center'>
              <span className='h-[2px] w-6 rotate-45 rounded-full bg-current shadow-[0_0_0_1px_rgba(0,0,0,0.55)]' />
            </span>
          )}
        </span>
      </button>

      {reminder}

      {isOpen && !isReminderVisible && (
        <div
          role='dialog'
          aria-label='Call transcription and recording details'
          className='absolute right-0 top-[calc(100%+0.75rem)] z-[80] w-[min(92vw,340px)] rounded-lg bg-[#25272a] p-4 text-white shadow-2xl border border-white/10'
        >
          <h2 className='text-lg font-semibold tracking-normal text-gray-100'>
            {isPaused ? `${title} (paused)` : title}
          </h2>

          <div className='mt-3 space-y-2 text-sm leading-5 text-gray-200'>
            {description.map(item => (
              <p key={item}>{item}</p>
            ))}
          </div>

          <div className='mt-4 overflow-hidden rounded-lg border border-white/5 bg-[#34363a]'>
            <div className='bg-[#3d4654] px-4 py-2 text-[10px] font-semibold uppercase tracking-widest text-gray-300/55'>
              Active AI actions
            </div>
            {actions.map((action, index) => (
              <div key={action.id}>
                {index > 0 && <div className='mx-5 h-px bg-white/10' />}
                <CallPrivacyActionRow
                  action={action}
                  isTranscriptionEnabled={isTranscriptionEnabled}
                  canToggleTranscription={
                    action.id === 'transcribing' && isHost && !!onToggleTranscription
                  }
                  onToggleTranscription={onToggleTranscription}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
