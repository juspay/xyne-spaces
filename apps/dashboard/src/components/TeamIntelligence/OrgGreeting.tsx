import { ReactElement, useMemo } from 'react';
import { format } from 'date-fns';
import { TZDate } from '@date-fns/tz';

// Auto-detect user's system timezone, fallback to India time
const getSystemTimezone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return 'Asia/Kolkata';
  }
};

const DEFAULT_TIMEZONE = getSystemTimezone();

const getGreeting = (hour: number): string => {
  if (hour >= 5 && hour < 12) {
    return 'Good morning';
  } else if (hour >= 12 && hour < 17) {
    return 'Good afternoon';
  } else if (hour >= 17 && hour < 21) {
    return 'Good evening';
  }
  return 'Good night';
};

interface OrgGreetingProps {
  /** Date range to display */
  dateRange: { from: string; to: string };
  /** Timezone identifier (e.g., 'Asia/Kolkata', 'America/New_York') */
  timezone?: string;
}

const OrgGreeting = ({
  dateRange,
  timezone = DEFAULT_TIMEZONE,
}: OrgGreetingProps): ReactElement => {
  const { from, to } = dateRange;

  // Parse range dates in the target timezone to avoid UTC shift
  const fromDate = useMemo(() => new TZDate(from, timezone), [from, timezone]);
  const toDate = useMemo(() => new TZDate(to, timezone), [to, timezone]);

  const isSameDate = from === to;

  // Format single date or date range
  const formattedDate = useMemo(() => {
    const fromFormatted = format(fromDate, 'MMMM d');

    if (isSameDate) {
      return `${fromFormatted}, ${format(fromDate, 'yyyy')}`;
    }

    const toFormatted = format(toDate, 'MMMM d');
    const year = format(fromDate, 'yyyy');

    return `${fromFormatted} – ${toFormatted}, ${year}`;
  }, [fromDate, toDate, isSameDate]);

  // Get current time in the specified timezone for greeting
  const now = useMemo(() => new TZDate(new Date(), timezone), [timezone]);
  const greeting = getGreeting(now.getHours());

  return (
    <div className='space-y-2'>
      <p className='text-sm font-medium uppercase tracking-widest text-action-primary'>
        {formattedDate}
      </p>
      <h2 className='text-3xl font-light leading-relaxed text-foreground md:text-4xl text-balance max-w-2xl'>
        {greeting}, here&apos;s what&apos;s happening across your{' '}
        <span className='text-action-accent font-normal'>organisation</span>.
      </h2>
    </div>
  );
};

export default OrgGreeting;
