import type { Call, Prisma } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { CallOrigin, CallStatus, InvitationResponse } from '@xyne/shared';
import { db } from '@/database/client';
import { repositories } from '@/database/repositories';
import { asService, asSystem } from './base';

/**
 * Meet notetaker bot callback: the bot only knows the call's externalId and has no
 * user session, so the row (and its workspace) is read cross-workspace first.
 */
export function findMeetNotetakerCall(externalId: string): Promise<Call | null> {
  return asSystem(
    ['Call'],
    'meet notetaker bot callback carries only the call externalId — workspace is unknown until this returns',
    async () => await repositories.calls.findByExternalId(externalId),
  );
}

/**
 * Meet notetaker bot callback: updates the bot's call on behalf of the user who sent
 * the bot, inside that call's workspace.
 */
export function updateMeetNotetakerCallAsCreator(
  call: Pick<Call, 'id' | 'createdByUserId' | 'workspaceId'>,
  data: Prisma.CallUpdateInput,
): Promise<Call> {
  if (!call.workspaceId) throw new Error(`Call ${call.id} has no workspace`);
  return asService(
    ['Call'],
    'meet notetaker bot callback has no HTTP tenant context; acts for the user who sent the bot',
    call.createdByUserId,
    call.workspaceId,
    async () => await db.call.update({ where: { id: call.id }, data }),
  );
}

/**
 * The notetaker call already live for this Meet in the workspace, whoever sent it.
 * The requester usually can't see a colleague's call yet, so this reads past the
 * per-user call ACL, limited to the requester's own workspace.
 */
export function findInFlightMeetNotetakerCall(workspaceId: string, meetingUrl: string): Promise<Call | null> {
  return asSystem(
    ['Call'],
    "meet notetaker dedupe: one bot per Meet per workspace, so a colleague's in-flight bot call must be found before the requester can see it",
    async () =>
      await db.call.findFirst({
        where: {
          workspaceId,
          callOrigin: CallOrigin.MEET_LINK,
          roomLink: meetingUrl,
          status: { in: [CallStatus.SCHEDULED, CallStatus.ACTIVE] },
        },
        orderBy: { createdAt: 'desc' },
      }),
  );
}

/** Display name of whoever sent the bot, for "already added by …". */
export async function findMeetNotetakerSenderName(userId: string): Promise<string | null> {
  const user = await asSystem(
    ['User'],
    "meet notetaker dedupe: names the colleague who already sent the bot to this Meet",
    async () => await db.user.findUnique({ where: { id: userId }, select: { displayName: true, name: true, email: true } }),
  );
  return user?.displayName || user?.name || user?.email || null;
}

/**
 * Adds a user to a colleague's notetaker call (as an accepted participant), so they
 * see it in their Calls lists and can open its transcript and summary.
 */
export function addMeetNotetakerParticipant(
  call: Pick<Call, 'id' | 'createdByUserId' | 'workspaceId'>,
  userId: string,
): Promise<void> {
  const workspaceId = call.workspaceId;
  if (!workspaceId) throw new Error(`Call ${call.id} has no workspace`);
  return asService(
    ['CallParticipant'],
    "meet notetaker dedupe: a colleague asked for the same Meet's notes; added to the sender's call on the sender's behalf",
    call.createdByUserId,
    workspaceId,
    async () => {
      const existing = await db.callParticipant.findFirst({ where: { callId: call.id, userId } });
      if (existing) return;
      const now = new Date();
      await db.callParticipant.create({
        data: {
          id: uuidv4(),
          callId: call.id,
          userId,
          workspaceId,
          invitedBy: call.createdByUserId,
          invitedAt: now,
          response: InvitationResponse.ACCEPTED,
          respondedAt: now,
        },
      });
    },
  );
}

/** Users who asked Xyne Automatic to join their Google Meet calendar events. */
export function findMeetAutoJoinUsers(): Promise<{ userId: string; meetAutoJoin: string | null }[]> {
  return asSystem(
    ['UserPreference'],
    'meet auto-join scheduler runs in the worker with no user context; reads every workspace\'s opt-ins',
    async () =>
      await db.userPreference.findMany({
        where: { meetAutoJoin: { not: null } },
        select: { userId: true, meetAutoJoin: true },
      }),
  );
}

export type CalendarMeetCall = Pick<
  Call,
  'id' | 'externalId' | 'workspaceId' | 'createdByUserId' | 'title' | 'roomLink' | 'startsAt' | 'endsAt' | 'metadata'
>;

/** Hosts of the meeting links the bot joins (see parseMeetingLink in @xyne/shared). */
const MEETING_LINK_HOSTS = ['meet.google.com/', 'teams.microsoft.com/', 'teams.live.com/', 'teams.cloud.microsoft/'];

/**
 * These users' Google/Outlook calendar events with a Meet or Teams link starting
 * between `from` and `to` (one Call per user per occurrence, synced from their calendars).
 */
export function findUpcomingCalendarMeetCalls(userIds: string[], from: Date, to: Date): Promise<CalendarMeetCall[]> {
  return asSystem(
    ['Call'],
    'meet auto-join scheduler runs in the worker with no user context; reads opted-in users\' synced calendar events',
    async () =>
      await db.call.findMany({
        where: {
          callOrigin: { in: [CallOrigin.GOOGLE_CALENDAR, CallOrigin.MICROSOFT_CALENDAR] },
          status: CallStatus.SCHEDULED,
          startsAt: { gte: from, lte: to },
          createdByUserId: { in: userIds },
          OR: MEETING_LINK_HOSTS.map((host) => ({ roomLink: { contains: host } })),
        },
        select: {
          id: true,
          externalId: true,
          workspaceId: true,
          createdByUserId: true,
          title: true,
          roomLink: true,
          startsAt: true,
          endsAt: true,
          metadata: true,
        },
      }),
  );
}

export type RecentMeetNotetakerCall = Pick<Call, 'id' | 'status' | 'createdByUserId' | 'metadata'> & {
  participants: { userId: string }[];
};

/** Notetaker calls for this Meet in the workspace created since `since`, whoever sent them. */
export function findRecentMeetNotetakerCalls(
  workspaceId: string,
  meetingUrl: string,
  since: Date,
): Promise<RecentMeetNotetakerCall[]> {
  return asSystem(
    ['Call', 'CallParticipant'],
    'meet auto-join scheduler: a colleague may already have sent the bot to this Meet, before the user can see that call',
    async () =>
      await db.call.findMany({
        where: { workspaceId, callOrigin: CallOrigin.MEET_LINK, roomLink: meetingUrl, createdAt: { gte: since } },
        select: { id: true, status: true, createdByUserId: true, metadata: true, participants: { select: { userId: true } } },
      }),
  );
}
