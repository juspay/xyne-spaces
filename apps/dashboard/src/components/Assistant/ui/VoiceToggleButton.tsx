import type { ReactElement } from 'react';
import { cn } from '../../../utils/classNames';
import type { Assistant } from '../useAssistant';
import { VoiceOrb } from './VoiceOrb';

/** What a composer needs to show the voice mode button. */
export type VoiceModeToggle = Pick<Assistant, 'open' | 'phase' | 'toggle'>;

/** Starts or ends voice mode; kept distinct from the input box's dictation microphone. */
export function VoiceToggleButton({
  voice,
  disabled = false,
  className,
}: {
  voice: VoiceModeToggle;
  disabled?: boolean;
  className?: string;
}): ReactElement {
  const active = voice.open;
  const label = active ? 'End voice mode' : 'Start voice mode';
  return (
    <button
      type='button'
      onClick={voice.toggle}
      disabled={disabled}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        active
          ? 'bg-claw-ai-fg/10 text-claw-ai-fg'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
        className,
      )}
      data-track-category='XyneAI'
      data-track-name='TOGGLE_VOICE_MODE'
    >
      <VoiceOrb phase={voice.phase} active={active} className='h-6 w-6' />
    </button>
  );
}
