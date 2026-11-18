const findById = jest.fn();
const updateMany = jest.fn();

jest.mock('@/database/repositories/externalSourceRepository', () => ({
  ExternalSourceRepository: jest.fn().mockImplementation(() => ({ findById })),
}));
jest.mock('@/database/client', () => ({ db: { externalSource: { updateMany } } }));
jest.mock('@/notification-service', () => ({ notificationService: {} }));
jest.mock('@xyne/shared', () => ({ NotificationType: {} }));
jest.mock('@/utils/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));

import { advanceSyncCursor } from './syncCursorRecovery';

const row = (lastSyncCursor: string | null) => ({ id: 'src-1', name: 'google-desk', lastSyncCursor });

describe('advanceSyncCursor', () => {
  beforeEach(() => {
    findById.mockReset();
    updateMany.mockReset();
  });

  it('writes only if the cursor still holds the value it read', async () => {
    findById.mockResolvedValueOnce(row('100'));
    updateMany.mockResolvedValueOnce({ count: 1 });

    await advanceSyncCursor('src-1', '200');

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'src-1', lastSyncCursor: '100' },
      data: { lastSyncCursor: '200' },
    });
  });

  it('never moves the cursor backwards', async () => {
    findById.mockResolvedValueOnce(row('300'));

    await advanceSyncCursor('src-1', '200');

    expect(updateMany).not.toHaveBeenCalled();
  });

  it('re-reads after losing a race and stops if the winner already went further', async () => {
    // Read 100, but another worker wrote 300 before our write: our compare-and-set matches nothing.
    findById.mockResolvedValueOnce(row('100')).mockResolvedValueOnce(row('300'));
    updateMany.mockResolvedValueOnce({ count: 0 });

    await advanceSyncCursor('src-1', '200');

    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(findById).toHaveBeenCalledTimes(2);
  });

  it('re-reads after losing a race and writes if it is still ahead', async () => {
    findById.mockResolvedValueOnce(row('100')).mockResolvedValueOnce(row('150'));
    updateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 });

    await advanceSyncCursor('src-1', '200');

    expect(updateMany).toHaveBeenLastCalledWith({
      where: { id: 'src-1', lastSyncCursor: '150' },
      data: { lastSyncCursor: '200' },
    });
  });

  it('seeds a source that has no cursor yet', async () => {
    findById.mockResolvedValueOnce(row(null));
    updateMany.mockResolvedValueOnce({ count: 1 });

    await advanceSyncCursor('src-1', '200');

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'src-1', lastSyncCursor: null },
      data: { lastSyncCursor: '200' },
    });
  });
});
