import { createHmac } from 'crypto';

const findFirstApp = jest.fn();
const decryptSecret = jest.fn();

jest.mock('@/config/env', () => ({
  config: {
    xyneClaw: {
      authUrl: 'http://claw-auth.internal',
      webhookUrl: 'http://claw-auth.internal/claw/api/v1/webhook',
      clawAuthCallbackUrlAutomation: 'http://claw-auth.internal/claw/api/v1/webhook',
      s2sKey: 's2s-secret',
    },
  },
}));
jest.mock('@/database/client', () => ({
  db: {
    apps: { findFirst: findFirstApp },
  },
}));
jest.mock('@/services/encryptionService', () => ({ decrypt: decryptSecret }));
jest.mock('@/apps/core/eventSubscriptionUtils', () => ({
  sendWebhookNotification: jest.fn(),
  signWebhookPayload: (payload: string, secret: string) =>
    createHmac('sha256', secret).update(payload).digest('hex'),
}));
jest.mock('@/utils/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), debug: jest.fn(), warn: jest.fn() },
}));

import { runS2SClawAgent } from '../../src/services/clawAgentService';

describe('runS2SClawAgent webhook authentication', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    findFirstApp.mockReset();
    decryptSecret.mockReset();
  });

  it('routes through the registered app and signs the exact request body', async () => {
    findFirstApp.mockResolvedValue({ signingSecret: 'encrypted-secret' });
    decryptSecret.mockReturnValue('plaintext-signing-secret');
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            data: [
              {
                id: 'agent-id',
                slug: 'sdlc-agent',
                name: 'SDLC Assistant',
                description: '',
                enabled: true,
                isDefault: false,
                color: '#000000',
                spacesAppId: 'spaces-app-id',
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true, sessionId: 'session-id' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

    await runS2SClawAgent({
      sessionId: 'session-id',
      agentSlug: 'sdlc-agent',
      task: 'Generate the baseline',
      userId: 'user-id',
      userName: 'User',
      userEmail: 'user@example.com',
      callbackUrl: 'http://spaces.internal/api/sdlc/callback',
      workspaceId: 'workspace-id',
      executionProfile: 'sdlc',
      sdlcOperation: 'baseline',
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, request] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe('http://claw-auth.internal/claw/api/v1/webhook/app/spaces-app-id');
    const body = request.body as string;
    expect(request.headers).toMatchObject({
      'x-s2s-key': 's2s-secret',
      'X-Xyne-Signature': createHmac('sha256', 'plaintext-signing-secret')
        .update(body)
        .digest('hex'),
    });
    expect(findFirstApp).toHaveBeenCalledWith({
      where: { id: 'spaces-app-id', workspaceId: 'workspace-id' },
      select: { signingSecret: true },
    });
  });
});
