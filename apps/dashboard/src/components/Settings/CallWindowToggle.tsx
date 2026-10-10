import type { ReactElement } from 'react';
import { Switch } from '../ui/Switch';
import { useCallWindowSettings } from '../../utils/callWindow';

export function CallWindowToggle(): ReactElement | null {
  const { enabled, isSupported, setEnabled } = useCallWindowSettings();

  if (!isSupported) return null;

  return (
    <div className='flex items-center justify-between gap-4 p-3 rounded-lg border border-border bg-muted/30'>
      <div>
        <p className='text-sm font-medium text-foreground'>Open calls in a separate window</p>
        <p className='text-xs text-muted-foreground mt-0.5'>
          Show calls in their own window you can move, resize or keep beside your work. Turn off to
          show calls inside the app. Applies to the next call you join.
        </p>
      </div>
      <Switch
        id='call-separate-window'
        aria-label='Open calls in a separate window'
        checked={enabled}
        onCheckedChange={setEnabled}
      />
    </div>
  );
}
