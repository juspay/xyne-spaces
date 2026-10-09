jest.mock('@xyne/shared', () => ({
  GuestEntity: { CHANNEL: 'CHANNEL', CANVAS: 'CANVAS' },
  CanvasVisibility: { PUBLIC: 'PUBLIC', PRIVATE: 'PRIVATE' },
  ChannelVisibility: { PUBLIC: 'PUBLIC', PRIVATE: 'PRIVATE' },
}));

import type { PrismaClient } from '@prisma/client';
import type { ACLContext } from '../base-acl';
import {
  PollQuestionResultsACL,
  PollReminderDeliveriesACL,
  PollVotesACL,
} from './polls-acl';

const context: ACLContext = {
  userId: 'user-1',
  workspaceId: 'workspace-1',
  role: 'MEMBER',
};

const prisma = {} as PrismaClient;

describe('poll query ACLs', () => {
  it('limits raw ballots to the voter or the creator of a non-anonymous poll', async () => {
    const where = await new PollVotesACL(context, prisma).getWhereClause();

    expect(where).toMatchObject({
      workspaceId: context.workspaceId,
      AND: [
        { poll: { message: { conversation: { channel: { workspaceId: context.workspaceId } } } } },
        {
          OR: [
            { userId: context.userId },
            { poll: { createdBy: context.userId, isAnonymous: false } },
          ],
        },
      ],
    });
  });

  it('gates aggregate rows by stable visibility and channel administration', async () => {
    const where = await new PollQuestionResultsACL(context, prisma).getWhereClause();

    expect(where).toMatchObject({
      workspaceId: context.workspaceId,
      poll: {
        AND: expect.arrayContaining([
          expect.objectContaining({
            message: {
              conversation: {
                channel: expect.objectContaining({ workspaceId: context.workspaceId }),
              },
            },
          }),
          {
            OR: [
              { createdBy: context.userId },
              { resultVisibility: 'EVERYONE' },
              { resultVisibility: 'AFTER_CLOSE', closedAt: { not: null } },
              {
                resultVisibility: 'ADMIN_ONLY',
                message: {
                  conversation: {
                    channel: {
                      OR: [
                        { createdBy: context.userId },
                        { participants: { some: { userId: context.userId, role: 'ADMIN' } } },
                      ],
                    },
                  },
                },
              },
            ],
          },
        ]),
      },
    });
    expect(where).not.toHaveProperty('userId');
  });

  it('denies request-principal access to the server-only reminder ledger', async () => {
    const acl = new PollReminderDeliveriesACL(context, prisma);

    await expect(acl.getWhereClause()).resolves.toEqual({ id: { in: [] } });
    await expect(acl.getMutateWhere()).resolves.toEqual({ id: { in: [] } });
    await expect(acl.canCreate()).resolves.toBe(false);
  });
});
