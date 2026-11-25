import type { Call } from '@prisma/client';
import { CallOrigin, CallStatus } from '@xyne/shared';
import { db } from '@/database/client';
import { getCalendarSourceType } from '@/database/repositories/externalSourceRepository';
import { asService, asSystem } from './base';

/**
 * Database access for the Google Meet transcript worker (services/meetTranscriptService.ts),
 * which runs in the worker process with no user session.
 */

export type MeetTranscriptCall = Pick<
  Call,
  'id' | 'externalId' | 'workspaceId' | 'createdByUserId' | 'title' | 'roomLink' | 'startsAt' | 'endsAt' | 'metadata' | 'transcript'
>;

const CALL_FIELDS = {
  id: true,
  externalId: true,
  workspaceId: true,
  createdByUserId: true,
  title: true,
  roomLink: true,
  startsAt: true,
  endsAt: true,
  metadata: true,
  transcript: true,
} as const;

const GOOGLE_MEET_CALENDAR_EVENT = {
  callOrigin: CallOrigin.GOOGLE_CALENDAR,
  status: CallStatus.SCHEDULED,
  roomLink: { contains: 'meet.google.com/' },
} as const;

/** Synced Google Calendar events with a Meet link that start between `from` and `to`. */
export function findCalendarMeetCallsStarting(from: Date, to: Date): Promise<MeetTranscriptCall[]> {
  return asSystem(
    ['Call'],
    'meet transcript worker has no user context; reads synced Google Calendar events about to start',
    async () =>
      await db.call.findMany({
        where: { ...GOOGLE_MEET_CALENDAR_EVENT, startsAt: { gte: from, lte: to } },
        select: CALL_FIELDS,
      }),
  );
}

/** Synced Google Calendar events with a Meet link that ended between `from` and `to` and have no transcript yet. */
export function findCalendarMeetCallsEnded(from: Date, to: Date): Promise<MeetTranscriptCall[]> {
  return asSystem(
    ['Call'],
    'meet transcript worker has no user context; reads synced Google Calendar events that just ended',
    async () =>
      await db.call.findMany({
        where: { ...GOOGLE_MEET_CALENDAR_EVENT, endsAt: { gte: from, lte: to }, transcript: null },
        select: CALL_FIELDS,
      }),
  );
}

/** Synced Google Calendar events with a Meet link that may be running between `from` and `to`. */
export function findCalendarMeetCallsLive(from: Date, to: Date): Promise<MeetTranscriptCall[]> {
  return asSystem(
    ['Call'],
    'meet transcript worker has no user context; reads synced Google Calendar events that may be in progress',
    async () =>
      await db.call.findMany({
        where: { ...GOOGLE_MEET_CALENDAR_EVENT, startsAt: { lte: to }, endsAt: { gte: from }, transcript: null },
        select: CALL_FIELDS,
      }),
  );
}

/** Which of these users turned "Google Meet transcripts" on. */
export async function findMeetTranscriptUserIds(userIds: string[]): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const rows = await asSystem(
    ['UserPreference'],
    'meet transcript worker has no user context; reads which meeting organisers opted in',
    async () =>
      await db.userPreference.findMany({
        where: { userId: { in: userIds }, meetTranscripts: true },
        select: { userId: true },
      }),
  );
  return new Set(rows.map((row) => row.userId));
}

/** The full call row, for the transcript pipeline. */
export function findMeetTranscriptCall(id: string): Promise<Call | null> {
  return asSystem(
    ['Call'],
    'meet transcript worker has no user context; loads the calendar call a transcript was fetched for',
    async () => await db.call.findUnique({ where: { id } }),
  );
}

/** Runs the transcript pipeline for a call on behalf of the user who owns it. */
export function asMeetTranscriptOwner<T>(
  call: Pick<Call, 'id' | 'createdByUserId' | 'workspaceId'>,
  fn: () => Promise<T>,
): Promise<T> {
  if (!call.workspaceId) throw new Error(`Call ${call.id} has no workspace`);
  return asService(
    ['Call'],
    "meet transcript worker has no HTTP tenant context; saves the organiser's own meeting transcript on their call",
    call.createdByUserId,
    call.workspaceId,
    fn,
  );
}

/** The user's Google Calendar connection (its id), or null when they have none active. */
export async function findGoogleCalendarSourceId(userId: string): Promise<string | null> {
  const source = await asSystem(
    ['ExternalSource'],
    "meet transcript worker has no user context; uses the organiser's own Google Calendar connection",
    async () =>
      await db.externalSource.findFirst({
        where: { sourceType: getCalendarSourceType('GOOGLE'), ownerUserId: userId },
        orderBy: { updatedAt: 'desc' },
        select: { id: true, isActive: true },
      }),
  );
  return source?.isActive ? source.id : null;
}
