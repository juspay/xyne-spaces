import { useEffect, useRef } from 'react';
import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { Alert, AppState, Platform } from 'react-native';
import { isValidShareId, ShareTargetNative } from './nativeShareTarget';

function parseShareId(url: string): string | null {
  try {
    const parsed = Linking.parse(url);
    if (parsed.hostname === 'share-target' || parsed.path === 'share-target') {
      const id = parsed.queryParams?.['id'];
      return isValidShareId(id) ? id : null;
    }
  } catch {
    return null;
  }
  return null;
}

function openShareRoute(shareId?: string | null): void {
  router.push({
    pathname: '/(protected)/share-target',
    params: shareId ? { shareId } : {},
  } as never);
}

export function useIncomingShareTarget(): void {
  const openedIdsRef = useRef(new Set<string>());
  const lastTooManyFilesAlertAtRef = useRef(0);

  useEffect(() => {
    if (Platform.OS === 'ios') {
      return;
    }

    let cancelled = false;

    const showTooManyFilesAlert = (message: string): void => {
      const now = Date.now();
      if (now - lastTooManyFilesAlertAtRef.current < 1000) return;
      lastTooManyFilesAlertAtRef.current = now;
      Alert.alert('Too many files', message);
    };

    const openOnce = (shareId?: string | null): void => {
      const key = shareId || 'android-initial';
      if (openedIdsRef.current.has(key)) return;
      openedIdsRef.current.add(key);
      openShareRoute(shareId);
    };

    const checkPendingNativeShare = (): void => {
      void ShareTargetNative.getInitialShare(null)
        .then(payload => {
          if (cancelled || !payload) return;
          openOnce(payload.id);
        })
        .catch(error => {
          if (cancelled || error?.code !== 'SHARE_TOO_MANY_FILES') return;
          showTooManyFilesAlert(error.message);
        });
    };

    const nativeUnsub = ShareTargetNative.addReceivedListener(payload => {
      openOnce(payload.id);
    });
    const nativeErrorUnsub = ShareTargetNative.addErrorListener(error => {
      if (cancelled || error.code !== 'SHARE_TOO_MANY_FILES') return;
      showTooManyFilesAlert(error.message);
    });

    void Linking.getInitialURL().then(url => {
      if (cancelled || !url) return;
      const id = parseShareId(url);
      if (id) openOnce(id);
    });

    checkPendingNativeShare();

    const urlSub = Linking.addEventListener('url', event => {
      const id = parseShareId(event.url);
      if (id) openOnce(id);
    });

    const appStateSub = AppState.addEventListener('change', state => {
      if (state === 'active') {
        checkPendingNativeShare();
      }
    });

    return (): void => {
      cancelled = true;
      urlSub.remove();
      appStateSub.remove();
      nativeUnsub();
      nativeErrorUnsub();
    };
  }, []);
}
