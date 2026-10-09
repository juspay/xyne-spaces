import { useEffect, useRef } from 'react';
import { useSelector } from '@xstate/react';
import { Bot, Captions, ChevronDown, CircleDot, Info } from 'lucide-react';
import { RecordingType } from '@xyne/shared';
import { cn } from '../../../utils/classNames';
import { roomActor } from '../../../machines/roomMachine';

interface CallPrivacyIndicatorProps {
  isTranscriptionEnabled?: boolean | undefined;
  isHost?: boolean | undefined;
  onToggleTranscription?: (() => void) | undefined;
  /** Display name of the call host, shown to non-hosts in the "who can remove" note. */
  hostName?: string | null | undefined;
  /** Lists the active recording alongside the transcript. */
  isRecordingActive?: boolean | undefined;
  /** A `RecordingType` value; room metadata delivers it as a plain string. */
  recordingType?: string | null | undefined;
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

function ActivityRow({
  icon: iconComponent,
  title,
  description,
  isOn,
}: {
  icon: React.ElementType<{ className?: string }>;
  title: string;
  description: string;
  isOn: boolean;
}): React.ReactElement {
  const Icon = iconComponent;
  return (
    <div className='flex items-center gap-3 px-3 py-2.5'>
      <span
        className={cn(
          'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full',
          isOn ? 'bg-[#dc362e]/15 text-[#f2b8b5]' : 'bg-white/5 text-[#9aa0a6]',
        )}
      >
        <Icon className='h-4 w-4' />
      </span>
      <div className='min-w-0 flex-1'>
        <p className='text-sm font-medium text-[#e3e3e3]'>{title}</p>
        <p className='truncate text-xs text-[#9aa0a6]'>{description}</p>
      </div>
      <span
        className={cn(
          'flex flex-shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold',
          isOn ? 'bg-[#dc362e]/15 text-[#f2b8b5]' : 'bg-white/5 text-[#9aa0a6]',
        )}
      >
        {isOn && <span className='h-1.5 w-1.5 animate-pulse rounded-full bg-[#f28b82]' />}
        {isOn ? 'On' : 'Off'}
      </span>
    </div>
  );
}

/**
 * Top-bar chip telling everyone the call is being transcribed, with a popover
 * that explains what is captured and — for the host — a stop/resume switch.
 */
export function CallPrivacyIndicator({
  isTranscriptionEnabled = true,
  isHost = false,
  onToggleTranscription,
  hostName,
  isRecordingActive = false,
  recordingType,
  trackMetadata,
}: CallPrivacyIndicatorProps): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const isOpen = useSelector(roomActor, state => state.context.privacyPopoverOpen);
  // A toggle is in-flight, awaiting the agent's authoritative confirmation.
  const isPending = useSelector(roomActor, state => state.context.transcriptionPending);
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

  const recordingDescription =
    recordingType === RecordingType.AUDIO_SCREEN
      ? 'Screen share, audio and transcript'
      : recordingType === RecordingType.AUDIO_ONLY
        ? 'Participant audio and transcript'
        : 'This call is being recorded';

  return (
    // Force the dark theme's tokens so these call surfaces stay dark even when the
    // app is in a light theme (the in-call UI is always dark).
    <div ref={containerRef} data-theme='midnight' className='relative visual-regression-hide'>
      {/* Status chip — same height and surface as the other top-bar pills */}
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
          'flex h-10 items-center gap-2 rounded-full pl-3.5 pr-2.5 text-sm font-medium transition-colors',
          'outline-none focus-visible:ring-2 focus-visible:ring-[#a8c7fa] focus-visible:ring-offset-2 focus-visible:ring-offset-[#131314]',
          isOpen ? 'bg-[#a8c7fa] text-[#062e6f]' : 'bg-[#333537] text-[#e3e3e3] hover:bg-[#404245]',
        )}
      >
        <span className='relative flex h-2.5 w-2.5 flex-shrink-0'>
          {!isPaused && (
            <span className='absolute inset-0 animate-ping rounded-full bg-[#f28b82] opacity-60' />
          )}
          <span
            className={cn(
              'relative h-2.5 w-2.5 rounded-full',
              isPaused ? 'bg-[#9aa0a6]' : 'bg-[#ea4335]',
            )}
          />
        </span>
        <span className='hidden sm:inline'>{isPaused ? 'Transcription off' : 'Transcribing'}</span>
        <ChevronDown
          className={cn('h-4 w-4 opacity-70 transition-transform', isOpen && 'rotate-180')}
        />
      </button>

      {isOpen && (
        <div
          role='dialog'
          aria-label='Transcription details'
          className='absolute left-0 top-[calc(100%+0.5rem)] z-[80] w-[min(92vw,360px)] overflow-hidden rounded-2xl bg-[#1e1f20] text-[#e3e3e3] shadow-[0_12px_40px_rgba(0,0,0,0.55)] ring-1 ring-white/10 animate-in fade-in slide-in-from-top-1 duration-150'
        >
          {/* Header */}
          <div className='flex items-center gap-3 px-4 pb-3 pt-4'>
            <div className='relative flex-shrink-0'>
              <img
                src='/images/xyne_logo.png'
                alt=''
                className='h-10 w-10 rounded-full object-cover ring-1 ring-white/10'
              />
              <span
                className={cn(
                  'absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[#1e1f20]',
                  isPaused ? 'bg-[#9aa0a6]' : 'bg-[#ea4335]',
                )}
              />
            </div>
            <div className='min-w-0'>
              <h2 className='text-base font-medium leading-tight'>
                {isPaused ? 'Transcription is off' : 'Xyne Automatic is transcribing'}
              </h2>
              <p className='mt-0.5 text-xs text-[#9aa0a6]'>Visible to everyone in this call</p>
            </div>
          </div>

          <p className='px-4 text-sm leading-relaxed text-[#c4c7c5]'>
            {isPaused
              ? 'No audio is being captured, and no new transcript or summary is created until it is turned back on. Anything captured earlier is kept.'
              : 'Audio is processed and kept temporarily to create the items below.'}
          </p>

          {/* What's being captured right now */}
          <div className='mx-4 mt-3 divide-y divide-white/5 overflow-hidden rounded-xl bg-white/[0.04]'>
            <ActivityRow
              icon={Captions}
              title='Live transcript'
              description='Speech turned into text'
              isOn={!isPaused}
            />
            {isRecordingActive && (
              <ActivityRow
                icon={CircleDot}
                title='Recording'
                description={recordingDescription}
                isOn
              />
            )}
          </div>

          {/* Host: one-click stop/resume (awaits the agent). Non-host: who can stop it. */}
          <div className='p-4'>
            {isHost && onToggleTranscription ? (
              <button
                type='button'
                onClick={onToggleTranscription}
                disabled={isPending}
                aria-label={isPaused ? 'Add Xyne Automatic back' : 'Remove Xyne Automatic'}
                title={
                  isPaused
                    ? 'Resume transcription'
                    : 'Remove Xyne Automatic (stops capturing audio)'
                }
                data-testid='transcription-toggle-button'
                data-track-category='CALLS'
                data-track-name='TRANSCRIPTION_TOGGLE'
                data-track-metadata={JSON.stringify({ enabled: isTranscriptionEnabled })}
                className={cn(
                  'flex h-10 w-full items-center justify-center gap-2 rounded-full text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                  isPaused
                    ? 'bg-[#a8c7fa] text-[#062e6f] hover:bg-[#bcd4fb]'
                    : 'bg-[#dc362e]/15 text-[#f2b8b5] hover:bg-[#dc362e]/25',
                )}
              >
                {isPaused ? <Bot className='h-4 w-4' /> : <SlashedBot className='h-4 w-4' />}
                {isPending
                  ? isPaused
                    ? 'Starting…'
                    : 'Stopping…'
                  : isPaused
                    ? 'Resume transcribing'
                    : 'Stop transcribing'}
              </button>
            ) : (
              <p className='flex items-start gap-2 text-xs leading-relaxed text-[#9aa0a6]'>
                <Info className='mt-0.5 h-3.5 w-3.5 flex-shrink-0' />
                <span>
                  Only <span className='font-medium text-[#e3e3e3]'>{hostName ?? 'the host'}</span>{' '}
                  (host) can control transcription.
                </span>
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
