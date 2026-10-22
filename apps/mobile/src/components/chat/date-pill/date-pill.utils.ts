import { format, isToday, isValid, isYesterday } from 'date-fns';

export type ChatDateLabelOrder = 'month-day' | 'day-month';
export type ChatDateLabelYear = 'auto' | 'never' | 'always';

export interface ChatDateLabelOptions {
  order?: ChatDateLabelOrder;
  relativeLabels?: boolean;
  year?: ChatDateLabelYear;
}

export const formatChatDateLabel = (
  date: Date | number,
  { order = 'month-day', relativeLabels = false, year = 'auto' }: ChatDateLabelOptions = {},
): string => {
  const messageDate = new Date(date);
  if (!isValid(messageDate)) return 'Date unavailable';
  if (relativeLabels) {
    if (isToday(messageDate)) return 'Today';
    if (isYesterday(messageDate)) return 'Yesterday';
  }

  const includeYear =
    year === 'always' ||
    (year === 'auto' && new Date().getFullYear() !== messageDate.getFullYear());
  if (order === 'day-month') {
    return format(messageDate, includeYear ? 'EEEE, d MMMM yyyy' : 'EEEE, d MMMM');
  }
  return format(messageDate, includeYear ? 'EEEE, MMMM d, yyyy' : 'EEEE, MMMM d');
};

export const resolveTopIndex = (start: number, end: number, total: number): number | null => {
  if (total <= 0) return null;

  if (Number.isInteger(start) && start >= 0 && start < total) {
    return start;
  }

  if (Number.isInteger(end) && end >= 0 && end < total) {
    return end;
  }

  return 0;
};

export const findNearestMatchingIndex = <T>(
  items: readonly T[],
  fromIndex: number,
  isMatch: (item: T) => boolean,
): number => {
  for (let i = fromIndex; i < items.length; i++) {
    const item = items[i];
    if (item && isMatch(item)) return i;
  }

  for (let i = fromIndex - 1; i >= 0; i--) {
    const item = items[i];
    if (item && isMatch(item)) return i;
  }

  return -1;
};
