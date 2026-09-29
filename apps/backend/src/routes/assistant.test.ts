import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { TurnResponse } from '@xyne/shared/assistant';
import type { AuthenticatedUser } from '@/types/express';

jest.mock('@/services/assistant', () => ({
  assistantServices: jest.fn(),
  handleTurn: jest.fn(),
  isAssistantOn: jest.fn(),
  jevConnection: jest.fn(),
}));
jest.mock('@/services/otel/assistantMetrics', () => ({
  getAssistantTurnDuration: () => ({ record: jest.fn() }),
  getAssistantTurnsTotal: () => ({ add: jest.fn() }),
}));
jest.mock('@/utils/logger', () => ({ logger: { info: jest.fn(), error: jest.fn() } }));

import { assistantServices, handleTurn, isAssistantOn, jevConnection } from '@/services/assistant';
import router from './assistant';

const user: AuthenticatedUser = {
  id: 'user-1',
  googleId: 'google-1',
  email: 'user@example.com',
  name: 'Test User',
  workspaceId: 'workspace-1',
  role: 'MEMBER',
  orgRole: 'MEMBER',
  memberId: 'member-1',
};
const body = {
  requestId: 'request-1',
  input: { kind: 'text' as const, text: 'find the Android thread', via: 'typed' as const },
  context: { onScreen: [] },
};
const reply: TurnResponse = { turnId: 'turn-1', say: 'Here it is.', expectsReply: false };

function turnHandler(): RequestHandler {
  const layers = (
    router as unknown as {
      stack: Array<{
        route?: {
          path: string;
          methods: { post?: boolean };
          stack: Array<{ handle: RequestHandler }>;
        };
      }>;
    }
  ).stack;
  const route = layers.find((layer) => layer.route?.path === '/sessions/:sessionId/turns');
  if (!route?.route?.methods.post || !route.route.stack[0]) {
    throw new Error('Assistant turn POST route is not registered.');
  }
  return route.route.stack[0].handle;
}

async function callTurn(
  currentUser: AuthenticatedUser | null = user,
  params: Record<string, string> = { sessionId: 'session-1' },
  requestBody: unknown = body
): Promise<{ status: number; body: unknown }> {
  const req = { user: currentUser ?? undefined, params, body: requestBody } as Request;
  let status = 200;
  let responseBody: unknown;
  const res = {
    status(code: number) {
      status = code;
      return this;
    },
    json(value: unknown) {
      responseBody = value;
      return this;
    },
  } as unknown as Response;
  await turnHandler()(req, res, jest.fn() as NextFunction);
  return { status, body: responseBody };
}

describe('assistant turn route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(jevConnection).mockReturnValue({} as never);
    jest.mocked(isAssistantOn).mockResolvedValue(true);
    jest.mocked(assistantServices).mockReturnValue({ debug: false } as never);
    jest.mocked(handleTurn).mockResolvedValue(reply);
  });

  it('validates the request and passes the authenticated session to the turn handler', async () => {
    const response = await callTurn();
    expect(response).toEqual({ status: 200, body: reply });

    expect(handleTurn).toHaveBeenCalledWith(
      body.input,
      { workspaceId: user.workspaceId, userId: user.id, sessionId: 'session-1' },
      expect.anything(),
      body.context
    );
  });

  it('rejects unauthenticated, disabled, and invalid requests before handling a turn', async () => {
    expect(await callTurn(null)).toMatchObject({ status: 401 });

    jest.mocked(isAssistantOn).mockResolvedValue(false);
    expect(await callTurn()).toMatchObject({ status: 503 });

    jest.mocked(isAssistantOn).mockResolvedValue(true);
    expect(await callTurn(user, { sessionId: 'session-1' }, {})).toMatchObject({ status: 400 });
    expect(handleTurn).not.toHaveBeenCalled();
  });

  it('does not expose internal errors and maps an unavailable record service to 503', async () => {
    jest.mocked(handleTurn).mockRejectedValueOnce(new Error('private provider detail'));
    const failed = await callTurn();
    expect(failed).toMatchObject({
      status: 500,
      body: { error: 'Something went wrong. Please try again.' },
    });
    expect(JSON.stringify(failed.body)).not.toContain('private provider detail');

    const { UnavailableError } = await import('@/services/assistant/records');
    jest.mocked(handleTurn).mockRejectedValueOnce(new UnavailableError('Search is unavailable.'));
    const unavailable = await callTurn();
    expect(unavailable).toEqual({ status: 503, body: { error: 'Search is unavailable.' } });
  });
});
