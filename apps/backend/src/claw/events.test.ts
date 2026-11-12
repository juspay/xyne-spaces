import { generateKeyPairSync } from 'crypto';

const spaces = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const mockConfig = {
  xyneClaw: {
    delegationPrivateKey: spaces.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    delegationKeyId: 'spaces-1',
    servicePublicKeys: '',
    authUrl: 'http://claw-auth.internal:3003/',
  },
};
jest.mock('@/config/env', () => ({ config: mockConfig }));
jest.mock('@/utils/logger', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() } }));
jest.mock('@/database/client', () => ({ db: {} }));
jest.mock('@/database/tenant/context', () => ({ runAsSystem: (fn: () => unknown) => fn() }));
jest.mock('./principals', () => ({ PRINCIPAL_ACTIVE: 'ACTIVE' }));

import { verifyEs256, spacesPublicKey } from './jwt';
import { agentEventUrl, agentFlowActionUrl, bodyHash, dispatchAgentEvent, mintEventToken, postAgentFlowAction } from './events';

const principal = { id: 'p1', workspaceId: 'ws1', orgId: 'o', clawAgentId: 'a', name: 'A', botUserId: 'bot1', status: 'ACTIVE' };

function decode(token: string) {
  const v = verifyEs256(token, spacesPublicKey, { issuer: 'xyne-spaces', audience: 'xyne-claw-auth', typ: 'claw-event+jwt', maxLifetimeSeconds: 600 });
  if (typeof v === 'string') throw new Error(v);
  return v.payload;
}

describe('claw events', () => {
  it('event token names the sender and binds the exact body', () => {
    const body = JSON.stringify({ eventType: 'APP_MENTION', payload: { userId: 'alice', workspaceId: 'ws1' } });
    const p = decode(mintEventToken({ principal, senderUserId: 'alice', eventType: 'APP_MENTION', body })!);
    expect(p).toMatchObject({ sub: 'alice', ws: 'ws1', pid: 'p1', prp: 'event:APP_MENTION', bh: bodyHash(body) });
    expect(p.bh).not.toBe(bodyHash(body + ' '));
  });

  it('a system event with no sender is attributed to the agent bot', () => {
    const p = decode(mintEventToken({ principal, eventType: 'X', body: '{}' })!);
    expect(p.sub).toBe('bot1');
  });

  it('targets the fixed claw-auth agent endpoint', () => {
    expect(agentEventUrl('p 1')).toBe('http://claw-auth.internal:3003/claw/api/v1/webhook/agent/p%201');
  });

  it('refuses to deliver an event from another workspace', async () => {
    await expect(
      dispatchAgentEvent(principal, { eventType: 'APP_MENTION', payload: { userId: 'mallory', workspaceId: 'ws2' }, timestamp: '' } as never)
    ).rejects.toThrow('event workspace does not match');
  });

  it('sends the body unchanged with the token header', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
    const event = { eventType: 'DM', payload: { userId: 'alice', workspaceId: 'ws1', content: 'hi' }, timestamp: 't' } as never;
    const r = await dispatchAgentEvent(principal, event);
    expect(r.status).toBe(200);
    const [, init] = fetchMock.mock.calls[0]!;
    const headers = init!.headers as Record<string, string>;
    expect(decode(headers['x-spaces-event']!).bh).toBe(bodyHash(String(init!.body)));
    fetchMock.mockRestore();
  });

  it('a flow-card click goes to the agent route, signed as the clicking user', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(new Response('{"type":"ok"}', { status: 200 }));
    const body = JSON.stringify({ actionId: 'approve', context: { messageId: 'm1', userId: 'alice' } });
    await postAgentFlowAction(principal, 'alice', body);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(agentFlowActionUrl('p1'));
    expect(url).toBe('http://claw-auth.internal:3003/claw/api/v1/flow/agent/p1/action');
    expect(init!.body).toBe(body);
    const p = decode((init!.headers as Record<string, string>)['x-spaces-event']!);
    expect(p).toMatchObject({ sub: 'alice', pid: 'p1', ws: 'ws1', prp: 'event:flow_action', bh: bodyHash(body) });
    fetchMock.mockRestore();
  });
});
