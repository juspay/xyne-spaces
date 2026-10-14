jest.mock('@xyne/shared', () => ({
  GuestEntity: { CHANNEL: 'CHANNEL', CANVAS: 'CANVAS' },
  CanvasVisibility: { PUBLIC: 'PUBLIC', PRIVATE: 'PRIVATE' },
  ChannelVisibility: { PUBLIC: 'PUBLIC', PRIVATE: 'PRIVATE' },
}));

import type { PrismaClient } from '@prisma/client';
import type { ACLContext } from '../base-acl';
import { PollsACL } from './polls-acl';
import { PollVotesACL } from './poll-votes-acl';
import { PollQuestionResultsACL } from './poll-question-results-acl';

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

  it('limits writes to the principal: own ballots, own polls, no result rows', async () => {
    await expect(new PollVotesACL(context, prisma).getMutateWhere()).resolves.toEqual({
      workspaceId: context.workspaceId,
      userId: context.userId,
    });
    await expect(new PollsACL(context, prisma).getMutateWhere()).resolves.toEqual({
      workspaceId: context.workspaceId,
      createdBy: context.userId,
    });
    const results = new PollQuestionResultsACL(context, prisma);
    await expect(results.getMutateWhere()).resolves.toEqual({ questionId: { in: [] } });
    await expect(results.canCreate()).resolves.toBe(false);
  });

  it('only creates ballots for the principal in its workspace', async () => {
    const votes = new PollVotesACL(context, prisma);
    const ballot = {
      id: 'vote-1',
      workspaceId: context.workspaceId,
      pollId: 'poll-1',
      questionId: 'question-1',
      userId: context.userId,
      optionIds: [],
    };
    await expect(votes.canCreate(ballot)).resolves.toBe(true);
    await expect(votes.canCreate({ ...ballot, userId: 'someone-else' })).resolves.toBe(false);
  });
});
