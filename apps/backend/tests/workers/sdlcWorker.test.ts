import type Bull from 'bull';
import type { SdlcJobData } from '@/queues/sdlcQueue';

const processMock = jest.fn();
const queueMock = {
  process: processMock,
  on: jest.fn(),
};
const admissionMock = {
  tryAcquire: jest.fn(),
  release: jest.fn(),
  registerPending: jest.fn(),
};
const executionServiceMock = {
  restoreAdmissionPermits: jest.fn(),
  dispatchSetup: jest.fn(),
  dispatchArtifact: jest.fn(),
  dispatchWork: jest.fn(),
  failDispatch: jest.fn(),
};
const vcsMock = { performRepositoryCheck: jest.fn() };

jest.mock('@/config/env', () => ({
  config: { sdlcGlobalActiveLimit: 9, sdlcRepoActiveLimit: 3 },
}));
jest.mock('@/utils/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn() },
}));
jest.mock('@/queues/sdlcAdmission', () => ({ sdlcAdmission: admissionMock }));
jest.mock('@/queues/sdlcQueue', () => ({
  sdlcQueue: {
    initialize: jest.fn(),
    getQueue: jest.fn(() => queueMock),
    close: jest.fn(),
  },
}));
jest.mock('@/sdlc/SdlcClawExecutionService', () => ({
  sdlcClawExecutionService: executionServiceMock,
}));
jest.mock('@/sdlc/vcs/SdlcVcsService', () => ({ sdlcVcs: vcsMock }));

import { sdlcWorker } from '../../src/workers/sdlcWorker';

const job = (data: SdlcJobData): Bull.Job<SdlcJobData> =>
  ({
    id:
      data.type === 'ACCESS_CHECK'
        ? `access-check:${data.repoId}`
        : `${data.type}:${data.executionId}`,
    data,
    discard: jest.fn(),
    update: jest.fn(),
  }) as unknown as Bull.Job<SdlcJobData>;

describe('SdlcWorker', () => {
  let processJob: (job: Bull.Job<SdlcJobData>) => Promise<unknown>;

  beforeAll(async () => {
    await sdlcWorker.start();
    expect(processMock).toHaveBeenCalledWith(9, expect.any(Function));
    processJob = processMock.mock.calls[0][1];
  });

  beforeEach(() => {
    jest.clearAllMocks();
    admissionMock.tryAcquire.mockResolvedValue({ permitId: 'permit-1', repoId: 'repo-1' });
  });

  it('leaves capacity-blocked work queued for retry', async () => {
    admissionMock.tryAcquire.mockResolvedValue(null);
    await expect(
      processJob(job({ type: 'WORK', repoId: 'repo-1', executionId: 'execution-1' }))
    ).rejects.toMatchObject({ name: 'SdlcCapacityError' });
    expect(executionServiceMock.dispatchWork).not.toHaveBeenCalled();
  });

  it('counts access checks only while they are executing', async () => {
    vcsMock.performRepositoryCheck.mockResolvedValue({ readable: true });
    await expect(
      processJob({
        ...job({ type: 'ACCESS_CHECK', repoId: 'repo-1', workspaceId: 'ws-1', userId: 'user-1' }),
      })
    ).resolves.toEqual({ readable: true });
    expect(admissionMock.release).toHaveBeenCalledWith('permit-1');
  });

  it('retains execution permit after successful asynchronous dispatch', async () => {
    executionServiceMock.dispatchWork.mockResolvedValue(true);
    await processJob(job({ type: 'WORK', repoId: 'repo-1', executionId: 'execution-1' }));
    expect(executionServiceMock.dispatchWork).toHaveBeenCalledWith('execution-1', 'permit-1');
    expect(admissionMock.release).not.toHaveBeenCalled();
  });

  it('releases permit when execution was already dispatched or terminal', async () => {
    executionServiceMock.dispatchSetup.mockResolvedValue(false);
    await processJob(job({ type: 'SETUP', repoId: 'repo-1', executionId: 'execution-1' }));
    expect(admissionMock.release).toHaveBeenCalledWith('permit-1');
  });
});
