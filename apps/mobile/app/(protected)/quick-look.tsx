import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { ActivityIndicator, Alert, Pressable, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import FileViewer from 'react-native-file-viewer';

import { cacheMtlsAttachmentFile } from '@/src/hooks/useMtlsAttachmentFile';

/**
 * Transient loading screen that downloads an attachment, hands it to the iOS
 * QuickLook previewer, then pops itself. Used for Office / unsupported docs so
 * tapping a file goes straight to a native preview with a spinner while it
 * downloads — no intermediate "Preview" screen.
 *
 * Self-pops on QuickLook dismiss (`onDismiss`). A visible Cancel control lets the
 * user escape a slow download and is also the safety net if `onDismiss` is ever
 * missed (they land back here and can tap out) — a focus-based fallback isn't
 * reliable because QuickLook is a native modal outside React Navigation.
 */
const QuickLookScreen = (): ReactElement => {
  const { id, filename } = useLocalSearchParams<{ id?: string; filename?: string }>();
  const startedRef = useRef(false);
  const cancelledRef = useRef(false);
  const [presented, setPresented] = useState(false);

  const dismissSelf = useCallback((): void => {
    if (router.canGoBack()) router.back();
  }, []);

  const cancel = useCallback((): void => {
    cancelledRef.current = true;
    dismissSelf();
  }, [dismissSelf]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    void (async (): Promise<void> => {
      try {
        if (!id) throw new Error('Missing attachment.');
        const displayName = filename && filename.length > 0 ? filename : undefined;
        const { uri } = await cacheMtlsAttachmentFile(id, displayName ?? null);
        if (cancelledRef.current) return;
        await FileViewer.open(uri, {
          ...(displayName ? { displayName } : {}),
          onDismiss: dismissSelf,
        });
        if (!cancelledRef.current) setPresented(true);
      } catch (error) {
        if (cancelledRef.current) return;
        Alert.alert(
          'Could not open file',
          error instanceof Error ? error.message : 'Failed to open this file.',
        );
        dismissSelf();
      }
    })();
  }, [id, filename, dismissSelf]);

  return (
    <Pressable onPress={cancel} className='flex-1'>
      {!presented ? (
        <View className='flex-1 items-center justify-center bg-black/60'>
          <ActivityIndicator size='large' color='#fff' />
          <Pressable
            onPress={cancel}
            hitSlop={12}
            className='mt-6 rounded-full bg-white/10 px-5 py-2.5'
          >
            <Text className='text-sm font-medium text-white'>Cancel</Text>
          </Pressable>
        </View>
      ) : null}
    </Pressable>
  );
};

export default QuickLookScreen;
