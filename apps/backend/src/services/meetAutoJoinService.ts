import { CallStatus } from '@xyne/shared';
import {
  findMeetAutoJoinUsers,
  findRecentMeetNotetakerCalls,
  findUpcomingCalendarMeetCalls,
  type CalendarMeetCall,
  type RecentMeetNotetakerCall,
} from '@/bypassAcl/meetNotetakerServices';
import { asService } from '@/bypassAcl/base';
import { extractMeetLinks } from '@/services/meetLinkService';
import { meetBotOf, meetNotetakerService } from '@/services/meetNotetakerService';
import { logger } from '@/utils/logger';

/**
 * Xyne Automatic joins people's Google Meet calendar events by itself.
 *
 * Users opt in (UserPreference.meetAutoJoin): 'organized' for meetings they organize,
 * 'all' for every meeting they haven't declined. Calendar sync already stores each
 * event as a GOOGLE_CALENDAR Call per attendee with its Meet link in roomLink; once a
 * minute the worker sends the bot to the ones starting now, through the same path as
 * "Send Xyne Automatic" (meetNotetakerService.sendToMeeting). External meetings are
 * included: there the host admits the bot from the lobby.
 */

export type MeetAutoJoinMode = 'organized' | 'all';
export const MEET_AUTO_JOIN_MODES: readonly MeetAutoJoinMode[] = ['organized', 'all'];

/** Send the bot this long before the start, so it is in the lobby when people arrive. */
export const MEET_AUTO_JOIN_LEAD_MS = 60_000;
/** Keep trying this long after the start (worker down, bots busy). */
export const MEET_AUTO_JOIN_LATE_MS = 5 * 60_000;
/** Longer events (all-day, multi-day blocks with a Meet link) are not meetings to join. */
const MAX_MEETING_MS = 12 * 60 * 60_000;
/** Notetaker calls created this long before the start count as this occurrence's bot. */
const RECENT_WINDOW_MS = 30 * 60_000;
/** Dispatch failures that a later minute can retry: no bot ever went into the meeting. */
const RETRYABLE_REASONS = new Set(['bot_busy', 'bot_unreachable']);

interface CalendarEventMetadata {
  organizer?: { self?: boolean } | null;
  attendees?: { self?: boolean; responseStatus?: string }[];
}

export function isMeetAutoJoinMode(value: unknown): value is MeetAutoJoinMode {
  return typeof value === 'string' && (MEET_AUTO_JOIN_MODES as readonly string[]).includes(value);
}

/** Whether this user's copy of a calendar event is one the bot should join for them. */
export function shouldAutoJoin(call: CalendarMeetCall, mode: MeetAutoJoinMode, now: Date): boolean {
  if (!call.roomLink || !extractMeetLinks(call.roomLink)[0]) return false;
  if (call.endsAt && call.endsAt <= now) return false;
  if (call.startsAt && call.endsAt && call.endsAt.getTime() - call.startsAt.getTime() > MAX_MEETING_MS) return false;

  const metadata = (call.metadata ?? {}) as CalendarEventMetadata;
  // Attendees other than the organizer; none means a block on one person's calendar.
  const attendees = Array.isArray(metadata.attendees) ? metadata.attendees : [];
  if (attendees.length === 0) return false;
  const organizes = metadata.organizer?.self === true;
  if (mode === 'organized' && !organizes) return false;
  const self = attendees.find((attendee) => attendee.self);
  return self?.responseStatus !== 'declined';
}

export type AutoJoinDecision = 'send' | 'skip';

/**
 * Given the workspace's notetaker calls for this Meet around this occurrence: skip
 * when the user already has one, or when the bot already came and left (don't send it
 * back); otherwise send (sendToMeeting adds the user to a colleague's live bot).
 */
export function autoJoinDecision(recent: RecentMeetNotetakerCall[], userId: string): AutoJoinDecision {
  const real = recent.filter((call) => !RETRYABLE_REASONS.has(meetBotOf(call)?.reason ?? ''));
  const includesUser = (call: RecentMeetNotetakerCall) =>
    call.createdByUserId === userId || call.participants.some((participant) => participant.userId === userId);
  if (real.some(includesUser)) return 'skip';
  const inFlight = (call: RecentMeetNotetakerCall) =>
    call.status === CallStatus.SCHEDULED || call.status === CallStatus.ACTIVE;
  if (real.length > 0 && !real.some(inFlight)) return 'skip';
  return 'send';
}

class MeetAutoJoinService {
  /** One pass: sends the bot to every opted-in meeting starting about now. */
  async runOnce(now = new Date()): Promise<{ sent: number; waiting: number }> {
    const result = { sent: 0, waiting: 0 };
    if (!meetNotetakerService.enabled) return result;

    const modes = new Map<string, MeetAutoJoinMode>();
    for (const { userId, meetAutoJoin } of await findMeetAutoJoinUsers()) {
      if (isMeetAutoJoinMode(meetAutoJoin)) modes.set(userId, meetAutoJoin);
    }
    if (modes.size === 0) return result;

    const calls = await findUpcomingCalendarMeetCalls(
      [...modes.keys()],
      new Date(now.getTime() - MEET_AUTO_JOIN_LATE_MS),
      new Date(now.getTime() + MEET_AUTO_JOIN_LEAD_MS),
    );
    calls.sort((a, b) => (a.startsAt?.getTime() ?? 0) - (b.startsAt?.getTime() ?? 0));

    for (const call of calls) {
      const mode = modes.get(call.createdByUserId);
      if (!mode || !shouldAutoJoin(call, mode, now)) continue;
      try {
        const outcome = await this.joinForUser(call, now);
        if (outcome === 'sent') result.sent += 1;
        if (outcome === 'waiting') result.waiting += 1;
      } catch (error) {
        logger.warn('[MEET-AUTO-JOIN] send failed', {
          calendarCallId: call.id,
          userId: call.createdByUserId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return result;
  }

  private async joinForUser(call: CalendarMeetCall, now: Date): Promise<'sent' | 'skipped' | 'waiting'> {
    const meet = extractMeetLinks(call.roomLink ?? '')[0];
    if (!meet) return 'skipped';
    const startsAt = call.startsAt ?? now;
    const since = new Date(Math.min(startsAt.getTime(), now.getTime()) - RECENT_WINDOW_MS);
    const recent = await findRecentMeetNotetakerCalls(call.workspaceId, meet.meetUrl, since);
    if (autoJoinDecision(recent, call.createdByUserId) === 'skip') return 'skipped';

    // A new bot needs a free slot; joining a colleague's live bot does not.
    const botAlreadyThere = recent.some(
      (existing) => existing.status === CallStatus.SCHEDULED || existing.status === CallStatus.ACTIVE,
    );
    if (!botAlreadyThere && !(await meetNotetakerService.hasCapacity())) {
      logger.info('[MEET-AUTO-JOIN] bots busy, retrying next minute', { calendarCallId: call.id });
      return 'waiting';
    }

    const { call: botCall, alreadySentBy } = await asService(
      ['Call', 'CallParticipant'],
      'meet auto-join: the worker sends the bot on behalf of the user who opted in, in their workspace',
      call.createdByUserId,
      call.workspaceId,
      () =>
        meetNotetakerService.sendToMeeting({
          userId: call.createdByUserId,
          workspaceId: call.workspaceId,
          meetingUrl: meet.meetUrl,
          title: call.title,
          metadata: { autoJoin: { calendarCallId: call.id, calendarExternalId: call.externalId } },
        }),
    );
    logger.info('[MEET-AUTO-JOIN] sent', {
      calendarCallId: call.id,
      botCallId: botCall.externalId,
      userId: call.createdByUserId,
      joinedColleagueBot: !!alreadySentBy,
    });
    return 'sent';
  }
}

export const meetAutoJoinService = new MeetAutoJoinService();
