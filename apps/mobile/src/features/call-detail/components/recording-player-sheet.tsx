import { useEffect, useState, type ReactElement } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { BottomSheetView } from '@gorhom/bottom-sheet';

import { AppBottomSheet } from '@/src/components/ui/app-bottom-sheet';
import { RecordingPlayer } from '@/src/components/recordings/RecordingPlayer';

import { callDetailService } from '../services/call-detail-service';
import { formatOffset, type RecordedSpan } from '../utils/call-detail-format';

type LoadState = { status: 'loading' } | { status: 'ready'; uri: string } | { status: 'error' };

/** Plays one recorded session of the call, fetched on first open. */
export function RecordingPlayerSheet({
  span,
  index,
  callExternalId,
  onClose,
}: {
  span: RecordedSpan | null;
  index: number;
  callExternalId: string;
  onClose: () => void;
}): ReactElement {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const recordingId = span?.recordingId;
  const recordingType = span?.recordingType;

  useEffect(() => {
    if (!recordingId || !recordingType) return;
    let cancelled = false;
    setState({ status: 'loading' });
    callDetailService
      .downloadCallRecording(callExternalId, recordingId, recordingType)
      .then(uri => {
        if (!cancelled) setState({ status: 'ready', uri });
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error' });
      });
    return (): void => {
      cancelled = true;
    };
  }, [callExternalId, recordingId, recordingType, attempt]);

  return (
    <AppBottomSheet isOpen={span !== null} onOpenChange={open => !open && onClose()} mode='dynamic'>
      <BottomSheetView style={{ paddingHorizontal: 20, paddingBottom: 36, gap: 14 }}>
        <View className='pt-1'>
          <Text className='text-lg font-semibold text-foreground' numberOfLines={1}>
            {span?.name || `Recording ${index + 1}`}
          </Text>
          {span ? (
            <Text className='text-[13px] text-secondary-foreground mt-0.5'>
              {`${span.kind === 'video' ? 'Screen / video' : 'Audio'} · ${formatOffset(span.startSeconds)} – ${formatOffset(span.endSeconds)} into the call`}
            </Text>
          ) : null}
        </View>
        {state.status === 'ready' && span ? (
          <RecordingPlayer uri={state.uri} recordingType={span.recordingType} />
        ) : state.status === 'error' ? (
          <View className='gap-3 py-2'>
            <Text className='text-sm text-secondary-foreground'>Couldn’t load this recording.</Text>
            <Pressable
              onPress={() => setAttempt(value => value + 1)}
              className='self-start rounded-full bg-secondary px-4 h-9 justify-center active:opacity-70'
            >
              <Text className='text-[13px] font-medium text-foreground'>Try again</Text>
            </Pressable>
          </View>
        ) : (
          <View className='py-8 items-center gap-2'>
            <ActivityIndicator />
            <Text className='text-[13px] text-secondary-foreground'>Downloading recording…</Text>
          </View>
        )}
      </BottomSheetView>
    </AppBottomSheet>
  );
}
