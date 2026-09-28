import {
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { Bug, Check, Circle, Loader2, MessageSquareText, Volume2, VolumeX, X } from 'lucide-react';
import { cn } from '../../../utils/classNames';
import type { VoiceLevelStore } from '../audio/levelStore';
import type { TraceEntry } from '../diagnostics';
import type { PlanStep } from '../planRunner';
import type { AssistantPhase, Chip, StageContent } from '../transcript';
import { Diagnostics } from './Diagnostics';
import { VoiceOrb } from './VoiceOrb';
import { useSpaceToTalk } from './useSpaceToTalk';

export interface VoiceStageProps {
  phase: AssistantPhase;
  content: StageContent;
  levelStore: VoiceLevelStore;
  speaksReplies: boolean;
  /** Hold to talk: press starts recording (and stops any spoken reply), release sends it. */
  onPress: () => void;
  onRelease: () => void;
  /** Stops speaking, or stops recording without sending. */
  onInterrupt: () => void;
  onChip: (chip: Chip) => void;
  onShowText: () => void;
  onSpeaksRepliesChange: (on: boolean) => void;
  onEnd: () => void;
  /** The Diagnose log; null hides the Diagnose control. TODO(before-merge): remove. */
  trace: TraceEntry[] | null;
}

const PHASE_LABEL: Record<AssistantPhase, string> = {
  idle: 'Ready',
  requesting: 'Starting microphone…',
  listening: 'Listening',
  transcribing: 'Catching that…',
  thinking: 'Working on it…',
  speaking: 'Speaking',
};

const PHASE_HINT: Record<AssistantPhase, string> = {
  idle: 'Hold the orb or Space to talk · release to send',
  requesting: '',
  listening: 'Release when you’re done · Esc to cancel',
  transcribing: '',
  thinking: '',
  speaking: 'Hold the orb or Space to answer · Esc to stop',
};

function Control({
  label,
  onClick,
  children,
  tone = 'default',
  pressed,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  tone?: 'default' | 'danger';
  pressed?: boolean;
}): ReactElement {
  return (
    <button
      type='button'
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      data-track-category='VoiceMode'
      data-track-name={label}
      className={cn(
        'flex h-9 w-9 items-center justify-center rounded-full border transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        tone === 'danger'
          ? 'border-transparent bg-destructive/10 text-destructive hover:bg-destructive/15'
          : 'border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground',
        pressed && 'bg-accent text-foreground',
      )}
    >
      {children}
    </button>
  );
}

/** Same look as Ask AI follow-up suggestions, so choices read as part of the panel. */
function ChipButton({ chip, onClick }: { chip: Chip; onClick: () => void }): ReactElement {
  return (
    <button
      type='button'
      onClick={onClick}
      title={chip.label}
      data-track-category='VoiceMode'
      data-track-name='ChooseOption'
      className='flex max-w-full flex-col rounded-2xl border border-border bg-card px-3 py-1.5 text-left text-xs font-medium leading-5 text-muted-foreground transition-colors hover:bg-accent motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1'
    >
      <span className='line-clamp-1 text-foreground'>{chip.label}</span>
    </button>
  );
}

const STEP_ICON: Record<PlanStep['status'], ReactElement> = {
  waiting: <Circle className='h-3.5 w-3.5' aria-hidden />,
  running: <Loader2 className='h-3.5 w-3.5 motion-safe:animate-spin' aria-hidden />,
  done: <Check className='h-3.5 w-3.5' aria-hidden />,
  failed: <X className='h-3.5 w-3.5' aria-hidden />,
};

const STEP_TONE: Record<PlanStep['status'], string> = {
  waiting: 'text-muted-foreground',
  running: 'text-foreground',
  done: 'text-foreground',
  failed: 'text-destructive',
};

/** What the assistant is doing right now, one line per step, ticked off as each finishes. */
function StepList({ steps }: { steps: PlanStep[] }): ReactElement {
  return (
    <ol aria-label='Progress' className='mx-auto flex flex-col gap-1 text-[13px] leading-snug'>
      {steps.map((step, index) => (
        <li key={index} className={cn('flex items-center gap-2', STEP_TONE[step.status])}>
          {STEP_ICON[step.status]}
          <span>{step.label}</span>
        </li>
      ))}
    </ol>
  );
}

/**
 * Voice mode for the Ask AI panel, like a voice call: an orb instead of a transcript. Hold the
 * orb to talk. Replies are spoken, not printed; only choices (and text you can't do without)
 * appear. The transcript is one tap away and keeps every turn.
 */
export function VoiceStage({
  phase,
  content,
  levelStore,
  speaksReplies,
  onPress,
  onRelease,
  onInterrupt,
  onChip,
  onShowText,
  onSpeaksRepliesChange,
  onEnd,
  trace,
}: VoiceStageProps): ReactElement {
  const [diagnosing, setDiagnosing] = useState(false);
  // Esc is always a way out: it stops speaking, or drops a recording without sending it.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      onInterrupt();
    };
    window.addEventListener('keydown', onKeyDown);
    return (): void => window.removeEventListener('keydown', onKeyDown);
  }, [onInterrupt]);
  useSpaceToTalk({ onPress, onRelease });

  // Focus the orb, so Space talks at once instead of typing into the Ask AI box.
  const orbRef = useRef<HTMLButtonElement>(null);
  useEffect(() => orbRef.current?.focus({ preventScroll: true }), []);

  const busy = phase === 'thinking' || phase === 'transcribing' || phase === 'requesting';
  const holding = phase === 'requesting' || phase === 'listening';

  const pressOrb = (event: PointerEvent<HTMLButtonElement>): void => {
    if (event.button !== 0) return;
    // Keeps the release on the orb even if the pointer drifts off it while talking.
    event.currentTarget.setPointerCapture(event.pointerId);
    onPress();
  };
  return (
    <section
      aria-label='Voice mode'
      className='flex h-full min-h-0 flex-col items-center px-4 pb-3 pt-6'
      data-testid='voice-stage'
    >
      <div className='flex min-h-0 flex-1 flex-col items-center justify-center gap-5'>
        <button
          ref={orbRef}
          type='button'
          onPointerDown={pressOrb}
          onPointerUp={onRelease}
          onPointerCancel={onRelease}
          onContextMenu={event => event.preventDefault()}
          aria-label={holding ? 'Release to send' : 'Hold to talk'}
          aria-pressed={holding}
          title='Hold to talk'
          data-voice-orb
          data-track-category='VoiceMode'
          data-track-name='Orb'
          // No focus ring: the orb is held, not clicked, and its own glow shows the state.
          className='touch-none select-none rounded-full outline-none'
        >
          <VoiceOrb
            phase={phase}
            active
            stage
            levelStore={levelStore}
            className='h-32 w-32 sm:h-36 sm:w-36'
          />
        </button>
        <div
          className='flex flex-col items-center gap-1 text-center'
          role='status'
          aria-live='polite'
        >
          <p
            className={cn(
              'text-sm font-medium text-foreground',
              busy && 'motion-safe:animate-pulse',
            )}
          >
            {PHASE_LABEL[phase]}
          </p>
          {PHASE_HINT[phase] && (
            <p className='text-xs text-muted-foreground'>{PHASE_HINT[phase]}</p>
          )}
        </div>
      </div>

      {(content.caption || content.chips.length > 0 || content.steps.length > 0) && (
        <div className='flex max-h-[45%] w-full min-h-0 flex-col gap-2 overflow-y-auto py-2'>
          {content.steps.length > 0 && <StepList steps={content.steps} />}
          {content.caption && (
            <p
              className={cn(
                'line-clamp-4 whitespace-pre-wrap text-center text-[13px] leading-snug',
                content.caption.tone === 'error' ? 'text-destructive' : 'text-foreground',
              )}
            >
              {content.caption.text}
            </p>
          )}
          {content.prompt && content.chips.length > 0 && (
            <p className='text-center text-xs text-muted-foreground'>
              {content.prompt}
              <span className='opacity-70'> · tap or say it</span>
            </p>
          )}
          {content.chips.length > 0 && (
            <div className='flex flex-wrap justify-center gap-2'>
              {content.chips.map(chip => (
                <ChipButton key={chip.id} chip={chip} onClick={() => onChip(chip)} />
              ))}
            </div>
          )}
        </div>
      )}

      <div className='flex items-center justify-center gap-2 pt-2'>
        <Control
          label={speaksReplies ? 'Mute spoken replies' : 'Speak replies'}
          onClick={() => onSpeaksRepliesChange(!speaksReplies)}
          pressed={!speaksReplies}
        >
          {speaksReplies ? (
            <Volume2 className='h-4 w-4' aria-hidden />
          ) : (
            <VolumeX className='h-4 w-4' aria-hidden />
          )}
        </Control>
        <Control label='Show text' onClick={onShowText}>
          <MessageSquareText className='h-4 w-4' aria-hidden />
        </Control>
        {trace && (
          <Control
            label={diagnosing ? 'Hide diagnostics' : 'Diagnose'}
            onClick={() => setDiagnosing(on => !on)}
            pressed={diagnosing}
          >
            <Bug className='h-4 w-4' aria-hidden />
          </Control>
        )}
        <Control label='End voice mode' onClick={onEnd} tone='danger'>
          <X className='h-4 w-4' aria-hidden />
        </Control>
      </div>

      {trace && diagnosing && (
        <div className='mt-3 w-full'>
          <Diagnostics trace={trace} />
        </div>
      )}
    </section>
  );
}

export interface VoiceSessionBarProps {
  phase: AssistantPhase;
  levelStore: VoiceLevelStore;
  onShowVoice: () => void;
  onEnd: () => void;
}

/** The voice session while its transcript is showing, with the way back to the orb. */
export function VoiceSessionBar({
  phase,
  levelStore,
  onShowVoice,
  onEnd,
}: VoiceSessionBarProps): ReactElement {
  const barButton =
    'rounded-md px-2 py-1 font-medium text-foreground transition-colors hover:bg-accent';
  return (
    <div className='flex shrink-0 items-center gap-2 border-b border-border bg-background px-3 py-1.5 text-xs'>
      <button
        type='button'
        onClick={onShowVoice}
        aria-label='Back to voice view'
        title='Back to voice view'
        data-track-category='VoiceMode'
        data-track-name='ShowVoice'
        className='flex min-w-0 flex-1 items-center gap-2 text-left'
      >
        <VoiceOrb phase={phase} active levelStore={levelStore} className='h-5 w-5' />
        <span className='truncate text-muted-foreground'>
          Voice mode · <span className='text-foreground'>{PHASE_LABEL[phase]}</span>
        </span>
      </button>
      <button
        type='button'
        onClick={onShowVoice}
        data-track-category='VoiceMode'
        data-track-name='ShowVoice'
        className={barButton}
      >
        Voice view
      </button>
      <button
        type='button'
        onClick={onEnd}
        data-track-category='VoiceMode'
        data-track-name='End'
        className='rounded-md px-2 py-1 font-medium text-destructive transition-colors hover:bg-destructive/10'
      >
        End
      </button>
    </div>
  );
}
