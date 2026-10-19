import { ReactElement } from 'react';
import { WorkspaceRole } from '@xyne/shared';
import { cn } from '../../../utils/classNames';

interface GuestLabelProps {
  /** The user's workspace role; the label renders only for GUEST. */
  role: string | null | undefined;
  className?: string;
}

/** Muted "Guest" pill shown after a guest user's name. Renders nothing for anyone else. */
export const GuestLabel = ({ role, className }: GuestLabelProps): ReactElement | null =>
  role === WorkspaceRole.GUEST ? (
    <span
      className={cn(
        'shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground',
        className,
      )}
    >
      Guest
    </span>
  ) : null;
