import { describe, expect, it, jest, beforeEach, afterEach } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('@/src/features/feed/api', () => ({
  feedRequest: jest.fn(),
  feedError: (error: Error) => error.message,
}));
jest.mock('@/src/features/feed/FeedMedia', () => ({ FeedMediaStrip: () => null }));
jest.mock('uniwind', () => ({ useCSSVariable: () => '#111111' }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'View' }));

import { Composer } from '@/src/features/feed/FeedComposer';
import { feedRequest } from '@/src/features/feed/api';
const request = jest.mocked(
  feedRequest as (
    workspaceId: string,
    path: string,
    options?: import('@/src/services/MtlsApiService').MtlsRequestOptions,
  ) => Promise<unknown>,
);
const message = {
  id: 'message1',
  revision: 'server-revision',
  author: { id: 'alice', name: 'Alice' },
  text: 'A private conversation',
  createdAt: '2026-10-14T10:00:00Z',
  media: [{ id: 'image1', filename: 'photo.jpg', mimetype: 'image/jpeg', size: 100 }],
};
const clients: QueryClient[] = [];
afterEach(() => {
  for (const client of clients) client.clear();
  clients.length = 0;
});
function mount(conversation = false): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <Composer
        workspaceId='workspace1'
        workspaceName='Design'
        {...(conversation
          ? { conversationId: 'conversation1', selectedMessageId: 'message1' }
          : {})}
        onClose={jest.fn()}
        onPublished={jest.fn()}
      />
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  request.mockReset();
});
describe('Feed publication', () => {
  it('requires explicit audience acknowledgement before a text post', async () => {
    request.mockResolvedValue({ id: 'post1' });
    mount();
    fireEvent.changeText(screen.getByLabelText('Post commentary'), 'Hello workspace');
    fireEvent.press(screen.getByText('Publish post'));
    expect(request).not.toHaveBeenCalled();
    fireEvent.press(screen.getByRole('checkbox'));
    fireEvent.press(screen.getByText('Publish post'));
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        'workspace1',
        '/posts',
        expect.objectContaining({
          method: 'POST',
          body: expect.objectContaining({
            body: 'Hello workspace',
            confirmWorkspacePublication: true,
          }),
        }),
      ),
    );
  });
  it('publishes only selected IDs and server revisions, with media in the preview', async () => {
    request.mockImplementation(async (_workspace, path) =>
      path.startsWith('/source/')
        ? { workspaceName: 'Design', privateSource: true, messages: [message], nextCursor: null }
        : { id: 'post1' },
    );
    mount(true);
    await screen.findByText('1 attachments');
    fireEvent.press(screen.getByText('Preview 1 messages'));
    expect(screen.getByText(/including people who cannot access/)).toBeTruthy();
    fireEvent.press(screen.getByRole('checkbox'));
    fireEvent.press(screen.getByText('Publish post'));
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        'workspace1',
        '/posts',
        expect.objectContaining({
          body: expect.objectContaining({
            messageIds: ['message1'],
            revisions: { message1: 'server-revision' },
          }),
        }),
      ),
    );
  });
  it('keeps a failed draft and reuses its request ID for retry', async () => {
    request
      .mockRejectedValueOnce(new Error('Connection lost'))
      .mockResolvedValueOnce({ id: 'post1' });
    mount();
    fireEvent.changeText(screen.getByLabelText('Post commentary'), 'Keep this draft');
    fireEvent.press(screen.getByRole('checkbox'));
    fireEvent.press(screen.getByText('Publish post'));
    await screen.findByText('Connection lost');
    expect(screen.getByLabelText('Post commentary').props['value']).toBe('Keep this draft');
    fireEvent.press(screen.getByText('Publish post'));
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    expect(request.mock.calls[1]?.[2]?.body).toEqual(request.mock.calls[0]?.[2]?.body);
  });
});
