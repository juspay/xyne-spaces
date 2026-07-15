import type { ReactElement } from 'react';
import { Switch } from '../ui/Switch';
import { useClawOverlaySettings } from '../../hooks/useClawOverlaySettings';

export function ClawOverlayToggle(): ReactElement | null {
  const { enabled, isSupported, setEnabled } = useClawOverlaySettings();

  if (!isSupported) return null;

  return (
    <div className='flex items-center justify-between gap-4 rounded-lg border border-border bg-muted/30 p-3'>
      <div>
        <p className='text-sm font-medium text-foreground'>Claw</p>
        <p className='mt-0.5 text-xs text-muted-foreground'>
          Keeps Claw docked to the edge of your screen, above other apps
        </p>
      </div>
      <Switch id='claw-overlay' checked={enabled} onCheckedChange={setEnabled} />
    </div>
  );
}
