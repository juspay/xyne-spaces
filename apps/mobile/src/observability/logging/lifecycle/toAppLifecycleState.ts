import type { AppStateStatus } from 'react-native';

import type { AppLifecycleState } from './AppLifecycle';

export function toAppLifecycleState(state: AppStateStatus | null): AppLifecycleState {
  // Android often reports `unknown` until the first change event. Treating that
  // as background would skip foreground-only work (heartbeat) for the whole
  // launch if no change event is ever delivered.
  if (state === 'active' || state === 'unknown') {
    return 'foreground';
  }

  return 'background';
}
