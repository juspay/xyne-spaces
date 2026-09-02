import type { ReactElement } from 'react';
import { Switch } from '../ui/Switch';
import { useClawOverlaySettings } from '../../hooks/useClawOverlaySettings';
import { isMac } from '../../hooks/usePlatform';
import { formatShortcut } from '../../shortcuts';

function acceleratorToShortcutKeys(accelerator: string): string {
  return accelerator.replace(/CommandOrControl|CmdOrCtrl/g, 'mod').toLowerCase();
}

export function ClawOverlayToggle(): ReactElement | null {
  const { enabled, isSupported, shortcut, setEnabled } = useClawOverlaySettings();

  if (!isSupported) return null;

  return (
    <>
      <div className='flex items-center justify-between gap-4 rounded-lg border border-border bg-muted/30 p-3'>
        <div>
          <p className='text-sm font-medium text-foreground'>Open Claw from anywhere</p>
          <p className='mt-0.5 text-xs text-muted-foreground'>
            {shortcut
              ? 'Press this shortcut in any app to bring up the Claw composer'
              : 'The Claw shortcut could not be registered — another app may already be using it'}
          </p>
        </div>
        {shortcut ? (
          <kbd className='shrink-0 rounded-md border border-border bg-background px-2 py-1 font-mono text-xs text-foreground'>
            {formatShortcut(acceleratorToShortcutKeys(shortcut), isMac() === true)}
          </kbd>
        ) : (
          <span className='shrink-0 text-xs font-medium text-destructive'>Unavailable</span>
        )}
      </div>
      <div className='flex items-center justify-between gap-4 rounded-lg border border-border bg-muted/30 p-3'>
        <div>
          <p className='text-sm font-medium text-foreground'>Keep Claw docked</p>
          <p className='mt-0.5 text-xs text-muted-foreground'>
            Also show Claw as a pill in the corner of your screen, above other apps
          </p>
        </div>
        <Switch id='claw-overlay' checked={enabled} onCheckedChange={setEnabled} />
      </div>
    </>
  );
}
