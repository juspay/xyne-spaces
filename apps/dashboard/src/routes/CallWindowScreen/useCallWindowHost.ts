import { useEffect } from 'react';
import { useBlocker } from 'react-router-dom';
import { CALL_WINDOW_ROUTE } from '../../utils/callWindow';
import { toRegularPath } from '../../utils/electronApp';

/**
 * In-app navigation away from the call belongs to the main window: following
 * it here would unmount the call UI. (The handoff, status and commands run
 * outside React — see callWindowHost.)
 */
export function useCallWindowNavigationGuard(): void {
  const blocker = useBlocker(({ nextLocation }) => nextLocation.pathname !== CALL_WINDOW_ROUTE);
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    const { pathname, search, hash } = blocker.location;
    window.electronAPI?.callWindow?.openInMain(`${toRegularPath(pathname)}${search}${hash}`);
    blocker.reset();
  }, [blocker]);
}
