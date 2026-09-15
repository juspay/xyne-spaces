import i18next from '@/locales';

export const DEFAULT_STATUS_EMOJI = '💬';

export interface ExpiryOption {
  labelKey: string;
  value: string;
}

export const EXPIRY_OPTIONS: ExpiryOption[] = [
  { labelKey: 'statusUtils.expiryOptions.dontClear', value: 'dont-clear' },
  { labelKey: 'statusUtils.expiryOptions.thirtyMinutes', value: '30min' },
  { labelKey: 'statusUtils.expiryOptions.oneHour', value: '1hour' },
  { labelKey: 'statusUtils.expiryOptions.fourHours', value: '4hours' },
  { labelKey: 'statusUtils.expiryOptions.today', value: 'today' },
  { labelKey: 'statusUtils.expiryOptions.thisWeek', value: 'week' },
  { labelKey: 'statusUtils.expiryOptions.custom', value: 'custom' },
];

/**
 * Calculate expiry timestamp based on selected option
 */
export const calculateExpiryTime = (option: string, customDateTime?: Date): number | null => {
  const now = new Date();

  switch (option) {
    case '30min':
      return now.getTime() + 30 * 60 * 1000;

    case '1hour':
      return now.getTime() + 60 * 60 * 1000;

    case '4hours':
      return now.getTime() + 4 * 60 * 60 * 1000;

    case 'today': {
      const endOfDay = new Date(now);
      endOfDay.setHours(23, 59, 59, 999);
      return endOfDay.getTime();
    }

    case 'week': {
      const endOfWeek = new Date(now);
      const daysUntilSunday = 7 - endOfWeek.getDay();
      endOfWeek.setDate(endOfWeek.getDate() + daysUntilSunday);
      endOfWeek.setHours(23, 59, 59, 999);
      return endOfWeek.getTime();
    }

    case 'custom':
      return customDateTime?.getTime() || null;

    case 'dont-clear':
    default:
      return null;
  }
};

/**
 * Check if a status has expired
 */
export const isStatusExpired = (expiryAt: number | null): boolean => {
  if (!expiryAt) return false;
  return Date.now() > expiryAt;
};

/**
 * Format expiry time for display
 */
export const formatExpiryTime = (expiryAt: number | null, useUntilFormat = false): string => {
  if (!expiryAt) return i18next.t('statusUtils.expiryOptions.dontClear');

  const now = new Date();
  const expiry = new Date(expiryAt);
  const diff = expiryAt - now.getTime();

  // If expired
  if (diff <= 0) {
    return i18next.t('statusUtils.expired');
  }

  // Check if it's today
  const nowDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const expiryDate = new Date(expiry.getFullYear(), expiry.getMonth(), expiry.getDate());
  const timeDiff = expiryDate.getTime() - nowDate.getTime();
  const daysDiff = Math.floor(timeDiff / (24 * 60 * 60 * 1000));

  // Format time
  const timeText = expiry.toLocaleString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });

  if (daysDiff === 0) {
    // Same day - show "Until [time]"
    return useUntilFormat ? i18next.t('statusUtils.untilTime', { time: timeText }) : timeText;
  }

  if (daysDiff === 1) {
    // Tomorrow - show "Until tomorrow, [time]"
    return useUntilFormat
      ? i18next.t('statusUtils.untilTomorrow', { time: timeText })
      : i18next.t('statusUtils.tomorrowTime', { time: timeText });
  }

  // Beyond tomorrow - show "Until [date], [time]"
  const dateText = expiry.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
  });
  return useUntilFormat
    ? i18next.t('statusUtils.untilDateTime', { date: dateText, time: timeText })
    : i18next.t('statusUtils.dateTime', { date: dateText, time: timeText });
};
