import type { Prisma } from '@prisma/client';
import { repositories } from '@/database/repositories';
import { DatabaseClient } from '@/database/client';
import type { GoogleCalendarPushState } from '@/database/repositories/callRepository';
import { asSystem, asService, rawQuery } from './base';

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

/**
 * Relocated from callCalendarPushService.ts's syncCallToGoogleCalendar. Background push job →
 * no request context, actor is the call's creator since the calendar event is pushed on their
 * behalf.
 */
export function syncCallToGoogleCalendarAsCreator<T>(
  createdByUserId: string,
  workspaceId: string,
  fn: () => Promise<T>,
): Promise<T> {
  return asService(
    ['Call'],
    'calendar push job: background job has no request context, pushed on behalf of the call\'s creator',
    createdByUserId,
    workspaceId,
    fn,
  );
}

/**
 * Relocated from controllers/meetCallbackController.ts. SAM webhook → no HTTP tenant context;
 * opens one from the resolved workspace so the call-summary system message insert gets
 * workspaceId stamped instead of leaking NULL.
 */
export function insertMeetCallbackSummaryMessage<T>(workspaceId: string, fn: () => Promise<T>): Promise<T> {
  return asService(
    ['Message'],
    'meet callback: SAM webhook has no HTTP tenant context, scope opened from the resolved workspace',
    'meet-callback',
    workspaceId,
    fn,
  );
}

/**
 * Relocated from queues/callCalendarPushQueue.ts's sync-call processor: the job carries only a
 * callId, same as findCallForCalendarPush above — resolved cross-workspace before anything else.
 */
export function findCallCalendarPushRevision(callId: string): Promise<Date | null> {
  return asSystem(
    ['Call'],
    'calendar push queue job carries only a callId, resolved cross-workspace like the sync itself',
    () => repositories.calls.findCalendarPushRevision(callId),
  );
}

/**
 * Relocated from callRepository's setGoogleCalendarPushState. A jsonb merge rather than a
 * read-modify-write, because other flows write unrelated metadata keys and a push job that
 * round-tripped the whole object would silently drop whichever of those landed in between.
 */
export async function setCallGoogleCalendarPushState(callId: string, state: GoogleCalendarPushState): Promise<number> {
  return rawQuery(
    ['Call'],
    'call calendar push: merge one key into calls.metadata so an unrelated concurrent write is not round-tripped away',
    () => DatabaseClient.getInstance().$executeRaw`
      UPDATE "calls"
      SET "metadata" = COALESCE("metadata", '{}'::jsonb) || ${JSON.stringify({ googleCalendarPush: state })}::jsonb
      WHERE "id" = ${callId}
    `,
  );
}

/** Relocated from callRepository's setGoogleCalendarPushState (the clearing branch). */
export async function clearCallGoogleCalendarPushState(callId: string): Promise<number> {
  return rawQuery(
    ['Call'],
    'call calendar push: drop one key from calls.metadata without round-tripping the whole object',
    () => DatabaseClient.getInstance().$executeRaw`
        UPDATE "calls"
        SET "metadata" = COALESCE("metadata", '{}'::jsonb) - 'googleCalendarPush'
        WHERE "id" = ${callId}
      `,
  );
}

/**
 * Relocated from callRepository's appendMarkedItem: appends to calls.markedItems with `||` so
 * two concurrent appends cannot overwrite each other. Statement unchanged.
 */
export async function appendCallMarkedItem(externalId: string, item: Prisma.InputJsonValue): Promise<number> {
  return rawQuery(
    ['Call'],
    'call marked items: jsonb append so concurrent appends do not overwrite each other',
    () => DatabaseClient.getInstance().$executeRaw`
      UPDATE "calls"
      SET "markedItems" = "markedItems" || ${JSON.stringify(item)}::jsonb
      WHERE "externalId" = ${externalId}
    `,
  );
}
