import { readFileSync } from 'fs';
import { join } from 'path';

jest.mock('@/apps/routes/chat', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('@/apps/routes/channel', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('@/apps/routes/files', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('@/apps/routes/ticket', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('@/middleware/upload', () => ({ uploadMultiple: jest.fn() }));
jest.mock('./tokens', () => ({ authenticateClawAgent: jest.fn() }));

import { isBotEndpoint, BOT_ENDPOINTS } from './botRoutes';

describe('bot API allowlist', () => {
  it('allows the endpoints Claw uses', () => {
    expect(isBotEndpoint('POST', '/chat/postMessage')).toBe(true);
    expect(isBotEndpoint('post', '/chat/updateMessage')).toBe(true);
    expect(isBotEndpoint('GET', '/chat/conversationReplies')).toBe(true);
    expect(isBotEndpoint('POST', '/channel/openDm')).toBe(true);
    expect(isBotEndpoint('GET', '/files/download/att_123')).toBe(true);
    expect(isBotEndpoint('GET', '/ticket/XYNE-42')).toBe(true);
  });
  it('refuses everything else on the same routers', () => {
    expect(isBotEndpoint('POST', '/chat/deleteMessage')).toBe(false);
    expect(isBotEndpoint('POST', '/chat/postEphemeral')).toBe(false);
    expect(isBotEndpoint('GET', '/chat/channelHistory')).toBe(false);
    expect(isBotEndpoint('POST', '/channel/create')).toBe(false);
    expect(isBotEndpoint('POST', '/ticket/createTicket')).toBe(false);
    expect(isBotEndpoint('GET', '/files/info/att_123')).toBe(false);
    expect(isBotEndpoint('GET', '/chat/postMessage')).toBe(false);
  });
  it('a ticket id cannot name another ticket route', () => {
    expect(isBotEndpoint('GET', '/ticket/boards')).toBe(false);
    expect(isBotEndpoint('GET', '/ticket/listBySender')).toBe(false);
    expect(isBotEndpoint('GET', '/ticket/boards/b1/stages')).toBe(false);
    expect(isBotEndpoint('GET', '/ticket/t1/conversation')).toBe(false);
  });
  it('no path tricks', () => {
    expect(isBotEndpoint('POST', '/chat/postMessage/../deleteMessage')).toBe(false);
    expect(isBotEndpoint('POST', '/chat/postMessageX')).toBe(false);
    expect(isBotEndpoint('POST', '/x/chat/postMessage')).toBe(false);
  });
  it('every allowed endpoint exists on the app routers', () => {
    const routes = (f: string) => readFileSync(join(__dirname, '../apps/routes', f), 'utf8');
    const files: Record<string, string> = { chat: routes('chat.ts'), channel: routes('channel.ts'), files: routes('files.ts'), ticket: routes('ticket.ts') };
    for (const e of BOT_ENDPOINTS) {
      const [, group, ...rest] = e.path.split('/');
      const sub = '/' + rest.join('/');
      expect(files[group!]).toContain(`router.${e.method.toLowerCase()}('${sub}'`);
    }
  });
});

describe('app authenticator', () => {
  it('no longer accepts agent tokens', () => {
    const src = readFileSync(join(__dirname, '../apps/middelware/authenticator.ts'), 'utf8');
    expect(src).not.toMatch(/claw\/tokens|looksLikeAgentToken|authenticateClawAgent/);
  });
});
