import { expect, it, jest } from '@jest/globals';
import { createTicket } from '@/src/services/ticketService';
import { apiPost } from '@/src/services/apiClient';
jest.mock('@/src/services/apiClient', () => ({ apiPost: jest.fn() }));
jest.mock('@xyne/shared', () => ({}));
it('preserves the source message, source thread, board workflow and dynamic values', async () => {
  jest.mocked(apiPost).mockResolvedValue({ id: 'ticket', conversationId: 'thread' });
  const payload = {
    title: 'Bug',
    description: 'Details',
    boardId: 'board',
    channelId: 'channel',
    createdBy: 'user',
    updatedBy: 'user',
    sourceConversationId: 'thread',
    sourceMessageId: 'message',
    projectId: 'project',
    statusV2: 'TODO',
    stageName: 'Triage',
    ticketType: 'Fix',
    tags: ['bug'],
    dynamicFields: { Severity: 'High', Areas: ['Mobile'] },
  };
  await expect(createTicket(payload)).resolves.toEqual({ id: 'ticket', conversationId: 'thread' });
  expect(apiPost).toHaveBeenCalledWith('/tickets', payload);
});
it('surfaces creation errors so the form can retain its draft', async () => {
  jest.mocked(apiPost).mockRejectedValue(new Error('Required field missing'));
  await expect(
    createTicket({
      title: 'Bug',
      description: 'Details',
      boardId: 'b',
      channelId: 'c',
      createdBy: 'u',
      updatedBy: 'u',
    }),
  ).rejects.toThrow('Required field missing');
});
