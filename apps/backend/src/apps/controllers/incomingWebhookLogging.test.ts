/**
 * Canary test for XYNE-65488 (C-2, C-5, N-1): the incoming-webhook secret and
 * the webhook payload must never reach the logs, on success or error paths.
 */
import { Writable } from 'stream';
import winston from 'winston';
import type { Request, Response } from 'express';

const SECRET_CANARY = 'canary-webhook-secret-5d1e';
const PAYLOAD_CANARY = 'canary-payload-marker-9b7c';

const mockRepositories = {
  installedApps: { findFirst: jest.fn() },
  users: { findById: jest.fn() },
  incomingWebhooks: { findActiveByInstalledAppId: jest.fn() },
  channelParticipants: { isParticipant: jest.fn() },
};

// The bare `@xyne/shared` entry resolves to ESM dist, which jest cannot parse;
// the enums this controller needs live in the TS source.
jest.mock('@xyne/shared', () => jest.requireActual('@xyne/shared/zero/types'));
jest.mock('@/database/repositories', () => ({ repositories: mockRepositories }));
jest.mock('@/services/encryptionService', () => ({
  encrypt: jest.fn((value: string) => `enc:${value}`),
  decrypt: jest.fn((value: string) => value.replace(/^enc:/, '')),
}));
jest.mock('@/bypassAcl/appServices', () => ({
  processSlackIncoming: jest.fn(async (_ctx: unknown, res: Response) => {
    res.status(200).send('ok');
  }),
  processSentinelIncoming: jest.fn(),
  processAmazonSnsIncoming: jest.fn(),
  processPingdomIncoming: jest.fn(),
  processGcpIncoming: jest.fn(),
}));

import { logger } from '@/utils/logger';
import { incomingWebhookController } from './incomingWebhookController';

function captureLogs(): { lines: string[]; detach: () => void } {
  const lines: string[] = [];
  const transport = new winston.transports.Stream({
    level: 'debug',
    format: winston.format.json(),
    stream: new Writable({
      write(chunk, _enc, cb) {
        lines.push(String(chunk));
        cb();
      },
    }),
  });
  const previousLevel = logger.level;
  logger.level = 'debug';
  logger.add(transport);
  return {
    lines,
    detach: () => {
      logger.remove(transport);
      logger.level = previousLevel;
    },
  };
}

function mockResponse(): Response {
  const res = {} as Response;
  res.status = jest.fn(() => res);
  res.send = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

function incomingRequest(): Request {
  return {
    params: { workspaceId: 'ws_1', appId: 'app_1', secret: SECRET_CANARY },
    body: { text: PAYLOAD_CANARY, token: SECRET_CANARY },
    headers: { 'content-length': '64' },
  } as unknown as Request;
}

describe('incoming webhook logging', () => {
  let capture: ReturnType<typeof captureLogs>;

  beforeEach(() => {
    jest.clearAllMocks();
    capture = captureLogs();
  });

  afterEach(() => capture.detach());

  const flush = () => new Promise((resolve) => setImmediate(resolve));

  it('does not log the secret or payload on the success path', async () => {
    mockRepositories.installedApps.findFirst.mockResolvedValue({ id: 'app_1', userId: 'bot_1' });
    mockRepositories.users.findById.mockResolvedValue({ id: 'bot_1', workspaceId: 'ws_1' });
    mockRepositories.incomingWebhooks.findActiveByInstalledAppId.mockResolvedValue([
      { id: 'wh_1', channelId: 'ch_1', type: 'SLACK', secret: `enc:${SECRET_CANARY}` },
    ]);
    mockRepositories.channelParticipants.isParticipant.mockResolvedValue(true);

    const res = mockResponse();
    await incomingWebhookController.handleIncoming(incomingRequest(), res);
    await flush();

    expect(res.status).toHaveBeenCalledWith(200);
    const output = capture.lines.join('\n');
    expect(output).toContain('Received Slack-format webhook');
    expect(output).not.toContain(SECRET_CANARY);
    expect(output).not.toContain(PAYLOAD_CANARY);
  });

  it('does not log the secret on the error path', async () => {
    mockRepositories.installedApps.findFirst.mockRejectedValue(new Error('db down'));

    const res = mockResponse();
    await incomingWebhookController.handleIncoming(incomingRequest(), res);
    await flush();

    expect(res.status).toHaveBeenCalledWith(500);
    const output = capture.lines.join('\n');
    expect(output).toContain('Error handling incoming webhook');
    expect(output).toContain('ws_1');
    expect(output).not.toContain(SECRET_CANARY);
    expect(output).not.toContain(PAYLOAD_CANARY);
  });

  it('masks credential-named fields even when a call site logs them directly', async () => {
    logger.error('direct log', { params: { secret: SECRET_CANARY }, clientState: SECRET_CANARY });
    await flush();

    const output = capture.lines.join('\n');
    expect(output).toContain('direct log');
    expect(output).not.toContain(SECRET_CANARY);
  });
});
