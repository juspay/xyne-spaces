import { AxiosError, AxiosHeaders } from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  designShareQueryKey,
  designShareUrl,
  designShareViews,
  getDesignShare,
  publishDesignShare,
  publishShareErrorMessage,
  revokeDesignShare,
} from '../designShareService';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), delete: vi.fn() }));

vi.mock('../../clients/apiClient', () => ({ apiInstance: api }));

function axiosError(status: number, data: unknown): AxiosError {
  const headers = new AxiosHeaders();
  return new AxiosError('Request failed', 'ERR_BAD_REQUEST', { headers }, undefined, {
    status,
    statusText: '',
    headers,
    config: { headers },
    data,
  });
}

describe('designShareService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reads, publishes and revokes through the backend proxy', async () => {
    api.get.mockResolvedValue({ data: { data: null } });
    api.post.mockResolvedValue({ data: { data: { id: 'share-1' } } });
    api.delete.mockResolvedValue({ data: { success: true } });

    await expect(getDesignShare('chat/1')).resolves.toBeNull();
    await expect(
      publishDesignShare({ attachmentId: 'att-1', conversationId: 'chat-1', title: 'Guide' }),
    ).resolves.toEqual({ id: 'share-1' });
    await revokeDesignShare('share-1');

    expect(api.get).toHaveBeenCalledWith('/xyne-ai/v2/design-shares/conversation/chat%2F1');
    expect(api.post).toHaveBeenCalledWith('/xyne-ai/v2/design-shares', {
      attachmentId: 'att-1',
      conversationId: 'chat-1',
      title: 'Guide',
    });
    expect(api.delete).toHaveBeenCalledWith('/xyne-ai/v2/design-shares/share-1');
  });

  it('builds the public link on the current origin and keeps the token in the fragment', () => {
    expect(designShareUrl('/claw/v3/design/shared#abc_123-x', 'https://spaces.example.com')).toBe(
      'https://spaces.example.com/claw/v3/design/shared#abc_123-x',
    );
  });

  it('counts views in words', () => {
    expect(designShareViews(0)).toBe('0 views');
    expect(designShareViews(1)).toBe('1 view');
    expect(designShareViews(12)).toBe('12 views');
  });

  it('explains a 404 on publish as an unsaved version', () => {
    expect(publishShareErrorMessage(axiosError(404, { error: 'not found' }), 'fallback')).toBe(
      'This version can’t be shared. Only designs saved in this chat can be.',
    );
  });

  it('passes other server messages through and falls back otherwise', () => {
    expect(
      publishShareErrorMessage(axiosError(503, { error: 'Failed to publish design' }), 'x'),
    ).toBe('Failed to publish design');
    expect(publishShareErrorMessage(axiosError(500, {}), 'Could not create the link')).toBe(
      'Could not create the link',
    );
    expect(publishShareErrorMessage(new Error('boom'), 'Could not create the link')).toBe(
      'Could not create the link',
    );
  });

  it('keys the cached link by conversation', () => {
    expect(designShareQueryKey('chat-1')).toEqual(['xyne-ai-design-share', 'chat-1']);
  });
});
