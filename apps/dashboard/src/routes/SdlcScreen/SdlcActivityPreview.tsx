import {
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
} from 'react';
import { Bell } from 'lucide-react';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { queries } from '../../zero/queries';
import { ActivityItem } from '../../components/Activity/ActivityItem';
import { Button } from '../../components/ui/Button';
import type { ActivityWithRelated } from '../../types/activity';

interface SdlcActivityPreviewProps {
  channelId: string;
}

const PAGE_SIZE = 20;

export function SdlcActivityPreview({ channelId }: SdlcActivityPreviewProps): ReactElement {
  const [cursor, setCursor] = useState<{ id: string; updatedAt: number } | null>(null);
  const [accumulated, setAccumulated] = useState<ActivityWithRelated[]>([]);
  const [activities, queryDetails] = useCachedQuery(
    queries.sdlcUserActivities({ channelId, limit: PAGE_SIZE + 1, start: cursor }),
  );
  const rows = useMemo(
    () => (Array.isArray(activities) ? (activities as ActivityWithRelated[]) : []),
    [activities],
  );
  const pageRows = useMemo(() => rows.slice(0, PAGE_SIZE), [rows]);
  const hasMore = rows.length > PAGE_SIZE;
  useEffect(() => {
    if (queryDetails.type !== 'complete') return;
    setAccumulated(current => {
      const next = cursor ? [...current, ...pageRows] : pageRows;
      return Array.from(new Map(next.map(activity => [activity.id, activity])).values());
    });
  }, [cursor, pageRows, queryDetails.type]);
  const stopClick = (event: MouseEvent): void => {
    event.preventDefault();
    event.stopPropagation();
  };
  const stopActivation = (event: KeyboardEvent): void => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <section
      className='mt-5 rounded-xl border bg-background p-5'
      aria-labelledby='sdlc-activity-title'
    >
      <div className='flex items-center justify-between gap-3'>
        <div>
          <h3 id='sdlc-activity-title' className='font-semibold'>
            Your repository activity
          </h3>
          <p className='mt-1 text-sm text-muted-foreground'>
            View-only Activity filtered to this repository channel.
          </p>
        </div>
        <Bell className='size-4 text-muted-foreground' />
      </div>

      <div className='mt-4 space-y-3'>
        {queryDetails.type !== 'complete' && accumulated.length === 0 ? (
          <div className='rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground'>
            Loading activity…
          </div>
        ) : accumulated.length === 0 ? (
          <div className='rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground'>
            No activity for you in this repository yet.
          </div>
        ) : (
          accumulated.map(activity => (
            <div
              key={activity.id}
              className='rounded-lg [&_a]:pointer-events-none [&_button]:pointer-events-none'
              onClickCapture={stopClick}
              onKeyDownCapture={stopActivation}
              aria-label='View-only activity item'
            >
              <ActivityItem activity={activity} isExpanded={false} />
            </div>
          ))
        )}
        {hasMore ? (
          <div className='flex justify-center pt-1'>
            <Button
              variant='ghost'
              size='sm'
              disabled={queryDetails.type !== 'complete'}
              onClick={() => {
                const last = pageRows.at(-1);
                if (last && typeof last.updatedAt === 'number') {
                  setCursor({ id: last.id, updatedAt: last.updatedAt });
                }
              }}
              data-track-category='SdlcHub'
              data-track-name='ShowMoreActivity'
            >
              Show more
            </Button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
