import { AuthProvider, UserStatus } from '@xyne/shared';
import type {
  CalendarOAuthProvider,
  CalendarOAuthState,
} from '@/services/calendarOAuthStateService';
import { appendQueryToReturnPath } from '@/integrations/routes/urlHelpers';

type BoundCalendarUser = {
  id: string;
  email: string;
  workspaceId: string;
  authProvider: AuthProvider;
  status: UserStatus;
  leftAt: Date | null;
};

export function providerFromAuthProvider(provider: AuthProvider): CalendarOAuthProvider | null {
  if (provider === AuthProvider.GOOGLE) return 'GOOGLE';
  if (provider === AuthProvider.MICROSOFT) return 'MICROSOFT';
  return null;
}

export function normalizeCalendarOAuthEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isCalendarOAuthStateBoundToUser(
  state: CalendarOAuthState,
  user: BoundCalendarUser | null
): user is BoundCalendarUser {
  return !!(
    user &&
    user.id === state.ownerUserId &&
    user.status === UserStatus.ACTIVE &&
    user.leftAt === null &&
    user.workspaceId === state.workspaceId &&
    normalizeCalendarOAuthEmail(user.email) === normalizeCalendarOAuthEmail(state.expectedEmail) &&
    providerFromAuthProvider(user.authProvider) === state.provider
  );
}

function getCallsPath(workspaceId: string, params: Record<string, string>): string {
  const search = new URLSearchParams({ tab: 'upcoming', ...params });
  return `/${encodeURIComponent(workspaceId)}/calls?${search.toString()}`;
}

export function buildCalendarOAuthRedirect(
  frontendUrl: string,
  state: Pick<CalendarOAuthState, 'workspaceId' | 'platform' | 'returnPath'>,
  params: Record<string, string>
): string {
  if (state.returnPath) {
    const path = appendQueryToReturnPath(state.returnPath, new URLSearchParams(params));
    return state.platform === 'electron'
      ? `${frontendUrl}/launch?path=${encodeURIComponent(path)}`
      : `${frontendUrl}${path}`;
  }
  const callsPath = getCallsPath(state.workspaceId, params);
  return state.platform === 'electron'
    ? `${frontendUrl}/launch?path=${encodeURIComponent(callsPath)}`
    : `${frontendUrl}${callsPath}`;
}
