/**
 * Status mapping for the chat-project proxy.
 *
 * The point of these: claw-auth's 404 ("no such project, or not yours") has to
 * reach the dashboard as a 404, while its 401 must NOT — the dashboard's axios
 * interceptor treats any 401 as session expiry and fires a session refresh
 * plus a retry, which would be wasted work on a perfectly valid session.
 */

// The mock owns ClawRequestError so `instanceof` binds to the same class the
// controller imports; constructing it here would otherwise be a different one.
jest.mock('@/services/clawAgentService', () => {
  class ClawRequestError extends Error {
    constructor(
      message: string,
      readonly status: number
    ) {
      super(message);
      this.name = 'ClawRequestError';
    }
  }
  return {
    ClawRequestError,
    ClawNotesError: class ClawNotesError extends Error {},
    CMDK_ANSWER_AGENT_SLUG: 'cmdk-answer',
    listClawConversations: jest.fn(),
    patchClawConversation: jest.fn(),
    listClawChatProjects: jest.fn(),
    createClawChatProject: jest.fn(),
    getClawChatProject: jest.fn(),
    updateClawChatProject: jest.fn(),
    deleteClawChatProject: jest.fn(),
    reorderClawChatProjects: jest.fn(),
    runClawAgentStream: jest.fn(),
    cancelClawAgentRun: jest.fn(),
    listAccessibleClawAgents: jest.fn(),
    listClawAgentModels: jest.fn(),
    warmClawAgent: jest.fn(),
    deleteClawConversation: jest.fn(),
    saveClawConversationNotes: jest.fn(),
    getClawConversationMessages: jest.fn(),
    listClawConversationArtifacts: jest.fn(),
    getClawConversationArtifact: jest.fn(),
    clawArtifactComments: jest.fn(),
    addClawArtifactComment: jest.fn(),
    resolveClawArtifactComment: jest.fn(),
    updateClawConversationArtifact: jest.fn(),
    rateClawRun: jest.fn(),
    streamClawConversationLive: jest.fn(),
    synthesizeSpeech: jest.fn(),
    fetchClawDebugArtifacts: jest.fn(),
  };
});

jest.mock('@/utils/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), debug: jest.fn(), warn: jest.fn() },
}));

// @xyne/shared ships ESM that jest's transform ignores — stub the one import
// the controller uses (same approach as prCheckApprovalService.test.ts).
jest.mock('@xyne/shared', () => ({ SDLC_MEMBERSHIP_RELATION: 'sdlc_membership' }));
jest.mock('@/config/env', () => ({ config: { backendUrl: 'http://localhost:3000' } }));
jest.mock('@/database/client', () => ({ db: {} }));
// Also ESM-only under jest's transform.
jest.mock('@juspay-jaf/jaf', () => ({ getOtelTraceId: jest.fn(() => 'trace-1') }));

jest.mock('@/services/otel', () => ({
  getAskAIQueriesTotal: jest.fn(() => ({ add: jest.fn(), record: jest.fn() })),
  getAskAIQueryDuration: jest.fn(() => ({ add: jest.fn(), record: jest.fn() })),
  getAskAIContextChannels: jest.fn(() => ({ add: jest.fn(), record: jest.fn() })),
  getAskAIFeedbackTotal: jest.fn(() => ({ add: jest.fn(), record: jest.fn() })),
}));
jest.mock('@/apps/core/flowToken', () => ({ attachXyneAiFlowToken: jest.fn() }));
jest.mock('@/sdlc/SdlcLinkedContextResolver', () => ({
  resolveAuthorizedSdlcLinkedContext: jest.fn(),
}));

import type { Request, Response } from 'express';
import {
  ClawRequestError,
  listClawConversations,
  patchClawConversation,
  listClawChatProjects,
} from '@/services/clawAgentService';
import { xyneAIControllerV2 } from './xyneAIControllerV2';

interface Captured {
  status: number;
  body: Record<string, unknown>;
}

const run = async (
  handler: (req: Request, res: Response) => Promise<void>,
  req: Partial<Request>
): Promise<Captured> => {
  const captured: Captured = { status: 200, body: {} };
  const res = {
    status(code: number) {
      captured.status = code;
      return this;
    },
    json(payload: Record<string, unknown>) {
      captured.body = payload;
      return this;
    },
  } as unknown as Response;

  await handler({ headers: {}, query: {}, params: {}, body: {}, ...req } as Request, res);
  return captured;
};

const authed = (over: Partial<Request> = {}): Partial<Request> =>
  ({ user: { id: 'user-1' }, ...over }) as Partial<Request>;

const mocked = {
  list: listClawConversations as jest.MockedFunction<typeof listClawConversations>,
  patch: patchClawConversation as jest.MockedFunction<typeof patchClawConversation>,
  projects: listClawChatProjects as jest.MockedFunction<typeof listClawChatProjects>,
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('listConversations status mapping', () => {
  it('reports an unknown ?projectId= as 404, not an outage', async () => {
    mocked.list.mockRejectedValue(new ClawRequestError('Project not found', 404));

    const result = await run(
      xyneAIControllerV2.listConversations,
      authed({ query: { allAgents: '1', projectId: 'proj-missing' } as Request['query'] })
    );

    expect(result.status).toBe(404);
    expect(result.body).toMatchObject({ success: false, error: 'Project not found' });
  });

  it('still reports claw-auth being unreachable as 503', async () => {
    mocked.list.mockRejectedValue(new Error('fetch failed'));

    const result = await run(
      xyneAIControllerV2.listConversations,
      authed({ query: { allAgents: '1' } as Request['query'] })
    );

    expect(result.status).toBe(503);
  });

  it('does NOT pass a claw-auth 401 through to the dashboard', async () => {
    // A 401 here would trip the dashboard's session-refresh interceptor and
    // burn a refresh on a Spaces session that is still valid.
    mocked.list.mockRejectedValue(new ClawRequestError('Unauthorized', 401));

    const result = await run(
      xyneAIControllerV2.listConversations,
      authed({ query: { allAgents: '1' } as Request['query'] })
    );

    expect(result.status).toBe(503);
  });

  it('forwards projectId to claw-auth', async () => {
    mocked.list.mockResolvedValue({ success: true, data: [] });

    await run(
      xyneAIControllerV2.listConversations,
      authed({ query: { allAgents: '1', projectId: 'none' } as Request['query'] })
    );

    expect(mocked.list).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ projectId: 'none' })
    );
  });
});

describe('updateConversation with projectId', () => {
  it('reports moving into a project that is not yours as 404', async () => {
    mocked.patch.mockRejectedValue(new ClawRequestError('Project not found', 404));

    const result = await run(
      xyneAIControllerV2.updateConversation,
      authed({ params: { convId: 'conv-1' } as Request['params'], body: { projectId: 'proj-x' } })
    );

    expect(result.status).toBe(404);
    expect(result.body).toMatchObject({ error: 'Project not found' });
  });

  it('sends an explicit null so unfiling survives the hop', async () => {
    mocked.patch.mockResolvedValue({
      success: true,
      data: { title: null, pinned: false, projectId: null },
    });

    await run(
      xyneAIControllerV2.updateConversation,
      authed({ params: { convId: 'conv-1' } as Request['params'], body: { projectId: null } })
    );

    const patch = mocked.patch.mock.calls[0]?.[2];
    expect(patch).toHaveProperty('projectId', null);
  });

  it('leaves membership alone when projectId is absent', async () => {
    mocked.patch.mockResolvedValue({ success: true, data: { title: 'x', pinned: false } });

    await run(
      xyneAIControllerV2.updateConversation,
      authed({ params: { convId: 'conv-1' } as Request['params'], body: { title: 'x' } })
    );

    expect(mocked.patch.mock.calls[0]?.[2]).not.toHaveProperty('projectId');
  });

  it('rejects a body with none of title, pinned or projectId', async () => {
    const result = await run(
      xyneAIControllerV2.updateConversation,
      authed({ params: { convId: 'conv-1' } as Request['params'], body: {} })
    );

    expect(result.status).toBe(400);
    expect(mocked.patch).not.toHaveBeenCalled();
  });

  it('rejects a blank projectId string', async () => {
    const result = await run(
      xyneAIControllerV2.updateConversation,
      authed({ params: { convId: 'conv-1' } as Request['params'], body: { projectId: '   ' } })
    );

    expect(result.status).toBe(400);
  });
});

describe('project routes status mapping', () => {
  it('requires authentication', async () => {
    const result = await run(xyneAIControllerV2.listChatProjects, { headers: {} });
    expect(result.status).toBe(401);
  });

  it('passes a 404 through', async () => {
    mocked.projects.mockRejectedValue(new ClawRequestError('Project not found', 404));
    const result = await run(xyneAIControllerV2.listChatProjects, authed());
    expect(result.status).toBe(404);
  });

  it('passes a 400 through', async () => {
    mocked.projects.mockRejectedValue(new ClawRequestError('name is required', 400));
    const result = await run(xyneAIControllerV2.listChatProjects, authed());
    expect(result.status).toBe(400);
  });

  it('converts anything else to 503', async () => {
    mocked.projects.mockRejectedValue(new ClawRequestError('Forbidden', 403));
    const result = await run(xyneAIControllerV2.listChatProjects, authed());
    expect(result.status).toBe(503);
  });

  it('rejects a reorder payload that is not an array of ids', async () => {
    const result = await run(
      xyneAIControllerV2.reorderChatProjects,
      authed({ body: { projectIds: 'nope' } })
    );
    expect(result.status).toBe(400);
  });
});
