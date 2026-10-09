import { useRef, type ComponentProps, type ReactElement, type RefObject } from 'react';
import { Keyboard, Square, Volume2, VolumeX } from 'lucide-react';
import { cn } from '../../utils/classNames';
import { Button } from '../ui/Button';
import { Tooltip } from '../ui/Tooltip';
import { VoiceOrb } from './VoiceOrb';
import { updateVoiceSettings, useVoiceSettings } from './voiceSettings';
import { useSpaceToTalk } from './useSpaceToTalk';
import { voiceDebug } from '../../services/VoiceInput/voiceDebug';
import type { VoicePhase } from './voiceSession';

const isWorking = (phase: VoicePhase): boolean => phase === 'understanding' || phase === 'asking';

export const canStop = (phase: VoicePhase): boolean => isWorking(phase) || phase === 'speaking';

/** Forwards props so a popover can use it as its trigger. */
export function IconButton({
  label,
  className,
  ...props
}: Omit<ComponentProps<'button'>, 'aria-label'> & { label: string }): ReactElement {
  return (
    <Tooltip content={label} side='top'>
      <Button
        type='button'
        variant='ghost'
        size='icon'
        aria-label={label}
        className={cn('rounded-full text-muted-foreground hover:text-foreground', className)}
        {...props}
      />
    </Tooltip>
  );
}

interface VoiceOrbButtonProps {
  phase: VoicePhase;
  scope: RefObject<HTMLElement | null>;
  onHoldStart: () => void;
  onHoldEnd: () => void;
}

export function VoiceOrbButton({
  phase,
  scope,
  onHoldStart,
  onHoldEnd,
}: VoiceOrbButtonProps): ReactElement {
  const busy = phase === 'transcribing' || isWorking(phase);
  const speaking = phase === 'speaking';

  // Pointer up and the capture being lost both end a hold, so only the first one counts.
  const holding = useRef(false);

  const press = (source: string): boolean => {
    if (busy) {
      voiceDebug.log('input', 'Press ignored', `${source} while ${phase}`, { level: 'warn' });
      return false;
    }
    voiceDebug.log('input', 'Pressed', source);
    onHoldStart();
    return true;
  };
  const release = (): void => {
    if (!holding.current) return;
    holding.current = false;
    onHoldEnd();
  };

  useSpaceToTalk(scope, {
    onPress: () => press('Space'),
    onRelease: onHoldEnd,
  });

  return (
    <button
      type='button'
      aria-disabled={busy}
      onPointerDown={e => {
        if (e.button !== 0) return;
        e.preventDefault();
        // Captured, the hold survives the pointer drifting off the orb and always gets its release.
        e.currentTarget.setPointerCapture(e.pointerId);
        holding.current = press(`orb (${e.pointerType})`);
      }}
      onPointerUp={release}
      onPointerCancel={() => {
        if (holding.current) {
          voiceDebug.log('input', 'Pointer cancelled', 'the browser took the pointer', {
            level: 'warn',
          });
        }
        release();
      }}
      onLostPointerCapture={release}
      aria-label={speaking ? 'Hold to interrupt and reply' : 'Hold to talk'}
      aria-pressed={phase === 'listening'}
      className='flex h-40 w-40 shrink-0 touch-none select-none items-center justify-center rounded-full aria-disabled:cursor-default'
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
