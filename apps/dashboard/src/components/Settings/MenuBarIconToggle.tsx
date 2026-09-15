import type { ReactElement } from 'react';
import { Switch } from '../ui/Switch';
import { useTraySettings } from '../../hooks/useTraySettings';

export function MenuBarIconToggle(): ReactElement | null {
  const { trayVisible, isSupported, setTrayVisible } = useTraySettings();

  if (!isSupported) return null;

  const isMac = window.electronAPI?.platform === 'darwin';
  const surface = isMac ? 'menu bar' : 'system tray';

  return (
    <div className='flex items-center justify-between gap-4 p-3 rounded-lg border border-border bg-muted/30'>
      <div>
        <p className='text-sm font-medium text-foreground'>
          {isMac ? 'Menu bar icon' : 'System tray icon'}
        </p>
        <p className='text-xs text-muted-foreground mt-0.5'>
          Show the Xyne icon in your {surface} for quick recording controls. Hiding it does not
          affect the recording keyboard shortcut.
        </p>
      </div>
      <Switch
        id='menu-bar-icon'
        aria-label={`Show ${surface} icon`}
        checked={trayVisible}
        onCheckedChange={setTrayVisible}
      />
    </div>
  );
}
