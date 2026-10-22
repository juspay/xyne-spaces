import { format, isToday } from 'date-fns';

export type EmailHeaderDate = {
  short: string;
  full: string;
};

/** Short (list-style) + full (details panel) date labels. */
export function formatEmailHeaderDate(timestamp: number | null | undefined): EmailHeaderDate {
  if (!timestamp) return { short: '', full: 'Unknown date' };
  const date = new Date(timestamp);
  const short = isToday(date) ? format(date, 'h:mm aaa') : format(date, 'd MMM');
  const full = format(date, "EEE, MMMM d, yyyy 'at' h:mm a");
  return { short, full };
}
