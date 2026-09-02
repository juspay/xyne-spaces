import {
  markChannelActivitiesRead,
  markThreadActivitiesRead,
} from './activityReadStateService';

const executeRaw = jest.fn();
const client = { $executeRaw: executeRaw };

function renderedSql(call: unknown[]): string {
  const [strings] = call as [TemplateStringsArray, ...unknown[]];
  return strings.join('?').replace(/\s+/g, ' ').trim();
}

describe('activity read-state updates', () => {
  beforeEach(() => {
    executeRaw.mockReset();
    executeRaw.mockResolvedValue(1);
  });

  it('marks channel activities read without updating their event timestamp', async () => {
    await markChannelActivitiesRead(client, 'user-1', 'channel-1');

    const call = executeRaw.mock.calls[0];
    expect(renderedSql(call)).toBe(
      'UPDATE "activities" SET "isRead" = true WHERE "userId" = ? AND "channelId" = ? AND "isRead" = false',
    );
    expect(call.slice(1)).toEqual(['user-1', 'channel-1']);
    expect(renderedSql(call)).not.toContain('updatedAt');
  });

  it('marks thread activities read without updating their event timestamp', async () => {
    await markThreadActivitiesRead(client, 'user-1', 'conversation-1');

    const call = executeRaw.mock.calls[0];
    expect(renderedSql(call)).toBe(
      'UPDATE "activities" SET "isRead" = true WHERE "userId" = ? AND "conversationId" = ? AND "isRead" = false',
    );
    expect(call.slice(1)).toEqual(['user-1', 'conversation-1']);
    expect(renderedSql(call)).not.toContain('updatedAt');
  });
});
