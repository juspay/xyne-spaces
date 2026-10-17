import { useRouter } from 'expo-router';
import { type ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';

import type { ParentPreview, PreviewSegment } from '../../model/chatRow.types';
import { PARENT_PREVIEW_HEIGHT_PX } from '../../model/buildPreviews';
import { useChatRenderTokens } from '../../theme/ChatRenderProvider';
import { CustomEmoji } from '../CustomEmoji';

const PARENT_EMOJI_SIZE = 18;

const Segment = ({ segment, mine }: { segment: PreviewSegment; mine: boolean }): ReactElement => {
  const tokens = useChatRenderTokens();
  if (segment.kind === 'emoji') {
    return (
      <CustomEmoji
        emojiId={segment.emojiId}
        name={segment.name}
        {...(segment.uri ? { uri: segment.uri } : {})}
        size={PARENT_EMOJI_SIZE}
      />
    );
  }
  if (segment.kind === 'link' || segment.kind === 'mention') {
    return (
      <Text
        className='text-xs font-medium'
        style={{ color: mine ? tokens.embeddedTitleUser : tokens.foregroundMuted }}
      >
        {segment.text}
      </Text>
    );
  }
  return (
    <Text
      className='text-xs font-medium'
      style={{ color: mine ? tokens.embeddedTitleUser : tokens.foregroundMuted }}
    >
      {segment.text}
    </Text>
  );
};

export function ParentPreviewCard({
  preview,
  mine,
  channelId,
}: {
  preview: ParentPreview;
  mine: boolean;
  channelId: string;
}): ReactElement {
  const tokens = useChatRenderTokens();
  const router = useRouter();

  return (
    <Pressable
      accessibilityRole='button'
      accessibilityLabel={`Replied to thread, ${preview.text}`}
      className={`mb-2 overflow-hidden rounded-md px-2 py-1.5 active:opacity-90 ${
        mine ? '' : 'bg-conversation-composer-forwarded-bg-other'
      }`}
      style={{
        height: PARENT_PREVIEW_HEIGHT_PX,
        ...(mine ? { backgroundColor: tokens.embeddedBgUser } : {}),
      }}
      onPress={(): void => {
        if (!channelId || !preview.conversationId) return;
        router.push({
          pathname: '/chat/[channelId]/[threadId]',
          params: {
            channelId,
            threadId: preview.conversationId,
            from: 'channel_thread',
            openStartedAtMs: String(Date.now()),
            ...(preview.messageId ? { messageId: preview.messageId } : {}),
          },
        });
      }}
    >
      <View className='w-full flex-col gap-1'>
        <Text
          className='text-xs font-medium'
          style={{ color: mine ? tokens.embeddedMutedUser : tokens.foreground }}
          numberOfLines={1}
        >
          Replied to thread:{' '}
        </Text>
        {preview.segments.some(segment => segment.kind === 'emoji') ? (
          <View
            className='flex-row flex-wrap items-center'
            style={{ height: 18, overflow: 'hidden' }}
          >
            {preview.segments.map((segment, index) => (
              <Segment
                key={`${segment.kind}:${index}:${segment.text}`}
                segment={segment}
                mine={mine}
              />
            ))}
          </View>
        ) : (
          <Text
            className='text-xs font-medium'
            numberOfLines={2}
            ellipsizeMode='tail'
            style={{ color: mine ? tokens.embeddedTitleUser : tokens.foregroundMuted }}
          >
            {preview.text}
          </Text>
        )}
      </View>
    </Pressable>
  );
}
