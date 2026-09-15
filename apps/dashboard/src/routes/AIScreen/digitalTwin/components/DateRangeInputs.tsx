import type { ReactElement } from 'react';
import {
  isoDate,
  type UseDigitalTwinRangeResult,
} from '@/components/ClawAgents/digitalTwin/useDigitalTwinRange';

const INPUT_CLASS =
  'w-auto shrink-0 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs text-foreground focus:border-ring focus:outline-none';

export const DateRangeInputs = ({
  range,
  trackName,
  showDayCount = false,
}: {
  range: UseDigitalTwinRangeResult;
  trackName: string;
  showDayCount?: boolean;
}): ReactElement => (
  <div className='flex flex-wrap items-center gap-2'>
    <input
      type='date'
      value={range.customFrom}
      max={range.customTo}
      onChange={e => range.setCustomFrom(e.target.value)}
      data-track-category='Claw Agents'
      data-track-name={`${trackName} from date`}
      className={INPUT_CLASS}
    />
    <span className='shrink-0 text-xs text-muted-foreground'>→</span>
    <input
      type='date'
      value={range.customTo}
      min={range.customFrom}
      max={isoDate(new Date())}
      onChange={e => range.setCustomTo(e.target.value)}
      data-track-category='Claw Agents'
      data-track-name={`${trackName} to date`}
      className={INPUT_CLASS}
    />
    {showDayCount && range.customDays > 0 && (
      <span className='shrink-0 text-xs tabular-nums text-muted-foreground'>
        {range.customDays}d
      </span>
    )}
  </div>
);
