import { automationContextStorage } from '../engine/automation-context-storage';
import type { AutomationContext } from '../types/context';
import { clawClient } from '../services/claw-client';
import { RunAgentStep, type RunAgentConfig } from './run-agent.step';
import { db } from '@/database/client';

jest.mock('@xyne/shared', () => ({ TAG_FORMAT_REGEX: /^[a-z0-9_-]+$/i }));
jest.mock('@xyne/shared/automations/variable-ref', () => ({
  VARIABLE_REF_REGEX: /^\{\{(?:context\.)?[^}]+\}\}$/,
  VARIABLE_REF_DESCRIPTION_PREFIX: '__variableRef__',
}));

jest.mock('../services/agent-attachment.service', () => ({
  parseAgentAttachments: jest.fn(() => []),
}));

jest.mock('../services/claw-client', () => ({
  clawClient: {
    runAgent: jest.fn(),
    listAgents: jest.fn(),
  },
}));

jest.mock('@/database/client', () => ({
  db: {
    apps: { findUnique: jest.fn() },
    installedApps: { findFirst: jest.fn() },
    workspace: { findUnique: jest.fn() },
    user: { findUnique: jest.fn() },
    workspaceOrganization: { findFirst: jest.fn(), findMany: jest.fn() },
  },
}));

jest.mock('@/config/env', () => ({
  config: {
    xyneClaw: { callbackUrl: 'https://spaces.example.test' },
  },
}));

jest.mock('@/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

const mockedRunAgent = jest.mocked(clawClient.runAgent);
const mockedAppsFindUnique = db.apps.findUnique as jest.Mock;
const mockedInstalledAppsFindFirst = db.installedApps.findFirst as jest.Mock;
const mockedWorkspaceFindUnique = db.workspace.findUnique as jest.Mock;
const mockedUserFindUnique = db.user.findUnique as jest.Mock;

function automationContext(): AutomationContext {
  return {
    automation: {
      id: 'automation-1',
      workspaceId: 'workspace-1',
      createdById: 'creator-1',
    },
    trigger: { type: 'MESSAGE_RECEIVED', data: {} } as AutomationContext['trigger'],
    steps: {
      conditional: { type: 'CONDITIONAL', output: {} },
      nestedAction: { type: 'SEND_MESSAGE', input: {}, output: {} },
      runAgent: { type: 'RUN_AGENT', input: {}, output: {} },
    },
  };
}

const config: RunAgentConfig = {
  agentSlug: 'test-agent',
  spacesAppId: 'app-1',
  prompt: 'Return JSON',
  outputSchema: { expected: 'string' },
  maxRetries: 3,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockedAppsFindUnique.mockResolvedValue({ workspaceId: 'workspace-1', orgId: 'org-1' });
  mockedInstalledAppsFindFirst.mockResolvedValue({ userId: 'app-user-1' });
  mockedWorkspaceFindUnique.mockResolvedValue({ orgId: 'org-1' });
  mockedUserFindUnique.mockResolvedValue({ orgMemberId: 'member-1' });
  mockedRunAgent.mockResolvedValue({ success: true, sessionId: 'run-1:step_1' });
});

describe('RunAgentStep callback routing', () => {
  it('uses the executor step name instead of counting context entries', async () => {
    const step = new RunAgentStep();

    await expect(
      automationContextStorage.run(
        { runId: 'run-1', automationId: 'automation-1', chain: [] },
        () =>
          step.execute(config, automationContext(), {
            runId: 'run-1',
            stepName: 'step_1',
            isResuming: false,
          })
      )
    ).rejects.toMatchObject({ name: 'PauseStep' });

    expect(mockedRunAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'run-1:step_1',
        callbackUrl:
          'https://spaces.example.test/api/internal/automations/claw-callback/run-1/step_1',
      })
    );
  });

  it('keeps validation retries on the executor step name', async () => {
    const step = new RunAgentStep();

    await expect(
      automationContextStorage.run(
        { runId: 'run-1', automationId: 'automation-1', chain: [] },
        () =>
          step.onResume(
            { agentRawResult: { status: 'completed', result: '{"other":"value"}' } },
            config,
            automationContext(),
            { runId: 'run-1', stepName: 'step_1', isResuming: true }
          )
      )
    ).rejects.toMatchObject({ name: 'PauseStep' });

    expect(mockedRunAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'run-1:step_1:retry-1',
        callbackUrl:
          'https://spaces.example.test/api/internal/automations/claw-callback/run-1/step_1',
      })
    );
  });
});
