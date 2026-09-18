import { Flag } from 'lucide-react';
import { cn } from '../../../utils/classNames';
import { useCallMarkMoment } from '../hooks/useCallMarkMoment';

export interface MarkMomentButtonProps {
  externalId: string | null;
  callStartedAtMs: number | null;
  isAllowed: boolean;
  hasCustomSizing: boolean;
  iconSize: number;
  buttonPadding: number;
  buttonClasses: string;
  midnightControlClass: string;
  callId: string;
}

/**
 * Its own component so `useZero` only mounts where a ZeroProvider exists —
 * the external call page has none, so the parent must not render this there.
 */
export function MarkMomentButton({
  externalId,
  callStartedAtMs,
  isAllowed,
  hasCustomSizing,
  iconSize,
  buttonPadding,
  buttonClasses,
  midnightControlClass,
  callId,
}: MarkMomentButtonProps): React.ReactElement | null {
  const { markMoment, canMark } = useCallMarkMoment(externalId, callStartedAtMs, isAllowed);
  if (!canMark) return null;

  return (
    <button
      onClick={markMoment}
      className={cn(buttonClasses, midnightControlClass)}
      style={hasCustomSizing ? { padding: `${buttonPadding}px` } : undefined}
      title='Mark this moment'
      aria-label='Mark this moment'
      data-track-event='BUTTON_CLICK'
      data-track-category='CALLS'
      data-track-name='MARK_MOMENT'
      data-track-metadata={JSON.stringify({ callId })}
    >
      <Flag
        className={hasCustomSizing ? '' : 'w-5 h-5 sm:w-6 sm:h-6'}
        style={hasCustomSizing ? { width: `${iconSize}px`, height: `${iconSize}px` } : undefined}
      />
    </button>
  );
}
