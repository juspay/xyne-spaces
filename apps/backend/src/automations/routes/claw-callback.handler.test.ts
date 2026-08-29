import type { Request, Response } from 'express';
import { AutomationRunStatus } from '../types/status';

const mockFindStep = jest.fn();
const mockUpdateManySteps = jest.fn();
const mockFindExecution = jest.fn();
const mockEnqueueRun = jest.fn();

jest.mock('@/database/client', () => ({
  db: {
    workflowStep: {
      findUnique: (...args: unknown[]) => mockFindStep(...args),
      updateMany: (...args: unknown[]) => mockUpdateManySteps(...args),
    },
    workflowExecution: {
      findUniqueOrThrow: (...args: unknown[]) => mockFindExecution(...args),
    },
  },
}));

jest.mock('../queue/automation.queue', () => ({
  automationQueue: {
    enqueueRun: (...args: unknown[]) => mockEnqueueRun(...args),
  },
}));

import { handleClawCallback } from './claw-callback.handler';

function responseMock(): Response {
  const response = {
    status: jest.fn(),
    json: jest.fn(),
  };
  response.status.mockReturnValue(response);
  return response as unknown as Response;
}

function requestMock(
  body: Record<string, unknown> = { answer: 'done' }
): Request<{ executionId: string; stepName: string }> {
  return {
    params: { executionId: 'run-1', stepName: 'step_0__if_true__step_1' },
    body,
  } as unknown as Request<{ executionId: string; stepName: string }>;
}

describe('handleClawCallback', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFindExecution.mockResolvedValue({ status: AutomationRunStatus.EXTERNAL_WAIT });
    mockUpdateManySteps.mockResolvedValue({ count: 1 });
    mockEnqueueRun.mockResolvedValue(undefined);
  });

  it('stores and enqueues the first callback for a nested step', async () => {
    mockFindStep.mockResolvedValue({ data: JSON.stringify({ input: { agentSlug: 'bot' } }) });
    const res = responseMock();

    await handleClawCallback(requestMock(), res);

    expect(mockUpdateManySteps).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          workflowExecutionId: 'run-1',
          stepName: 'step_0__if_true__step_1',
          data: JSON.stringify({ input: { agentSlug: 'bot' } }),
        },
      })
    );
    expect(mockEnqueueRun).toHaveBeenCalledWith({ executionId: 'run-1' });
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  it('does not enqueue duplicate callbacks', async () => {
    mockFindStep.mockResolvedValue({
      data: JSON.stringify({ agentRawResult: { answer: 'first' } }),
    });
    const res = responseMock();

    await handleClawCallback(requestMock({ answer: 'duplicate' }), res);

    expect(mockUpdateManySteps).not.toHaveBeenCalled();
    expect(mockEnqueueRun).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ success: true, duplicate: true });
  });

  it('ignores callbacks after the execution becomes terminal', async () => {
    mockFindExecution.mockResolvedValue({ status: AutomationRunStatus.COMPLETED });
    mockFindStep.mockResolvedValue({ data: '{}' });
    const res = responseMock();

    await handleClawCallback(requestMock(), res);

    expect(mockUpdateManySteps).not.toHaveBeenCalled();
    expect(mockEnqueueRun).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ success: true, ignored: 'execution_terminal' });
  });
});
