import { format, isThisYear, isToday, isYesterday } from 'date-fns';

/** Gmail-ish: "2:31 am" today, "Yesterday", "21 Jul", or "21 Jul 2025". */
export function formatTicketListTimestamp(ms: number): string {
  if (!ms) return '';
  const date = new Date(ms);
  if (isToday(date)) return format(date, 'h:mm aaa');
  if (isYesterday(date)) return 'Yesterday';
  if (isThisYear(date)) return format(date, 'd MMM');
  return format(date, 'd MMM yyyy');
}
