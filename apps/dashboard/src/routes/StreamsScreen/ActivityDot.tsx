import type { ReactElement } from 'react';
import { cn } from '../../utils/classNames';
import type { ColumnActivity } from './useColumnActivity';

/**
 * What is new in a column, in the two tiers the rest of Xyne already uses.
 *
 * A **number** for things addressed to you — mentions, DMs, assignments — and a
 * **dot** for a column that simply moved. That split is the sidebar's, and this
 * component exists so every surface in Streams inherits it rather than each one
 * deciding again.
 *
 * It used to draw a dot for both, which quietly threw away the louder half: nine
 * mentions and one stray "morning" rendered identically, in the column header,
 * the focus rail, the dock and the overview alike. The count was known the whole
 * time — `ColumnActivity.count` — and simply not shown.
 *
 * `9+` rather than the real number past nine, matching `ChannelItemV2` and the
 * top nav: three digits is a name's worth of width in a rail 208px wide.
 */
export const ActivityDot = ({
  activity,
  className,
}: {
  activity: ColumnActivity;
  className?: string;
}): ReactElement | null => {
  if (activity.count === 0 && !activity.hasNew) return null;

  if (activity.count > 0)
    return (
      <span
        className={cn(
          // The sidebar's badge, verbatim — same height, radius, type size and
          // weight, so a row in the rail and a row in the real sidebar a few
          // pixels away carry the same mark.
          'flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full',
          'bg-primary px-[5px] text-[11px] font-semibold leading-none text-primary-foreground',
          className,
        )}
        title={`${activity.count} ${activity.count === 1 ? 'mention' : 'mentions'}`}
        aria-label={`${activity.count} unread ${activity.count === 1 ? 'mention' : 'mentions'}`}
      >
        {activity.count > 9 ? '9+' : activity.count}
      </span>
    );

  return (
    <span
      className={cn('block size-1.5 shrink-0 rounded-full bg-primary', className)}
      title='New since you last looked'
      aria-label='New activity'
    />
  );
};

ActivityDot.displayName = 'ActivityDot';
