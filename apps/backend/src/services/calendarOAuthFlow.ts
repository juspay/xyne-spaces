import { AuthProvider, UserStatus } from '@prisma/client';
import type {
  CalendarOAuthProvider,
  CalendarOAuthState,
} from '@/services/calendarOAuthStateService';

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
  state: Pick<CalendarOAuthState, 'workspaceId' | 'platform'>,
  params: Record<string, string>
): string {
  const callsPath = getCallsPath(state.workspaceId, params);
  return state.platform === 'electron'
    ? `${frontendUrl}/launch?path=${encodeURIComponent(callsPath)}`
    : `${frontendUrl}${callsPath}`;
}
