import axios from 'axios';

export type CalendarSyncMessage = {
  text: string;
  ok: boolean;
  reauth?: boolean;
};

export type CalendarReauthCountdown = {
  count: number;
  authUrl: string;
};

export type CalendarOAuthReturn = {
  hasResult: boolean;
  shouldAutoSync: boolean;
  hasError: boolean;
  remainingSearch: string;
};

export function parseCalendarOAuthReturn(search: string): CalendarOAuthReturn {
  const params = new URLSearchParams(search);
  const shouldAutoSync = params.get('syncCalendar') === 'true';
  const hasError = params.has('calendarOAuthError');
  const hasResult = shouldAutoSync || params.has('calendarOAuth') || hasError;

  if (hasResult) {
    params.delete('syncCalendar');
    params.delete('calendarOAuth');
    params.delete('calendarOAuthError');
  }

  return {
    hasResult,
    shouldAutoSync: shouldAutoSync && !hasError,
    hasError,
    remainingSearch: params.toString(),
  };
}

export function isCalendarReauthorizationError(error: unknown): boolean {
  if (axios.isAxiosError(error)) {
    return error.response?.status === 500;
  }

  return typeof error === 'object' && error !== null && 'status' in error && error.status === 500;
}
