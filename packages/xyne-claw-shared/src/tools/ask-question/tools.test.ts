import { describe, it, expect, vi } from 'vitest';
import { askUserQuestion } from './tools.js';

describe('askUserQuestion', () => {
  it('resolves XYNE_CLAW_AUTH_URL from context config and posts to that URL', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });
    vi.stubGlobal('fetch', fetchSpy);

    const result = await askUserQuestion.execute(
      { question: 'Which colour?', options: ['Red', 'Blue'] },
      {
        config: { XYNE_CLAW_AUTH_URL: 'http://auth-service:3003' },
        s2sKey: 'test-s2s',
        meta: {
          userId: 'user-1',
          agentSlug: 'test-agent',
          channelId: 'chan-1',
          conversationId: 'conv-1',
        },
        pendingQuestions: [],
      } as any,
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://auth-service:3003/claw/api/v1/pending-questions');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      'Content-Type': 'application/json',
      'x-s2s-key': 'test-s2s',
    });
    expect(result).toContain('STOP');
    expect(result).toContain('Which colour?');

    vi.unstubAllGlobals();
  });

  it('returns an error when options count is invalid', async () => {
    const result = await askUserQuestion.execute(
      { question: 'Which colour?', options: ['Red'] },
      { config: {}, pendingQuestions: [] } as any,
    );
    expect(result).toContain('provide 2-4 options');
  });
});
