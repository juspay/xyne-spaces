import { repositories } from '@/database/repositories';
import { asSystem } from './base';

/**
 * Relocated from callCalendarPushService.ts's syncCallToGoogleCalendar: the job carries only a
 * call id, so the row's own workspaceId is read cross-workspace first — nothing to scope by
 * until this returns.
 */
export function findCallForCalendarPush(
  callId: string,
): ReturnType<typeof repositories.calls.findForCalendarPush> {
  return asSystem(
    ['Call'],
    'calendar push job carries only a call id — workspaceId is read cross-workspace, then everything after runs inside it',
    () => repositories.calls.findForCalendarPush(callId),
  );
}
