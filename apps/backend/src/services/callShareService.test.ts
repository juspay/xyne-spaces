// The @xyne/shared barrel pulls in the Zero client (ESM), which jest cannot
// parse. Re-export only the dependency-free pieces callShareService uses.
jest.mock('@xyne/shared', () => ({
  ...jest.requireActual('@xyne/shared/zero/types'),
  ...jest.requireActual('@xyne/shared/utils/recordingAccess'),
}));

import { CallType, CallVisibility } from '@xyne/shared/zero/types';

const findParticipant = jest.fn();
const isParticipant = jest.fn();
const listActiveForViewer = jest.fn();
const userGroupFindMany = jest.fn();
const channelParticipantFindMany = jest.fn();

jest.mock('@/database/repositories', () => ({
  repositories: {
    calls: { findParticipant: (...args: unknown[]) => findParticipant(...args) },
    channelParticipants: { isParticipant: (...args: unknown[]) => isParticipant(...args) },
    entityAccess: { listActiveForViewer: (...args: unknown[]) => listActiveForViewer(...args) },
  },
}));

jest.mock('@/database/client', () => ({
  db: {
    userGroupMapping: { findMany: (...args: unknown[]) => userGroupFindMany(...args) },
    channelParticipant: { findMany: (...args: unknown[]) => channelParticipantFindMany(...args) },
  },
}));

import { callShareService } from './callShareService';

const WORKSPACE = 'ws-1';
const VIEWER = 'viewer-1';

function makeCall(overrides: Record<string, unknown> = {}) {
  return {
    id: 'call-1',
    externalId: 'ext-1',
    callType: CallType.HEADLESS,
    channelId: 'chan-1',
    workspaceId: WORKSPACE,
    createdByUserId: 'owner-1',
    visibility: CallVisibility.PRIVATE,
    ...overrides,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

/**
 * Regression coverage for the transcript endpoints (translate-transcript /
 * download-transcript). Recording viewers who reach a recording through a share
 * grant or a public link are NOT part of the call audience, so the endpoints
 * must gate on canViewRecordings rather than isCallAudience.
 */
describe('callShareService transcript access', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Viewer is neither participant nor channel member.
    findParticipant.mockResolvedValue(null);
    isParticipant.mockResolvedValue(false);
    userGroupFindMany.mockResolvedValue([]);
    channelParticipantFindMany.mockResolvedValue([]);
    listActiveForViewer.mockResolvedValue([]);
  });

  it('share-grant viewer of a recording is not call audience but can view it', async () => {
    listActiveForViewer.mockResolvedValue([{ entityUserAccess: 'VIEW' }]);
    const call = makeCall();

    await expect(callShareService.isCallAudience(call, VIEWER)).resolves.toBe(false);
    await expect(callShareService.canViewRecordings(call, VIEWER)).resolves.toBe(true);
  });

  it('public-link viewer of a recording can view it', async () => {
    const call = makeCall({ visibility: CallVisibility.PUBLIC });

    await expect(callShareService.isCallAudience(call, VIEWER)).resolves.toBe(false);
    await expect(callShareService.canViewRecordings(call, VIEWER)).resolves.toBe(true);
  });

  it('viewer with no grant and no public link is denied', async () => {
    await expect(callShareService.canViewRecordings(makeCall(), VIEWER)).resolves.toBe(false);
  });

  it('regular calls still require the call audience', async () => {
    const call = makeCall({ callType: CallType.VIDEO });
    await expect(callShareService.canViewRecordings(call, VIEWER)).resolves.toBe(false);

    isParticipant.mockResolvedValue(true);
    await expect(callShareService.canViewRecordings(call, VIEWER)).resolves.toBe(true);
  });
});
