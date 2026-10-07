import { type ComponentProps, type ReactElement, type RefObject } from 'react';
import { Keyboard, Square, Volume2, VolumeX } from 'lucide-react';
import { cn } from '../../utils/classNames';
import { Button } from '../ui/Button';
import { Tooltip } from '../ui/Tooltip';
import { VoiceOrb } from './VoiceOrb';
import { updateVoiceSettings, useVoiceSettings } from './voiceSettings';
import { useSpaceToTalk } from './useSpaceToTalk';
import type { VoicePhase } from './voiceSession';

// The assistant is working out an answer: routing the request, waiting on Ask AI.
const isWorking = (phase: VoicePhase): boolean => phase === 'understanding' || phase === 'asking';

// Stop applies while the assistant is working out or speaking an answer.
export const canStop = (phase: VoicePhase): boolean => isWorking(phase) || phase === 'speaking';

/**
 * A round icon button with its name as tooltip; forwards props so a popover can use it as trigger.
 * With a `caption` the short name is also shown under the icon, so it needs no hovering to find out.
 */
export function IconButton({
  label,
  caption,
  className,
  children,
  ...props
}: ComponentProps<typeof Button> & { label: string; caption?: string }): ReactElement {
  return (
    <Tooltip content={label} side='top'>
      <Button
        type='button'
        variant='ghost'
        size={caption ? 'default' : 'icon'}
        aria-label={label}
        className={cn(
          'rounded-full text-muted-foreground hover:text-foreground',
          caption && 'h-auto min-w-14 flex-col gap-1 rounded-xl px-1 py-1.5 has-[>svg]:px-1',
          className,
        )}
        {...props}
      >
        {children}
        {caption && <span className='text-[11px] font-normal leading-none'>{caption}</span>}
      </Button>
    </Tooltip>
  );
}

interface VoiceOrbButtonProps {
  phase: VoicePhase;
  /** The stage: Space only talks while focus is inside it (or nowhere). */
  scope: RefObject<HTMLElement | null>;
  /** Smaller, to leave the room to the transcript. */
  compact?: boolean;
  onHoldStart: () => void;
  onHoldEnd: () => void;
}

/** The orb as a hold-to-talk control: press it, or hold Space, to talk and release to send. */
export function VoiceOrbButton({
  phase,
  scope,
  compact = false,
  onHoldStart,
  onHoldEnd,
}: VoiceOrbButtonProps): ReactElement {
  const busy = phase === 'transcribing' || isWorking(phase);
  const speaking = phase === 'speaking';

  useSpaceToTalk(scope, {
    onPress: () => {
      if (!busy) onHoldStart();
    },
    onRelease: onHoldEnd,
  });

  return (
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
      aria-pressed={phase === 'listening'}
      // Its height gives up the room and the scale shrinks the orb, so nothing jumps.
      className={cn(
        'flex h-40 w-40 shrink-0 select-none items-center justify-center rounded-full disabled:cursor-default',
        'transition-[height,transform] duration-300 ease-out motion-reduce:transition-none',
        compact && 'h-28 scale-75',
      )}
      data-track-category='XyneAI'
      data-track-name={speaking ? 'VOICE_MODE_BARGE_IN' : 'VOICE_MODE_PTT'}
    >
      <VoiceOrb phase={phase} className='voice-orb--stage h-32 w-32' />
    </button>
  );
}

export function BackButton({ onExit }: { onExit: () => void }): ReactElement {
  return (
    <IconButton
      label='Back to chat'
      caption='Type'
      onClick={onExit}
      data-track-category='XyneAI'
      data-track-name='VOICE_MODE_EXIT'
    >
      <Keyboard />
    </IconButton>
  );
}

export function StopButton({
  onStop,
  className,
}: {
  onStop: () => void;
  className?: string;
}): ReactElement {
  return (
    <IconButton
      label='Stop'
      caption='Stop'
      onClick={onStop}
      className={cn('text-destructive hover:text-destructive', className)}
      data-track-category='XyneAI'
      data-track-name='VOICE_MODE_STOP'
    >
      <Square className='fill-current' />
    </IconButton>
  );
}

export function MuteButton(): ReactElement {
  const { speakReplies } = useVoiceSettings();
  return (
    <IconButton
      label={speakReplies ? 'Mute replies' : 'Unmute replies'}
      caption={speakReplies ? 'Sound' : 'Muted'}
      onClick={() => updateVoiceSettings({ speakReplies: !speakReplies })}
      data-track-category='XyneAI'
      data-track-name='VOICE_MODE_MUTE'
    >
      {speakReplies ? <Volume2 /> : <VolumeX />}
    </IconButton>
  );
}

export function TapToHearButton({ onClick }: { onClick: () => void }): ReactElement {
  return (
    <Button
      type='button'
      variant='secondary'
      size='sm'
      onClick={onClick}
      data-track-category='XyneAI'
      data-track-name='VOICE_MODE_TAP_TO_HEAR'
    >
      Tap to hear
    </Button>
  );
}
