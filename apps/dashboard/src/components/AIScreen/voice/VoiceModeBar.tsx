import { type ReactElement } from 'react';
import { Mic, Keyboard, Loader2, Sparkles } from 'lucide-react';
import { cn } from '../../../utils/classNames';
import type { VoicePhase } from './useVoiceMode';

interface VoiceModeBarProps {
  phase: VoicePhase;
  studioMode?: string | null;
  onHoldStart: () => void;
  onHoldEnd: () => void;
  onExit: () => void;
}

const PHASE_LABEL: Record<VoicePhase, string> = {
  idle: 'Hold to talk',
  listening: 'Release to send',
  transcribing: 'Transcribing…',
  thinking: 'Thinking…',
  speaking: 'Speaking · hold to interrupt',
};

function SpeakingBars(): ReactElement {
  return (
    <span className='flex items-end gap-1'>
      {[0, 1, 2, 3].map(i => (
        <span
          key={i}
          className='w-1 rounded-full bg-claw-ai-fg'
          style={{
            height: '1.25rem',
            animation: `voicePulse 900ms ease-in-out ${i * 120}ms infinite`,
          }}
        />
      ))}
    </span>
  );
}

export function VoiceModeBar({
  phase,
  studioMode,
  onHoldStart,
  onHoldEnd,
  onExit,
}: VoiceModeBarProps): ReactElement {
  const listening = phase === 'listening';
  const busy = phase === 'transcribing' || phase === 'thinking';
  const speaking = phase === 'speaking';

  return (
    <div className='flex w-full items-center justify-center gap-6 py-4'>
      <style>
        {'@keyframes voicePulse{0%,100%{transform:scaleY(0.4)}50%{transform:scaleY(1)}}' +
          '@keyframes voiceRipple{0%{transform:scale(1);opacity:0.85}100%{transform:scale(2.4);opacity:0}}' +
          '@media (prefers-reduced-motion: reduce){.voice-ripple{display:none}}'}
      </style>

      <button
        type='button'
        onClick={onExit}
        aria-label='Back to chat'
        title='Back to chat'
        className='inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-secondary hover:text-foreground'
        data-track-category='XyneAI'
        data-track-name='VOICE_MODE_EXIT'
      >
        <Keyboard className='h-5 w-5' aria-hidden />
      </button>

      <div className='flex min-w-[180px] flex-col items-center gap-2'>
        {studioMode && (
          <span className='inline-flex items-center gap-1 rounded-full bg-claw-ai-fg/10 px-2.5 py-1 text-xs font-semibold text-claw-ai-fg'>
            <Sparkles className='h-3 w-3' aria-hidden />
            {studioMode} mode
          </span>
        )}
        <div className='relative flex h-20 w-20 items-center justify-center'>
          {listening &&
            [0, 1, 2].map(i => (
              <span
                key={i}
                aria-hidden
                className='voice-ripple pointer-events-none absolute inset-0 m-auto h-16 w-16 rounded-full'
                style={{
                  backgroundColor: 'rgba(239,68,68,0.28)',
                  animation: `voiceRipple 2100ms cubic-bezier(0.2,0.6,0.3,1) ${i * 700}ms infinite`,
                }}
              />
            ))}
          <button
            type='button'
            disabled={busy}
            onPointerDown={e => {
              e.preventDefault();
              onHoldStart();
            }}
            onPointerUp={onHoldEnd}
            onPointerLeave={onHoldEnd}
            onPointerCancel={onHoldEnd}
            aria-label={speaking ? 'Hold to interrupt and reply' : 'Hold to talk'}
            aria-pressed={listening}
            className={cn(
              'relative z-10 inline-flex h-16 w-16 select-none items-center justify-center rounded-full transition-transform',
              listening
                ? 'scale-110 bg-red-500 text-white shadow-lg'
                : busy
                  ? 'bg-secondary text-muted-foreground'
                  : speaking
                    ? 'bg-secondary text-claw-ai-fg hover:bg-secondary/80 active:scale-95'
                    : 'bg-secondary text-foreground hover:bg-secondary/80 active:scale-95',
            )}
            data-track-category='XyneAI'
            data-track-name={speaking ? 'VOICE_MODE_BARGE_IN' : 'VOICE_MODE_PTT'}
          >
            {busy ? (
              <Loader2 className='h-7 w-7 animate-spin' aria-hidden />
            ) : speaking ? (
              <SpeakingBars />
            ) : (
              <Mic className='h-7 w-7' aria-hidden strokeWidth={2} />
            )}
          </button>
        </div>
        <span
          className={cn(
            'text-xs font-medium',
            listening ? 'text-red-500' : 'text-muted-foreground',
          )}
        >
          {PHASE_LABEL[phase]}
        </span>
      </div>

      <div className='h-10 w-10 shrink-0' aria-hidden />
    </div>
  );
}
