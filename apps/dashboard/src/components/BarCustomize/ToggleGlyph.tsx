import type { ReactElement } from 'react';
import { cn } from '../../utils/classNames';

/**
 * A switch drawn as a picture, for rows where the row itself is the control.
 *
 * Those rows carry `role="switch"` on their own button, so a real `ui/Switch`
 * here would nest a button inside a button. This mirrors that component's
 * default variant (same track, thumb and travel) and holds no semantics of its
 * own — the button it sits in announces the state.
 */
export const ToggleGlyph = ({ checked }: { checked: boolean }): ReactElement => (
  <span
    aria-hidden='true'
    className={cn(
      'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full p-[3px] transition-colors',
      checked ? 'bg-primary' : 'bg-muted',
    )}
  >
    <span
      className={cn(
        'inline-block h-3.5 w-3.5 rounded-full bg-background shadow-sm transition-transform',
        checked ? 'translate-x-4' : 'translate-x-0',
      )}
    />
  </span>
);
