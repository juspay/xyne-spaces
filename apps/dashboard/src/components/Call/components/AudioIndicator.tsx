import { MicOff } from 'lucide-react';
import { cn } from '../../../utils/classNames';

const BAR_DELAYS_MS = [0, 180, 90];

/** Three bouncing equaliser bars — Meet's "this person is talking" glyph. */
function AudioBars(): React.ReactElement {
  return (
    <span aria-hidden className='flex h-2.5 items-center gap-[2px]'>
      {BAR_DELAYS_MS.map((delay, i) => (
        <span
          key={i}
          className='h-full w-[3px] origin-center animate-call-audio-bar rounded-full bg-current'
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </span>
  );
}

interface AudioIndicatorProps {
  isMuted: boolean;
  isSpeaking: boolean;
  className?: string;
}

/**
 * Small round mic-state badge: a muted mic on a dark disc, or bouncing bars on a
 * blue disc while talking. Renders nothing for an unmuted, silent participant, so
 * the badge only appears when it carries information.
 */
export function AudioIndicator({
  isMuted,
  isSpeaking,
  className,
}: AudioIndicatorProps): React.ReactElement | null {
  if (!isMuted && !isSpeaking) return null;

  if (isMuted) {
    return (
      <span
        className={cn(
          'flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-md',
          className,
        )}
        title='Muted'
      >
        <MicOff className='h-3 w-3' />
        <span className='sr-only'>Muted</span>
      </span>
    );
  }

  return (
    <span
      className={cn(
        'flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-[#1a73e8] text-white',
        className,
      )}
      title='Speaking'
    >
      <AudioBars />
    </span>
  );
}
