import type { ReactElement } from 'react';
import { formatRelativeTime } from '@/utils/dateUtils';
import type { ArtifactAppsAnalytics } from '@/services/claw/artifactAppsService';
import { AnalyticsCard } from './AnalyticsCard';

/**
 * Agent runs the viewer started themselves that failed, on apps they can open.
 * Never anyone else's runs: viewers don't see each other's runs anywhere.
 */
export const RecentErrorsCard = ({
  errors,
  days,
}: {
  errors: ArtifactAppsAnalytics['recentErrors'];
  days: number;
}): ReactElement => (
  <AnalyticsCard
    title='Your recent agent run errors'
    subtitle='Failed agent runs you started, on apps you can open. One line per error.'
  >
    {errors.length === 0 ? (
      <p className='py-6 text-center text-sm text-muted-foreground'>
        None of your agent runs failed in the last {days} days.
      </p>
    ) : (
      <ul className='flex flex-col'>
        {errors.map((e, i) => (
          <li
            key={`${e.appId}-${e.at}-${i}`}
            className='flex flex-col gap-1 border-t border-border py-2.5 first:border-t-0 first:pt-0'
          >
            <div className='flex items-center gap-2 text-xs'>
              <span className='font-medium text-foreground'>{e.appTitle}</span>
              <span className='rounded-full bg-muted px-1.5 text-[11px] text-muted-foreground'>
                {e.source === 'dispatch' ? 'Could not start' : 'Failed while running'}
              </span>
              <span className='text-muted-foreground'>{formatRelativeTime(new Date(e.at))}</span>
            </div>
            <p className='truncate font-mono text-xs text-muted-foreground' title={e.message}>
              {e.message}
            </p>
          </li>
        ))}
      </ul>
    )}
  </AnalyticsCard>
);
