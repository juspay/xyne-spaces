import { Flag } from 'lucide-react';
import { useCallMarkMoment } from '../hooks/useCallMarkMoment';
import { DropdownMenuItem } from '../../ui/dropdown-menu';
import { ControlButton, type ControlSizing } from './ControlButton';

interface MarkMomentBaseProps {
  externalId: string | null;
  callStartedAtMs: number | null;
  isAllowed: boolean;
  callId: string;
}

/** A disc in the mini window's control row, or an entry in the full view's ⋮ menu. */
export type MarkMomentButtonProps = MarkMomentBaseProps &
  (
    | { variant: 'button'; sizing: ControlSizing }
    | { variant: 'menuItem'; menuItemClassName?: string | undefined }
  );

/**
 * Its own component so `useZero` only mounts where a ZeroProvider exists —
 * the external call page has none, so the parent must not render this there.
 */
export function MarkMomentButton(props: MarkMomentButtonProps): React.ReactElement | null {
  const { externalId, callStartedAtMs, isAllowed, callId } = props;
  const { markMoment, canMark } = useCallMarkMoment(externalId, callStartedAtMs, isAllowed);
  if (!canMark) return null;

  if (props.variant === 'menuItem') {
    return (
      <DropdownMenuItem
        onClick={markMoment}
        className={props.menuItemClassName}
        data-track-event='BUTTON_CLICK'
        data-track-category='CALLS'
        data-track-name='MARK_MOMENT'
        data-track-metadata={JSON.stringify({ callId })}
      >
        <Flag className='h-4 w-4 text-[#c4c7c5]' aria-hidden />
        <span>Mark this moment</span>
      </DropdownMenuItem>
    );
  }

  return (
    <ControlButton
      sizing={props.sizing}
      icon={Flag}
      label='Mark this moment'
      onClick={markMoment}
      data-track-event='BUTTON_CLICK'
      data-track-category='CALLS'
      data-track-name='MARK_MOMENT'
      data-track-metadata={JSON.stringify({ callId })}
    />
  );
}
