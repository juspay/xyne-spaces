import type { ReactElement } from 'react';
import { Switch } from '../ui/Switch';
import { cn } from '../../utils/classNames';
import { useDailyBriefEnabled } from '../../hooks/useDailyBriefEnabled';

interface DailyBriefToggleProps {
  /** Morning Brief lives inside the Xyne AI sidebar, which "Open AI on launch" gates. */
  available: boolean;
}

export function DailyBriefToggle({ available }: DailyBriefToggleProps): ReactElement {
  const { enabled, loading, saving, setEnabled } = useDailyBriefEnabled();
  const stranded = !available && enabled === true;

  return (
    <div
      className='mt-3 border-t border-border pt-3'
      data-track-category='DailyBrief'
      data-track-name='daily-brief-preferences-toggle'
    >
      <div className='flex items-center justify-between gap-4'>
        <div className={cn(!available && 'opacity-50')}>
          <p className='text-sm font-medium text-foreground'>Morning brief</p>
          <p className='mt-0.5 text-xs text-muted-foreground'>
            {available
              ? 'A brief of everything waiting on you, ready each morning'
              : 'Needs “Open AI on launch” — the brief lives in the Xyne AI sidebar'}
          </p>
        </div>
        <Switch
          id='daily-brief-enabled'
          checked={enabled === true}
          disabled={!available || loading || saving}
          onCheckedChange={setEnabled}
        />
      </div>
      {stranded && (
        <p className='mt-2 text-xs text-amber-600 dark:text-amber-500'>
          Your morning brief is still being generated each day. Turn “Open AI on launch” back on to
          switch it off.
        </p>
      )}
    </div>
  );
}
