import type { ReactElement } from 'react';
import { cn } from '../../utils/classNames';
import { usePlatform } from '../../hooks/usePlatform';
import { formatShortcut, getShortcut } from '../../shortcuts';
import type { ShortcutId } from '../../shortcuts';
import { isElectronApp } from '../../utils/electronApp';

interface ShortcutHintProps {
  /** Literal combo, e.g. 'mod+o'. Takes precedence over `shortcut`. */
  keys?: string;
  /** Catalog id to read the combo from, so a rebind updates every trigger. */
  shortcut?: ShortcutId;
  className?: string;
}

/**
 * Resolve the combo to advertise for a catalog entry, or undefined when the
 * binding cannot fire here — Electron-only shortcuts are dead in the browser
 * and must not be promised.
 */
export const resolveShortcutKeys = (shortcut: ShortcutId): string | undefined => {
  const definition = getShortcut(shortcut);
  if (!definition || (definition.electronOnly === true && !isElectronApp())) return undefined;

  const bound = definition.displayKeys ?? definition.keys;
  return Array.isArray(bound) ? bound[0] : bound;
};

export const ShortcutHint = ({
  keys,
  shortcut,
  className,
}: ShortcutHintProps): ReactElement | null => {
  const { isMobile, isMac } = usePlatform();
  const combo = keys ?? (shortcut !== undefined ? resolveShortcutKeys(shortcut) : undefined);

  if (isMobile || combo === undefined) return null;

  return (
    <span aria-hidden='true' className={cn('opacity-60 tabular-nums', className)}>
      {formatShortcut(combo, isMac)}
    </span>
  );
};

export default ShortcutHint;
