import { useCallback, useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';

type ExpoScreenOrientationModule = {
  lockAsync?: (orientationLock: number) => Promise<void>;
};

// Matches expo-screen-orientation OrientationLock values.
const ORIENTATION_LOCK_ALL = 1;
const ORIENTATION_LOCK_PORTRAIT_UP = 3;
const ORIENTATION_LOCK_LANDSCAPE = 5;

const getScreenOrientationModule = (): ExpoScreenOrientationModule | null =>
  requireOptionalNativeModule<ExpoScreenOrientationModule>('ExpoScreenOrientation');

/**
 * Unlocks screen rotation while the attachments viewer is open so the device
 * can rotate with system orientation settings. Restores portrait on unmount.
 */
const useAttachmentsViewerOrientation = (): { toggleOrientation: () => void } => {
  const isLandscapeLockedRef = useRef(false);

  useEffect(() => {
    if (Platform.OS === 'web') return;

    const lockAsync = getScreenOrientationModule()?.lockAsync;
    if (!lockAsync) return;

    void lockAsync(ORIENTATION_LOCK_ALL).catch(() => {});

    return (): void => {
      const cleanupLockAsync = getScreenOrientationModule()?.lockAsync;
      if (!cleanupLockAsync) return;
      void cleanupLockAsync(ORIENTATION_LOCK_PORTRAIT_UP).catch(() => {});
    };
  }, []);

  const toggleOrientation = useCallback((): void => {
    const lockAsync = getScreenOrientationModule()?.lockAsync;
    if (!lockAsync) return;

    const nextLock = isLandscapeLockedRef.current
      ? ORIENTATION_LOCK_PORTRAIT_UP
      : ORIENTATION_LOCK_LANDSCAPE;

    void lockAsync(nextLock).then(() => {
      isLandscapeLockedRef.current = !isLandscapeLockedRef.current;
    });
  }, []);

  return { toggleOrientation };
};

export { useAttachmentsViewerOrientation };
