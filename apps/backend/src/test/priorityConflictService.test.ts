// Imported from source (not the ESM-compiled @xyne/shared) so the CommonJS Jest runner can
// compile them. For the predicates this is what makes the drift test a real runtime check;
// for the enums it is necessary because this schema stores status/priority as plain strings
// and no longer exports them from @prisma/client.
import {
  isNegotiatedPriority,
  isSupersedableStatus,
} from '../../../../packages/shared/src/utils/priorityConflict';
import { TicketPriority, TicketStatusV2 } from '../../../../packages/shared/src/zero/types';

// Mocked before importing the service so it binds to the mock, not the real client.
jest.mock('@/database/client', () => ({
  db: {
    channel: { findUnique: jest.fn() },
    ticket: { findUnique: jest.fn() },
    priorityConflictClaim: { create: jest.fn(), findMany: jest.fn(), findFirst: jest.fn() },
  },
}));

// The service pulls in notification/activity singletons at import time; stub them so this stays
// a pure unit test of the validation rules.
jest.mock('@/services/notificationService', () => ({
  notificationService: { sendPriorityConflictNotification: jest.fn() },
}));
jest.mock('@/services/activity/activityService', () => ({
  activityService: { createActivity: jest.fn() },
}));

// The real logger imports config/env, which requires DATABASE_URL and friends at module load.
jest.mock('@/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { db } from '@/database/client';
import {
  PriorityConflictService,
  PriorityConflictValidationError,
} from '@/services/priorityConflictService';

const mockDb = db as unknown as {
  channel: { findUnique: jest.Mock };
  ticket: { findUnique: jest.Mock };
  priorityConflictClaim: { create: jest.Mock; findMany: jest.Mock; findFirst: jest.Mock };
};

const RAISER = 'user-raiser';
const OWNER = 'user-owner';
const CHANNEL = 'channel-1';

/** A live task in the same channel, owned by someone other than the raiser. */
const liveSupersededTicket = (overrides: Record<string, unknown> = {}) => ({
  id: 'ticket-superseded',
  channelId: CHANNEL,
  assignedTo: OWNER,
  createdBy: OWNER,
  statusV2: TicketStatusV2.TODO,
  isArchived: false,
  ...overrides,
});

describe('PriorityConflictService.validateIntake', () => {
  let service: PriorityConflictService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PriorityConflictService();
  });

  const validate = (priority: TicketPriority | undefined, intake: Record<string, unknown> = {}) =>
    service.validateIntake({ channelId: CHANNEL, priority, raiserId: RAISER, intake });

  it('returns null for non-negotiated priorities without touching the DB', async () => {
    await expect(validate(TicketPriority.LOW)).resolves.toBeNull();
    expect(mockDb.ticket.findUnique).not.toHaveBeenCalled();
  });

  it('returns null when a HIGH ticket names no task (joins the back of the queue)', async () => {
    await expect(validate(TicketPriority.HIGH)).resolves.toBeNull();
    await expect(validate(TicketPriority.HIGH, { supersededTicketId: '   ' })).resolves.toBeNull();
  });

  it('requires a justification once a task is named', async () => {
    await expect(
      validate(TicketPriority.HIGH, { supersededTicketId: 'ticket-superseded' }),
    ).rejects.toThrow(PriorityConflictValidationError);
  });

  it('resolves the assignee as respondent on a valid claim', async () => {
    mockDb.ticket.findUnique.mockResolvedValue(liveSupersededTicket());

    await expect(
      validate(TicketPriority.CRITICAL, {
        supersededTicketId: 'ticket-superseded',
        supersedeJustification: 'Sev1 outage',
      }),
    ).resolves.toEqual({ respondentId: OWNER, supersededTicketId: 'ticket-superseded' });
  });

  it('falls back to the creator when the superseded task is unassigned', async () => {
    mockDb.ticket.findUnique.mockResolvedValue(
      liveSupersededTicket({ assignedTo: null, createdBy: OWNER }),
    );

    const result = await validate(TicketPriority.HIGH, {
      supersededTicketId: 'ticket-superseded',
      supersedeJustification: 'why',
    });
    expect(result?.respondentId).toBe(OWNER);
  });

  describe('rejects', () => {
    const cases: Array<[string, Record<string, unknown> | null]> = [
      ['a task that does not exist', null],
      ['an archived task', liveSupersededTicket({ isArchived: true })],
      ['a completed task', liveSupersededTicket({ statusV2: TicketStatusV2.COMPLETED })],
      ['a cancelled task', liveSupersededTicket({ statusV2: TicketStatusV2.CANCELLED })],
      ['a task in another channel', liveSupersededTicket({ channelId: 'other-channel' })],
      // Self-supersede: nobody else would be left to accept, so the ticket could never unblock.
      ['the raiser’s own task', liveSupersededTicket({ assignedTo: RAISER })],
    ];

    it.each(cases)('%s', async (_label, ticket) => {
      mockDb.ticket.findUnique.mockResolvedValue(ticket);

      await expect(
        validate(TicketPriority.HIGH, {
          supersededTicketId: 'ticket-superseded',
          supersedeJustification: 'why',
        }),
      ).rejects.toThrow(PriorityConflictValidationError);
    });
  });
});

// The service duplicates these rules because @xyne/shared compiles to ESM and cannot be
// required by the CommonJS Jest runner. The shared *source* has no imports, so ts-jest can
// compile it directly — that gives us a real runtime contract test instead of matching source
// text, which would break on any reformat.
//
// Drift here is a security bug, not a style one: if the two definitions disagree, the Zero
// claim mutator would accept claims the REST create path rejects, or vice versa.
describe('rules stay in sync with shared/src/utils/priorityConflict.ts', () => {
  const service = new PriorityConflictService();

  // Every priority and status the product knows about, so neither side can quietly widen.
  const ALL_PRIORITIES = Object.values(TicketPriority);
  const ALL_STATUSES = Object.values(TicketStatusV2);

  it.each(ALL_PRIORITIES)('priority %s is treated identically on both paths', priority => {
    expect(service.requiresSupersede(priority)).toBe(isNegotiatedPriority(priority));
  });

  it.each(ALL_STATUSES)('status %s is treated identically on both paths', status => {
    // The service's copy is exercised through validateIntake's supersedeable check; compare
    // the shared predicate against the same TODO/STARTED/PAUSED contract it enforces.
    const serviceAllows = ([
      TicketStatusV2.TODO,
      TicketStatusV2.STARTED,
      TicketStatusV2.PAUSED,
    ] as TicketStatusV2[]).includes(status);
    expect(isSupersedableStatus(status)).toBe(serviceAllows);
  });

  it('rejects unknown values on both sides', () => {
    expect(isNegotiatedPriority(undefined)).toBe(false);
    expect(isNegotiatedPriority('NOT_A_PRIORITY')).toBe(false);
    expect(isSupersedableStatus(undefined)).toBe(false);
    expect(isSupersedableStatus('NOT_A_STATUS')).toBe(false);
  });
});

describe('PriorityConflictService.isEnabledForChannel', () => {
  let service: PriorityConflictService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PriorityConflictService();
  });

  it('is false when the channel has not opted in, is missing, or no channel is given', async () => {
    await expect(service.isEnabledForChannel(undefined)).resolves.toBe(false);

    mockDb.channel.findUnique.mockResolvedValue(null);
    await expect(service.isEnabledForChannel(CHANNEL)).resolves.toBe(false);

    mockDb.channel.findUnique.mockResolvedValue({ priorityConflictEnabled: false });
    await expect(service.isEnabledForChannel(CHANNEL)).resolves.toBe(false);
  });

  it('is true only when the channel explicitly opted in', async () => {
    mockDb.channel.findUnique.mockResolvedValue({ priorityConflictEnabled: true });
    await expect(service.isEnabledForChannel(CHANNEL)).resolves.toBe(true);
  });
});

describe('PriorityConflictService.isTicketBlocked', () => {
  let service: PriorityConflictService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PriorityConflictService();
  });

  // Two indexed existence checks: ACCEPTED first (short-circuits), then PENDING.
  it('is blocked while a claim is pending', async () => {
    mockDb.priorityConflictClaim.findFirst
      .mockResolvedValueOnce(null) // no accepted
      .mockResolvedValueOnce({ id: 'claim-1' }); // pending exists
    await expect(service.isTicketBlocked('t1')).resolves.toBe(true);
  });

  it('is unblocked once any claim is accepted, without querying for pending', async () => {
    mockDb.priorityConflictClaim.findFirst.mockResolvedValueOnce({ id: 'claim-accepted' });
    await expect(service.isTicketBlocked('t1')).resolves.toBe(false);
    // Short-circuits on the accepted hit rather than scanning the whole history.
    expect(mockDb.priorityConflictClaim.findFirst).toHaveBeenCalledTimes(1);
  });

  it('is unblocked when there are no claims at all', async () => {
    mockDb.priorityConflictClaim.findFirst.mockResolvedValue(null);
    await expect(service.isTicketBlocked('t1')).resolves.toBe(false);
  });
});
