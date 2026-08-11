import { useEffect, useRef } from 'react';
import { useSelector } from '@xstate/react';
import { Bot, ChevronDown, Info } from 'lucide-react';
import { cn } from '../../../utils/classNames';
import { roomActor } from '../../../machines/roomMachine';
import type { MutableRefObject } from 'react';
import type { CallReminderClock } from './CallPrivacyReminder';
import type { CallPrivacyAction, CallPrivacyActionTone } from './callPrivacyActions';

interface CallPrivacyIndicatorProps {
  // Legacy props kept optional for call-site compatibility; the redesigned indicator
  // no longer uses the reminder/checklist/recording plumbing.
  title?: string | undefined;
  description?: string[] | undefined;
  actions?: CallPrivacyAction[] | undefined;
  callId?: string | undefined;
  activeTone?: CallPrivacyActionTone | undefined;
  reminderTriggerKey?: number | undefined;
  reminderEnabled?: boolean | undefined;
  reminderClockRef?: MutableRefObject<CallReminderClock> | undefined;
  isTranscriptionEnabled?: boolean | undefined;
  isHost?: boolean | undefined;
  onToggleTranscription?: (() => void) | undefined;
  /** Display name of the call host, shown to non-hosts in the "who can remove" note. */
  hostName?: string | null | undefined;
  trackMetadata?: Record<string, unknown> | undefined;
}

/** Robot glyph with a diagonal slash, used on the "Remove Xyne Automatic" action. */
export function SlashedBot({ className }: { className?: string }): React.ReactElement {
  return (
    <span className='relative inline-flex flex-shrink-0'>
      <Bot className={className} />
      <span className='pointer-events-none absolute inset-0 flex items-center justify-center'>
        <span className='h-[1.5px] w-[130%] rotate-45 rounded-full bg-current' />
      </span>
    </span>
  );
}

export function CallPrivacyIndicator({
  isTranscriptionEnabled = true,
  isHost = false,
  onToggleTranscription,
  hostName,
  trackMetadata,
}: CallPrivacyIndicatorProps): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const isOpen = useSelector(roomActor, state => state.context.privacyPopoverOpen);
  const isPaused = !isTranscriptionEnabled;

  const setOpen = (open: boolean): void => {
    roomActor.send({ type: 'SET_PRIVACY_POPOVER', open });
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent): void => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return (): void => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const statusDot = (
    <span
      className={cn(
        'h-2.5 w-2.5 flex-shrink-0 rounded-full',
        isPaused ? 'bg-muted-foreground' : 'bg-destructive animate-pulse',
      )}
    />
  );

  return (
    // Force the dark theme's tokens so these call surfaces stay dark even when the
    // app is in a light theme (the in-call UI is always dark).
    <div ref={containerRef} data-theme='midnight' className='relative visual-regression-hide'>
      {/* Banner pill */}
      <button
        type='button'
        onClick={() => setOpen(!isOpen)}
        aria-expanded={isOpen}
        aria-label='Transcription status'
        title={isPaused ? 'Transcription is off' : 'Xyne Automatic is transcribing'}
        data-track-category='CALLS'
        data-track-name='OPEN_CALL_PRIVACY_INDICATOR'
        data-track-metadata={JSON.stringify(trackMetadata ?? {})}
        className={cn(
          'flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-semibold shadow-lg transition-colors',
          isPaused
            ? 'border-border bg-card text-muted-foreground hover:bg-muted'
            : 'border-destructive/50 bg-card text-foreground hover:bg-muted',
        )}
      >
        {statusDot}
        <span>{isPaused ? 'Transcription off' : 'Transcribing'}</span>
        <ChevronDown
          className={cn(
            'h-4 w-4 text-muted-foreground transition-transform',
            isOpen && 'rotate-180',
          )}
        />
      </button>

      {isOpen && (
        <div
          role='dialog'
          aria-label='Transcription details'
          className='absolute right-0 top-[calc(100%+0.5rem)] z-[80] w-[min(92vw,360px)] rounded-xl border border-border bg-popover p-4 text-popover-foreground shadow-2xl'
        >
          {/* Header */}
          <div className='flex items-center gap-2.5'>
            {statusDot}
            <h2 className='text-base font-semibold text-foreground'>
              {isPaused ? 'Xyne Automatic has stopped' : 'Xyne Automatic is transcribing'}
            </h2>
          </div>

          {/* Description */}
          <p className='mt-2.5 text-sm leading-relaxed text-muted-foreground'>
            {isPaused
              ? 'Transcription is off — no audio is being captured. Nothing said now is transcribed, and no new summary or artifacts will be created until it is turned back on. Anything captured before this point is kept.'
              : 'Everyone in the call can see this. Audio is processed and kept temporarily to create the artifacts below.'}
          </p>

          <div className='mt-4 h-px bg-border' />

          {/* Host: one-click remove/add. Non-host: who can remove it. */}
          {isHost && onToggleTranscription ? (
            <button
              type='button'
              onClick={onToggleTranscription}
              aria-label={isPaused ? 'Add Xyne Automatic back' : 'Remove Xyne Automatic'}
              title={
                isPaused ? 'Resume transcription' : 'Remove Xyne Automatic (stops capturing audio)'
              }
              data-testid='transcription-toggle-button'
              data-track-category='CALLS'
              data-track-name='TRANSCRIPTION_TOGGLE'
              data-track-metadata={JSON.stringify({ enabled: isTranscriptionEnabled })}
              className={cn(
                'mt-4 flex w-full items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-semibold transition-colors',
                isPaused
                  ? 'border-action-primary text-action-primary hover:bg-accent'
                  : 'border-destructive/40 text-destructive hover:bg-destructive/10',
              )}
            >
              {isPaused ? <Bot className='h-4 w-4' /> : <SlashedBot className='h-4 w-4' />}
              {isPaused ? 'Add Xyne Automatic back' : 'Remove Xyne Automatic'}
            </button>
          ) : (
            <div className='mt-4 flex items-start gap-2.5 rounded-lg bg-muted px-3 py-2.5'>
              <Info className='mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground' />
              <p className='text-sm leading-relaxed text-muted-foreground'>
                Only <span className='font-semibold text-foreground'>{hostName ?? 'the host'}</span>{' '}
                (host) can control transcription. Ask them in chat if you need the setting changed.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
