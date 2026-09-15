import type { ReactElement } from 'react';
import { Switch } from '../ui/Switch';
import { useRecordingPillSettings } from '../../hooks/useRecordingPillSettings';

export function RecordingPillToggle(): ReactElement | null {
  const { pillEnabled, isSupported, setPillEnabled } = useRecordingPillSettings();

  if (!isSupported) return null;

  return (
    <div className='flex items-center justify-between gap-4 p-3 rounded-lg border border-border bg-muted/30'>
      <div>
        <p className='text-sm font-medium text-foreground'>Floating recording pill</p>
        <p className='text-xs text-muted-foreground mt-0.5'>
          Show a draggable pill with the timer and recording controls when Xyne is in the background
        </p>
      </div>
      <Switch
        id='recording-pill'
        aria-label='Show floating recording pill'
        checked={pillEnabled}
        onCheckedChange={setPillEnabled}
      />
    </div>
  );
}
