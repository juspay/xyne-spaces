import { EXECUTION_ACTIONS, WORKFLOW_ACTIONS } from '@xyne/workflow-sdk';
import type { ExecutionRecord, ResourceRef, WorkflowRecord } from '@xyne/workflow-sdk';
import { db } from '@/database/client';
import { XyneWorkflowAuthorizer } from './authorizer';

jest.mock('@/database/client', () => ({ db: { workflowExecution: { findMany: jest.fn() } } }));
jest.mock('@/database/tenant/context', () => ({ runAsSystem: <T>(fn: () => T) => fn() }));

// Each run's workspace, as its row stores it.
const runs: Record<string, string> = { ex_a1: 'ws_a', ex_a2: 'ws_a', ex_b1: 'ws_b' };
const findMany = db.workflowExecution.findMany as unknown as jest.Mock;
findMany.mockImplementation(async ({ where }: { where: { id: { in: string[] } } }) =>
  where.id.in.filter((id) => runs[id]).map((id) => ({ id, workspaceId: runs[id] })),
);

const execution = (id: string): ResourceRef => ({
  type: 'execution',
  id,
  record: { id, workflowId: 'wf', status: 'EXTERNAL_WAIT', createdAt: new Date() } as ExecutionRecord,
});

describe('XyneWorkflowAuthorizer', () => {
  const authorizer = new XyneWorkflowAuthorizer();
  const inA = { userId: 'u1', workspaceId: 'ws_a' };

  beforeEach(() => findMany.mockClear());

  it('allows a run in the caller’s workspace', async () => {
    await expect(authorizer.permissions(inA, execution('ex_a1'))).resolves.toEqual(EXECUTION_ACTIONS);
  });

  it('denies a run in another workspace', async () => {
    await expect(authorizer.permissions(inA, execution('ex_b1'))).resolves.toEqual([]);
  });

  it('denies a run it cannot find', async () => {
    await expect(authorizer.permissions(inA, execution('ex_gone'))).resolves.toEqual([]);
  });

  it('decides a page of runs with one query', async () => {
    const refs = [execution('ex_a1'), execution('ex_b1'), execution('ex_a2')];
    await expect(authorizer.permissionsBatch(inA, refs)).resolves.toEqual([EXECUTION_ACTIONS, [], EXECUTION_ACTIONS]);
    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it('decides workflows from their own attributes, without a query', async () => {
    const workflow = { id: 'wf', attributes: { workspaceId: 'ws_a' } } as unknown as WorkflowRecord;
    await expect(authorizer.permissions(inA, { type: 'workflow', id: 'wf', record: workflow })).resolves.toEqual(WORKFLOW_ACTIONS);
    expect(findMany).not.toHaveBeenCalled();
  });
});
