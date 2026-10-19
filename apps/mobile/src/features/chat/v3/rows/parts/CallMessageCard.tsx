import { useRouter } from 'expo-router';
import { Headphones } from 'lucide-react-native';
import { memo, useCallback, type ReactElement } from 'react';
import { Pressable, Text, View, type GestureResponderEvent } from 'react-native';

import type { MessageRowModel } from '../../model/chatRow.types';
import { callThreadOpen, type CallThreadView } from '../../screens/callThreadOpen';
import { useChatRenderTokens } from '../../theme/ChatRenderProvider';

const formatStartTime = (createdAt: number): string =>
  new Date(createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

const formatDuration = (durationMs: number): string => {
  if (durationMs < 60_000) {
    return `${Math.max(1, Math.floor(durationMs / 1000))}s`;
  }
  return `${Math.floor(durationMs / 60_000)}min`;
};

export const CallMessageCard = memo(function CallMessageCard({
  model,
}: {
  model: MessageRowModel;
}): ReactElement | null {
  const call = model.callPreview;
  const router = useRouter();
  const tokens = useChatRenderTokens();

  const openThread = useCallback(
    (view: CallThreadView): void => {
      if (!model.channelId || !model.conversationId) {
        return;
      }
      router.push(callThreadOpen(model, view));
    },
    [model, router],
  );
  const onSummaryPress = useCallback(
    (event: GestureResponderEvent): void => {
      event.stopPropagation();
      openThread('summary');
    },
    [openThread],
  );
  const onTranscriptPress = useCallback(
    (event: GestureResponderEvent): void => {
      event.stopPropagation();
      openThread('transcript');
    },
    [openThread],
  );

  if (!call) {
    return null;
  }

  const duration = call.durationMs === null ? null : formatDuration(call.durationMs);

  return (
    <View className='w-[80%] self-center rounded-2xl bg-conversation-composer-call-bg p-2 light:shadow-[0px_1px_0.5px_0px_rgba(0,0,0,0.06)]'>
      <View className='flex-row items-start gap-2 rounded-lg bg-conversation-composer-call-pill-bg p-1.5'>
        <View className='items-center justify-center rounded-full bg-conversation-composer-call-icon-bg p-1'>
          <Headphones size={20} color={tokens.callIconColor} />
        </View>
        <View className='min-w-0 flex-1 gap-1'>
          <Text
            numberOfLines={1}
            className='text-sm font-medium leading-[1.2] text-conversation-composer-call-title'
          >
            {call.title}
          </Text>
          <View className='flex-row items-center gap-1'>
            <Text className='text-xs font-medium leading-[1.35] text-conversation-composer-call-meta'>
              {formatStartTime(model.createdAt)}
            </Text>
            {duration ? (
              <>
                <Text className='text-xs font-medium leading-[1.35] text-conversation-composer-call-meta'>
                  ·
                </Text>
                <Text className='text-xs font-medium leading-[1.35] text-conversation-composer-call-meta'>
                  {duration}
                </Text>
              </>
            ) : null}
          </View>
        </View>
      </View>
      <View className='my-1.5 h-px w-full bg-conversation-composer-call-divider' />
      <View className='w-full flex-row items-center justify-around'>
        <Pressable
          accessibilityRole='button'
          accessibilityLabel='View call summary'
          className='items-center justify-center py-1'
          onPress={onSummaryPress}
        >
          <Text className='text-xs font-semibold' style={{ color: tokens.linkColor }}>
            View Summary
          </Text>
        </Pressable>
        <View className='w-px self-stretch bg-conversation-composer-call-divider' />
        <Pressable
          accessibilityRole='button'
          accessibilityLabel='View call transcript'
          className='items-center justify-center py-1'
          onPress={onTranscriptPress}
        >
          <Text className='text-xs font-semibold' style={{ color: tokens.linkColor }}>
            View Transcript
          </Text>
        </Pressable>
      </View>
    </View>
  );
});
