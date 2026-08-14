import { apiInstance } from './apiClient';

export type CalendarOAuthPlatform = 'web' | 'electron';
export type CalendarProvider = 'GOOGLE' | 'MICROSOFT';

type CalendarProviderResponse = {
  success: true;
  provider: CalendarProvider | null;
};

type CalendarOAuthInitResponse = {
  success: true;
  provider: CalendarProvider;
  authUrl: string;
};

export async function getCalendarProvider(): Promise<CalendarProvider | null> {
  const response = await apiInstance.get<CalendarProviderResponse>('/calendar/sync/provider');
  return response.data.provider;
}

export async function syncCalendar(provider: CalendarProvider): Promise<void> {
  const providerPath = provider === 'GOOGLE' ? 'google' : 'microsoft';
  await apiInstance.post(`/calendar/sync/${providerPath}`);
}

/** Disconnects the calendar: stops the watch and clears stored OAuth credentials
 * so a subsequent connect goes through Google's/Microsoft's consent screen again
 * (needed to pick up newly-added scopes like calendar.events). */
export async function disconnectCalendar(provider: CalendarProvider): Promise<void> {
  const providerPath = provider === 'GOOGLE' ? 'google' : 'microsoft';
  await apiInstance.delete(`/calendar/watch/${providerPath}`);
}

export async function initCalendarOAuth(
  platform: CalendarOAuthPlatform = 'web',
): Promise<CalendarOAuthInitResponse> {
  const response = await apiInstance.post<CalendarOAuthInitResponse>('/calendar/oauth/init', {
    platform,
  });
  return response.data;
}
