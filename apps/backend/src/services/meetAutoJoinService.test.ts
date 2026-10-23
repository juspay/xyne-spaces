jest.mock('@/utils/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), debug: jest.fn(), warn: jest.fn() },
}));
// @xyne/shared ships ESM that jest's transform ignores — stub the imports used.
jest.mock('@xyne/shared', () => ({
  CallStatus: { SCHEDULED: 'SCHEDULED', ACTIVE: 'ACTIVE', ENDED: 'ENDED' },
}));
jest.mock('@/bypassAcl/meetNotetakerServices', () => ({
  findMeetAutoJoinUsers: jest.fn(),
  findUpcomingCalendarMeetCalls: jest.fn(),
  findRecentMeetNotetakerCalls: jest.fn(),
}));
jest.mock('@/bypassAcl/base', () => ({
  asService: jest.fn((_tables: unknown, _reason: unknown, _user: unknown, _ws: unknown, fn: () => unknown) => fn()),
}));
const notetaker = { enabled: true, hasCapacity: jest.fn(), sendToMeeting: jest.fn() };
jest.mock('@/services/meetNotetakerService', () => ({
  meetNotetakerService: notetaker,
  meetBotOf: (call: { metadata?: { meetBot?: unknown } }) => call.metadata?.meetBot ?? null,
}));
jest.mock('@/services/meetLinkService', () => ({
  extractMeetLinks: (text: string) => {
    const match = text.match(/meet\.google\.com\/([a-z]+-[a-z]+-[a-z]+)/i);
    return match ? [{ meetCode: match[1].toLowerCase(), meetUrl: `https://meet.google.com/${match[1].toLowerCase()}` }] : [];
  },
}));

import {
  findMeetAutoJoinUsers,
  findRecentMeetNotetakerCalls,
  findUpcomingCalendarMeetCalls,
  type CalendarMeetCall,
  type RecentMeetNotetakerCall,
} from '@/bypassAcl/meetNotetakerServices';
import { autoJoinDecision, meetAutoJoinService, shouldAutoJoin } from './meetAutoJoinService';

const NOW = new Date('2026-10-23T10:00:00Z');
const MEET = 'https://meet.google.com/abc-defg-hij';

function calendarCall(overrides: Partial<CalendarMeetCall> = {}, metadata: Record<string, unknown> = {}): CalendarMeetCall {
  return {
    id: 'cal-1',
    externalId: 'gcal__u1__evt1',
    workspaceId: 'ws-1',
    createdByUserId: 'u1',
    title: 'Weekly sync',
    roomLink: MEET,
    startsAt: new Date('2026-10-23T10:00:30Z'),
    endsAt: new Date('2026-10-23T10:30:00Z'),
    metadata: {
      organizer: { email: 'u1@juspay.in', self: true },
      attendees: [{ email: 'u2@juspay.in', responseStatus: 'accepted' }],
      ...metadata,
    },
    ...overrides,
  };
}

function botCall(overrides: Partial<RecentMeetNotetakerCall> = {}): RecentMeetNotetakerCall {
  return { id: 'bot-1', status: 'ACTIVE', createdByUserId: 'u2', metadata: {}, participants: [], ...overrides } as RecentMeetNotetakerCall;
}

const attendeeOnly = { organizer: { email: 'boss@juspay.in' }, attendees: [{ email: 'u1@juspay.in', self: true, responseStatus: 'accepted' }] };

describe('shouldAutoJoin', () => {
  it('joins meetings the user organizes, in both modes', () => {
    expect(shouldAutoJoin(calendarCall(), 'organized', NOW)).toBe(true);
    expect(shouldAutoJoin(calendarCall(), 'all', NOW)).toBe(true);
  });

  it("joins someone else's meeting only in 'all' mode", () => {
    const call = calendarCall({}, attendeeOnly);
    expect(shouldAutoJoin(call, 'organized', NOW)).toBe(false);
    expect(shouldAutoJoin(call, 'all', NOW)).toBe(true);
  });

  it('includes external meetings and invitations not answered yet', () => {
    const call = calendarCall({}, {
      organizer: { email: 'someone@other-company.com' },
      attendees: [{ email: 'u1@juspay.in', self: true, responseStatus: 'needsAction' }],
    });
    expect(shouldAutoJoin(call, 'all', NOW)).toBe(true);
  });

  it('skips declined meetings', () => {
    const call = calendarCall({}, { ...attendeeOnly, attendees: [{ self: true, responseStatus: 'declined' }] });
    expect(shouldAutoJoin(call, 'all', NOW)).toBe(false);
  });

  it('skips events with nobody else, finished events, all-day events and non-Meet links', () => {
    expect(shouldAutoJoin(calendarCall({}, { attendees: [] }), 'all', NOW)).toBe(false);
    expect(shouldAutoJoin(calendarCall({ endsAt: new Date('2026-10-23T09:59:00Z') }), 'all', NOW)).toBe(false);
    expect(
      shouldAutoJoin(
        calendarCall({ startsAt: new Date('2026-10-23T00:00:00Z'), endsAt: new Date('2026-10-24T00:00:00Z') }),
        'all',
        NOW,
      ),
    ).toBe(false);
    expect(shouldAutoJoin(calendarCall({ roomLink: 'https://zoom.us/j/123' }), 'all', NOW)).toBe(false);
  });
});

describe('autoJoinDecision', () => {
  it('sends when no bot has been to this occurrence', () => {
    expect(autoJoinDecision([], 'u1')).toBe('send');
  });

  it("joins a colleague's bot that is still in the meeting", () => {
    expect(autoJoinDecision([botCall({ status: 'ACTIVE' })], 'u1')).toBe('send');
    expect(autoJoinDecision([botCall({ status: 'SCHEDULED' })], 'u1')).toBe('send');
  });

  it('skips once the user has the bot, or after the bot has left', () => {
    expect(autoJoinDecision([botCall({ createdByUserId: 'u1' })], 'u1')).toBe('skip');
    expect(autoJoinDecision([botCall({ participants: [{ userId: 'u1' }] })], 'u1')).toBe('skip');
    expect(autoJoinDecision([botCall({ status: 'ENDED' })], 'u1')).toBe('skip');
  });

  it('retries when an earlier send never reached a bot', () => {
    const busy = botCall({ createdByUserId: 'u1', status: 'ENDED', metadata: { meetBot: { status: 'failed', reason: 'bot_busy' } } });
    expect(autoJoinDecision([busy], 'u1')).toBe('send');
  });
});

describe('meetAutoJoinService.runOnce', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    notetaker.enabled = true;
    notetaker.hasCapacity.mockResolvedValue(true);
    notetaker.sendToMeeting.mockResolvedValue({ call: { externalId: 'bot-call' }, alreadySentBy: null });
    (findMeetAutoJoinUsers as jest.Mock).mockResolvedValue([{ userId: 'u1', meetAutoJoin: 'all' }]);
    (findUpcomingCalendarMeetCalls as jest.Mock).mockResolvedValue([calendarCall()]);
    (findRecentMeetNotetakerCalls as jest.Mock).mockResolvedValue([]);
  });

  it("sends the bot as the user, titled after the event and linked to it", async () => {
    await expect(meetAutoJoinService.runOnce(NOW)).resolves.toEqual({ sent: 1, waiting: 0 });
    expect(findUpcomingCalendarMeetCalls).toHaveBeenCalledWith(
      ['u1'],
      new Date('2026-10-23T09:55:00Z'),
      new Date('2026-10-23T10:01:00Z'),
    );
    expect(notetaker.sendToMeeting).toHaveBeenCalledWith({
      userId: 'u1',
      workspaceId: 'ws-1',
      meetingUrl: MEET,
      title: 'Weekly sync',
      metadata: { autoJoin: { calendarCallId: 'cal-1', calendarExternalId: 'gcal__u1__evt1' } },
    });
  });

  it('waits for a free bot instead of sending into a full one', async () => {
    notetaker.hasCapacity.mockResolvedValue(false);
    await expect(meetAutoJoinService.runOnce(NOW)).resolves.toEqual({ sent: 0, waiting: 1 });
    expect(notetaker.sendToMeeting).not.toHaveBeenCalled();
  });

  it("adds the user to a colleague's live bot even when bots are full", async () => {
    notetaker.hasCapacity.mockResolvedValue(false);
    (findRecentMeetNotetakerCalls as jest.Mock).mockResolvedValue([botCall()]);
    await expect(meetAutoJoinService.runOnce(NOW)).resolves.toEqual({ sent: 1, waiting: 0 });
  });

  it('ignores users who turned it off or set an unknown mode, and does nothing when the bot is off', async () => {
    (findMeetAutoJoinUsers as jest.Mock).mockResolvedValue([{ userId: 'u1', meetAutoJoin: 'sometimes' }]);
    await meetAutoJoinService.runOnce(NOW);
    expect(findUpcomingCalendarMeetCalls).not.toHaveBeenCalled();

    notetaker.enabled = false;
    await meetAutoJoinService.runOnce(NOW);
    expect(findMeetAutoJoinUsers).toHaveBeenCalledTimes(1);
  });

  it('keeps going when one send fails', async () => {
    (findUpcomingCalendarMeetCalls as jest.Mock).mockResolvedValue([
      calendarCall(),
      calendarCall({ id: 'cal-2', roomLink: 'https://meet.google.com/xyz-abcd-efg' }),
    ]);
    notetaker.sendToMeeting.mockRejectedValueOnce(new Error('boom'));
    await expect(meetAutoJoinService.runOnce(NOW)).resolves.toEqual({ sent: 1, waiting: 0 });
    expect(notetaker.sendToMeeting).toHaveBeenCalledTimes(2);
  });
});
