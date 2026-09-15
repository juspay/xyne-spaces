import type { ReactElement, ReactNode } from 'react';
import { Tooltip } from './Tooltip';
import type { TooltipProps } from './Tooltip';
import { ShortcutHint, resolveShortcutKeys } from './ShortcutHint';
import type { ShortcutId } from '../../shortcuts';

export interface ShortcutTooltipProps extends Omit<TooltipProps, 'content'> {
  /** Text shown beside the key hint, e.g. "Search". */
  label: ReactNode;
  /** Catalog id the trigger mirrors; the combo is read from the catalog. */
  shortcut: ShortcutId;
  /** Pick a specific combo when the catalog entry binds several, e.g. `mod+3`. */
  keys?: string;
}

/**
 * Tooltip for a control that a registered shortcut can also trigger.
 *
 * Falls back to the bare label when the shortcut cannot fire on this platform,
 * so no tooltip advertises a key that does nothing.
 */
export const ShortcutTooltip = ({
  label,
  shortcut,
  keys,
  children,
  ...tooltipProps
}: ShortcutTooltipProps): ReactElement => {
  const combo = keys ?? resolveShortcutKeys(shortcut);

  return (
    <Tooltip
      content={
        combo !== undefined ? (
          <span className='flex items-center gap-2'>
            {label}
            <ShortcutHint keys={combo} />
          </span>
        ) : (
          label
        )
      }
      {...tooltipProps}
    >
      {children}
    </Tooltip>
  );
};

export default ShortcutTooltip;
