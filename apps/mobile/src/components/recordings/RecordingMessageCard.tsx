import { useAuthContextValues } from '@/src/contexts/AuthContext';
// Shared recording pill from the conversation renderer (PR #339).
import { memo, useCallback, useEffect, useState, type ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Mic } from 'lucide-react-native';
import { cn } from '@/src/utils/cn';
import { formatAttachmentDuration } from '@/src/features/chat/v2/components/conversation-composer/attachment-layout';
import type { ChatRenderTokens } from '@/src/theme/chatRenderTokens';
import type { RecordingPreview } from '@/src/types/recordings';

export const RecordingMessageCard = memo(function RecordingMessageCard({
  recording,
  isCurrentUser,
  tokens,
}: {
  recording: RecordingPreview;
  tokens: ChatRenderTokens;
  isCurrentUser: boolean;
}): ReactElement | null {
  const router = useRouter();
  const { userID } = useAuthContextValues();
  const canView = !recording.isActive || (!!userID && recording.createdBy === userID);
  const { embeddedBgUser, embeddedTitleUser, embeddedMutedUser, ambientAccentColor } = tokens;
  const openRecording = useCallback(async (): Promise<void> => {
    if (!canView) return;
    const { getRecordingState } = await import('@/src/stores/recordingStore');
    const active = getRecordingState();
    if (
      recording.isActive &&
      active.externalId === recording.callId &&
      (active.status === 'recording' || active.status === 'stopping')
    ) {
      router.push('/(protected)/(shortcuts)/recordings');
      return;
    }
    router.push({
      pathname: '/recording/[recordingId]',
      params: { recordingId: recording.callId },
    });
  }, [router, recording, canView]);

  return (
    <Pressable
      disabled={!canView}
      accessibilityState={{ disabled: !canView }}
      accessibilityRole='button'
      accessibilityLabel={`Open recording: ${recording.title || 'Recording notes'}`}
      className={cn(
        'mb-2.5 flex-row items-center gap-2.5 self-stretch rounded-lg px-2.5 py-2',
        isCurrentUser ? '' : 'bg-conversation-composer-forwarded-bg-other',
      )}
      style={isCurrentUser ? { backgroundColor: embeddedBgUser } : undefined}
      onPress={openRecording}
    >
      <View
        className='h-8 w-8 shrink-0 items-center justify-center rounded-full'
        style={{ backgroundColor: `${ambientAccentColor}26` }}
      >
        <Mic size={16} color={ambientAccentColor} strokeWidth={2.2} />
      </View>
      <View className='min-w-0 flex-1 flex-col'>
        <Text
          className={cn('text-sm font-medium', isCurrentUser ? '' : 'text-foreground')}
          style={isCurrentUser ? { color: embeddedTitleUser } : undefined}
          numberOfLines={1}
        >
          {recording.title || 'Recording shared'}
        </Text>
        <Text
          className={cn('text-xs', isCurrentUser ? '' : 'text-tertiary')}
          numberOfLines={1}
          style={isCurrentUser ? { color: embeddedMutedUser } : undefined}
        >
          {recording.isActive
            ? canView
              ? 'Recording in progress · Tap to open'
              : 'Recording in progress'
            : formatAttachmentDuration(recording.durationMs / 1000)}
        </Text>
      </View>
      {recording.isActive && canView ? (
        <RecordingStopAction callId={recording.callId} color={ambientAccentColor} />
      ) : null}
    </Pressable>
  );
});

/** Only a locally owned recording exposes Stop; never stop a different session. */
function RecordingStopAction({
  callId,
  color,
}: {
  callId: string;
  color: string;
}): ReactElement | null {
  const [canStop, setCanStop] = useState(false);
  useEffect(() => {
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    void import('@/src/stores/recordingStore').then(store => {
      if (disposed) return;
      const update = (): void => {
        const current = store.getRecordingState();
        setCanStop(current.externalId === callId && current.status === 'recording');
      };
      unsubscribe = store.subscribeRecordingStore(update);
      update();
    });
    return (): void => {
      disposed = true;
      unsubscribe?.();
    };
  }, [callId]);
  if (!canStop) return null;
  return (
    <Pressable
      accessibilityRole='button'
      accessibilityLabel='Stop recording'
      className='min-h-11 items-center justify-center rounded-lg border border-foreground/15 px-3 active:opacity-70'
      onPress={async event => {
        event.stopPropagation();
        const store = await import('@/src/stores/recordingStore');
        const current = store.getRecordingState();
        if (current.externalId !== callId || current.status !== 'recording') return;
        store.sendRecordingAction({ type: 'stopRecording' });
      }}
    >
      <Text className='text-sm font-semibold' style={{ color }}>
        Stop
      </Text>
    </Pressable>
  );
}
