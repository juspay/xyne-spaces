import type { OpenState } from '../machine/openState';

export type ListChrome = {
  showSkeleton: boolean;
  showEmpty: boolean;
};

/**
 * Every frame shows skeleton, rows, empty, or error — never a blank list.
 * Rows exist behind a blank viewport until one is actually visible.
 */
export const listChromeFor = (
  status: OpenState['status'],
  rowCount: number,
  listLayoutReady: boolean,
): ListChrome => {
  if (status === 'error') {
    return { showSkeleton: false, showEmpty: false };
  }
  if (rowCount === 0) {
    return { showSkeleton: status !== 'ready', showEmpty: status === 'ready' };
  }
  return { showSkeleton: !listLayoutReady, showEmpty: false };
};
