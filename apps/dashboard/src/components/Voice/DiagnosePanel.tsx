import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { toast } from 'sonner';
import { cn } from '../../utils/classNames';
import { Button } from '../ui/Button';
import {
  formatVoiceDebug,
  useVoiceDebug,
  voiceDebug,
  type VoiceDebugEvent,
  type VoiceDebugLevel,
  type VoiceDebugStage,
  type VoiceDebugStatus,
} from '../../services/VoiceInput/voiceDebug';
import type { VoicePhase } from './voiceSession';

const STAGES: VoiceDebugStage[] = [
  'input',
  'mic',
  'socket',
  'stt',
  'route',
  'ask',
  'tts',
  'session',
];

const LEVEL_TEXT: Record<VoiceDebugLevel, string> = {
  info: 'text-muted-foreground',
  warn: 'text-yellow-700 dark:text-yellow-400',
  error: 'text-destructive',
};

type Tone = 'good' | 'bad' | 'neutral';

const TONE: Record<Tone, string> = {
  good: 'border-green-600/30 text-green-700 dark:text-green-400',
  bad: 'border-destructive/40 text-destructive',
  neutral: 'border-border text-muted-foreground',
};

function Chip({ label, value, tone }: { label: string; value: string; tone: Tone }): ReactElement {
  return (
    <span className={cn('rounded-full border px-2 py-0.5', TONE[tone])}>
      {label} <strong className='font-semibold'>{value}</strong>
    </span>
  );
}

function StatusStrip({
  phase,
  status,
}: {
  phase: VoicePhase;
  status: VoiceDebugStatus;
}): ReactElement {
  const toneOf = (good: boolean, bad: boolean): Tone => (bad ? 'bad' : good ? 'good' : 'neutral');
  return (
    <div className='flex flex-wrap gap-1'>
      <Chip label='phase' value={phase} tone='neutral' />
      <Chip
        label='permission'
        value={status.permission}
        tone={toneOf(status.permission === 'granted', status.permission === 'denied')}
      />
      <Chip
        label='mic'
        value={status.micLabel ? `${status.mic} · ${status.micLabel}` : status.mic}
        tone={toneOf(status.mic === 'live', status.mic === 'error')}
      />
      <Chip
        label='audio'
        value={status.audioContext}
        tone={toneOf(status.audioContext === 'running', false)}
      />
      <Chip
        label='socket'
        value={status.socket}
        tone={toneOf(status.socket === 'open', status.socket === 'error')}
      />
      <Chip
        label='sent'
        value={`${status.framesSent} frames · ${Math.round(status.bytesSent / 1024)} KB`}
        tone='neutral'
      />
      {status.lastServerMessage && (
        <Chip label='last msg' value={status.lastServerMessage} tone='neutral' />
      )}
    </div>
  );
}

function EventRow({ event }: { event: VoiceDebugEvent }): ReactElement {
  return (
    <li className={cn('break-words', LEVEL_TEXT[event.level])}>
      <span className='opacity-60'>
        +{event.sinceTurn}ms <span className='opacity-70'>(Δ{event.sincePrev})</span>
      </span>{' '}
      <span className='rounded bg-muted px-1 uppercase tracking-wide opacity-80'>
        {event.stage}
      </span>{' '}
      <strong className={cn('font-semibold', event.level === 'info' && 'text-foreground')}>
        {event.step}
      </strong>
      {event.detail && <> {event.detail}</>}
      {event.data !== undefined && (
        <details className='ml-4'>
          <summary className='cursor-pointer opacity-70'>data</summary>
          <pre className='overflow-x-auto whitespace-pre-wrap text-[10px]'>
            {JSON.stringify(event.data, null, 2)}
          </pre>
        </details>
      )}
    </li>
  );
}

/** The voice debugger: live pipeline status and every step of each turn, with timings. Local only. */
export function DiagnosePanel({ phase }: { phase: VoicePhase }): ReactElement {
  const debug = useVoiceDebug();
  const [stage, setStage] = useState<VoiceDebugStage | 'all'>('all');
  const [errorsOnly, setErrorsOnly] = useState(false);

  const shown = useMemo(
    () =>
      debug.events.filter(
        event =>
          (stage === 'all' || event.stage === stage) && (!errorsOnly || event.level !== 'info'),
      ),
    [debug.events, stage, errorsOnly],
  );
  const turns = useMemo(() => {
    const groups = new Map<number, VoiceDebugEvent[]>();
    for (const event of shown) groups.set(event.turn, [...(groups.get(event.turn) ?? []), event]);
    return [...groups.entries()];
  }, [shown]);

  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' });
  }, [shown.length]);

  const copy = (text: string, what: string): void => {
    navigator.clipboard.writeText(text).then(
      () => toast.success(`${what} copied`),
      () => toast.error('Could not copy to the clipboard'),
    );
  };

  return (
    <section
      aria-label='Voice debugger'
      className='flex min-h-0 flex-1 flex-col gap-2 rounded-lg border border-border bg-muted/20 p-3 text-xs'
    >
      <div className='flex items-center justify-between gap-2'>
        <span className='font-medium text-foreground'>Voice debugger · {debug.events.length}</span>
        <div className='flex gap-1'>
          <Button
            type='button'
            variant='outline'
            size='sm'
            disabled={debug.events.length === 0}
            onClick={() => copy(formatVoiceDebug(debug), 'Log')}
            data-track-category='XyneAI'
            data-track-name='VOICE_DEBUG_COPY'
          >
            Copy
          </Button>
          <Button
            type='button'
            variant='outline'
            size='sm'
            disabled={debug.events.length === 0}
            onClick={() => copy(JSON.stringify(debug, null, 2), 'JSON')}
            data-track-category='XyneAI'
            data-track-name='VOICE_DEBUG_COPY_JSON'
          >
            JSON
          </Button>
          <Button
            type='button'
            variant='ghost'
            size='sm'
            onClick={voiceDebug.clear}
            data-track-category='XyneAI'
            data-track-name='VOICE_DEBUG_CLEAR'
          >
            Clear
          </Button>
        </div>
      </div>

      <StatusStrip phase={phase} status={debug.status} />

      <div className='flex flex-wrap gap-1'>
        {(['all', ...STAGES] as const).map(option => (
          <button
            key={option}
            type='button'
            onClick={() => setStage(option)}
            data-track-category='XyneAI'
            data-track-name='VOICE_DEBUG_FILTER_STAGE'
            className={cn(
              'rounded px-1.5 py-0.5 uppercase tracking-wide',
              stage === option ? 'bg-accent text-foreground' : 'text-muted-foreground',
            )}
          >
            {option}
          </button>
        ))}
        <button
          type='button'
          onClick={() => setErrorsOnly(on => !on)}
          data-track-category='XyneAI'
          data-track-name='VOICE_DEBUG_PROBLEMS_ONLY'
          className={cn(
            'rounded px-1.5 py-0.5',
            errorsOnly ? 'bg-destructive/10 text-destructive' : 'text-muted-foreground',
          )}
        >
          problems only
        </button>
      </div>

      {turns.length === 0 ? (
        <p className='text-muted-foreground'>Nothing yet. Hold the orb or Space to talk.</p>
      ) : (
        <div className='min-h-0 flex-1 space-y-2 overflow-y-auto font-mono'>
          {turns.map(([turn, events]) => {
            const problems = events.filter(event => event.level !== 'info').length;
            return (
              <div key={turn}>
                <p className='font-sans font-medium text-foreground'>
                  {turn === 0 ? 'Before the first hold' : `Turn ${turn}`}
                  <span className='font-normal text-muted-foreground'>
                    {' '}
                    · {new Date(events[0]?.at ?? 0).toLocaleTimeString()} ·{' '}
                    {events.at(-1)?.sinceTurn ?? 0}ms
                  </span>
                  {problems > 0 && (
                    <span className='text-destructive'>
                      {' '}
                      · {problems} problem{problems > 1 ? 's' : ''}
                    </span>
                  )}
                </p>
                <ol className='space-y-0.5'>
                  {events.map(event => (
                    <EventRow key={event.id} event={event} />
                  ))}
                </ol>
              </div>
            );
          })}
          <div ref={endRef} />
        </div>
      )}
    </section>
  );
}
