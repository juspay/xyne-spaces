import type { ReactElement } from 'react';
import { Switch } from '../ui/Switch';
import { useDailyBriefEnabled } from '../../hooks/useDailyBriefEnabled';

export function DailyBriefToggle(): ReactElement {
  const { enabled, loading, saving, setEnabled } = useDailyBriefEnabled();

  return (
    <div data-track-category='DailyBrief' data-track-name='daily-brief-preferences-toggle'>
      <div className='flex items-center justify-between gap-4'>
        <div>
          <p className='text-sm font-medium text-foreground'>Morning brief</p>
          <p className='mt-0.5 text-xs text-muted-foreground'>
            A brief of everything waiting on you, ready each morning
          </p>
        </div>
        <Switch
          id='daily-brief-enabled'
          checked={enabled === true}
          disabled={loading || saving}
          onCheckedChange={setEnabled}
        />
      </div>
    </div>
  );
}
