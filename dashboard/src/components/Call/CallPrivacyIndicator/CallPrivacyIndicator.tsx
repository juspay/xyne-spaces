import { useEffect, useRef, useState } from 'react';
import { Bot } from 'lucide-react';
import { cn } from '../../../utils/classNames';
import { useCallPrivacyReminder } from './CallPrivacyReminder';
import type { CallPrivacyAction, CallPrivacyActionTone } from './callPrivacyActions';

interface CallPrivacyIndicatorProps {
  title: string;
  description: string[];
  actions: CallPrivacyAction[];
  activeTone?: CallPrivacyActionTone | undefined;
  reminderTriggerKey?: number | undefined;
  reminderEnabled?: boolean | undefined;
  trackMetadata?: Record<string, unknown> | undefined;
}

function CallPrivacyActionRow({ action }: { action: CallPrivacyAction }): React.ReactElement {
  const Icon = action.Icon;
  const isRecording = action.tone === 'recording';

  return (
    <div className='flex items-center justify-between gap-3 px-4 py-3'>
      <div className='flex min-w-0 items-center gap-3'>
        <Icon
          className={cn(
            'h-4.5 w-4.5 flex-shrink-0',
            isRecording ? 'text-red-200' : 'text-pink-200',
          )}
        />
        <div className='min-w-0'>
          <div className='text-sm font-semibold text-gray-100'>{action.title}</div>
          <div className='text-xs text-gray-300'>{action.description}</div>
        </div>
      </div>

      {action.statusLabel ? (
        <span className='flex flex-shrink-0 items-center gap-1.5 rounded-full bg-red-500/15 px-2.5 py-1 text-[11px] font-semibold text-red-200'>
          <span className='h-2 w-2 rounded-full bg-red-400 animate-pulse' />
          {action.statusLabel}
        </span>
      ) : (
        <span
          className={cn(
            'h-3 w-3 flex-shrink-0 rounded-sm',
            isRecording ? 'bg-red-300' : 'bg-pink-200',
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
  activeTone = 'ai',
  reminderTriggerKey,
  reminderEnabled = true,
  trackMetadata,
}: CallPrivacyIndicatorProps): React.ReactElement {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const isRecordingTone = activeTone === 'recording';
  const activeAction = actions.find(action => action.tone === activeTone) ?? actions[0];
  const ActiveIcon = activeAction?.Icon ?? Bot;
  const { reminder, isReminderVisible } = useCallPrivacyReminder({
    title,
    actions,
    isRecordingActive: isRecordingTone,
    triggerKey: reminderTriggerKey,
    enabled: reminderEnabled,
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
          'relative flex h-10 w-10 items-center justify-center rounded-full border-2 transition-colors shadow-lg',
          isRecordingTone
            ? 'border-red-300 bg-red-500/15 text-red-200 hover:bg-red-500/25'
            : 'border-sky-300 bg-sky-400/15 text-pink-200 hover:bg-sky-400/25',
        )}
        aria-label='Call transcription and recording status'
        aria-expanded={isOpen}
        title={activeAction?.title ?? title}
        data-track-category='CALLS'
        data-track-name='OPEN_CALL_PRIVACY_INDICATOR'
        data-track-metadata={JSON.stringify(trackMetadata ?? {})}
      >
        <span
          className={cn(
            'absolute inset-[-5px] rounded-full border-4',
            isRecordingTone ? 'border-red-400/30' : 'border-sky-400/60',
          )}
        />
        <ActiveIcon className='h-5 w-5' />
      </button>

      {reminder}

      {isOpen && !isReminderVisible && (
        <div
          role='dialog'
          aria-label='Call transcription and recording details'
          className='absolute right-0 top-[calc(100%+0.75rem)] z-[80] w-[min(92vw,340px)] rounded-lg bg-[#25272a] p-4 text-white shadow-2xl border border-white/10'
        >
          <h2 className='text-lg font-semibold tracking-normal text-gray-100'>{title}</h2>

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
                <CallPrivacyActionRow action={action} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
