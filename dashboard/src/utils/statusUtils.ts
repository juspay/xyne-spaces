export const DEFAULT_STATUS_EMOJI = '💬';

export interface ExpiryOption {
  label: string;
  value: string;
}

export const EXPIRY_OPTIONS: ExpiryOption[] = [
  { label: "Don't clear", value: 'dont-clear' },
  { label: '30 minutes', value: '30min' },
  { label: '1 hour', value: '1hour' },
  { label: '4 hours', value: '4hours' },
  { label: 'Today', value: 'today' },
  { label: 'This week', value: 'week' },
  { label: 'Custom', value: 'custom' },
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
  if (!expiryAt) return "Don't clear";

  const now = new Date();
  const expiry = new Date(expiryAt);
  const diff = expiryAt - now.getTime();

  // If expired
  if (diff <= 0) {
    return useUntilFormat ? 'Expired' : 'Expired';
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
    return useUntilFormat ? `Until ${timeText}` : timeText;
  }

  if (daysDiff === 1) {
    // Tomorrow - show "Until tomorrow, [time]"
    return useUntilFormat ? `Until tomorrow, ${timeText}` : `Tomorrow, ${timeText}`;
  }

  // Beyond tomorrow - show "Until [date], [time]"
  const dateText = expiry.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
  });
  return useUntilFormat ? `Until ${dateText}, ${timeText}` : `${dateText}, ${timeText}`;
};
