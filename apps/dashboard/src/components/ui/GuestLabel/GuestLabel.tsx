import { ReactElement } from 'react';
import { WorkspaceRole } from '@xyne/shared';
import { cn } from '../../../utils/classNames';

interface GuestLabelProps {
  /** The user's workspace role; the label renders only for GUEST. */
  role: string | null | undefined;
  className?: string;
}

/** Muted "· guest" text shown after a guest user's name. Renders nothing for anyone else. */
export const GuestLabel = ({ role, className }: GuestLabelProps): ReactElement | null =>
  role === WorkspaceRole.GUEST ? (
    <span
      className={cn(
        'shrink-0 whitespace-nowrap text-sm font-normal text-muted-foreground',
        className,
      )}
    >
      · guest
    </span>
  ) : null;

/** The same marker for plain-text slots (e.g. a combobox description): ' · guest' or ''. */
export const guestSuffix = (role: string | null | undefined): string =>
  role === WorkspaceRole.GUEST ? ' · guest' : '';
