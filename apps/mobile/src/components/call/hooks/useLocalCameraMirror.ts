import { useSyncExternalStore } from 'react';

import { callRuntimeNativeService } from '@/src/services/CallRuntimeNativeService';

const subscribe = (onChange: () => void): (() => void) =>
  callRuntimeNativeService.subscribeCameraFacing(onChange);

const getMirror = (): boolean => callRuntimeNativeService.getCameraFacing() === 'user';

/** The self-view is mirrored like a bathroom mirror on the front lens, but not on the back one. */
export function useLocalCameraMirror(): boolean {
  return useSyncExternalStore(subscribe, getMirror, getMirror);
}
