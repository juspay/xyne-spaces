import { memo, useCallback, type ReactElement } from 'react';
import { Pressable, Text, View, type GestureResponderEvent } from 'react-native';

import { useMentionPress } from '@/src/components/conversation-composer/utils/useMentionPress';
import { useZero } from '@/src/hooks/useZero';
import { mutators } from '@/src/zero/mutators';

import type { ChatMessageRow, MessageRowModel } from '../../model/chatRow.types';
import { formatNonParticipantMarkdown } from '../../model/nonParticipant';
import { useChatRenderTokens } from '../../theme/ChatRenderProvider';
import { BlockMarkdown } from '../BlockMarkdown';
import { useResolvedCustomEmojiMarkdown } from '../useResolvedCustomEmojiMarkdown';
import { useRecyclingState } from '../useRecyclingState';

type NonParticipantMessageCardProps = {
  row: ChatMessageRow;
};

const NonParticipantMessageCardView = ({
  row,
}: NonParticipantMessageCardProps): ReactElement | null => {
  const model: MessageRowModel = row.model;
  const preview = model.nonParticipantPreview;
  const zero = useZero();
  const onOpenUrl = useMentionPress();
  const tokens = useChatRenderTokens();
  const [isLoading, setIsLoading] = useRecyclingState(
    `${model.conversationId}:non-participant-loading`,
    false,
  );
  const [error, setError] = useRecyclingState<string | null>(
    `${model.conversationId}:non-participant-error`,
    null,
  );
  const markdown = formatNonParticipantMarkdown(model.body.markdown || model.body.plainText);
  const resolvedMarkdown = useResolvedCustomEmojiMarkdown(preview ? markdown : '');

  const runAction = useCallback(
    async (action: 'add_all' | 'ignore_all'): Promise<void> => {
      if (!preview || preview.userIds.length === 0 || !model.messageId) {
        return;
      }
      setError(null);
      setIsLoading(true);
      try {
        await zero.mutate(
          mutators.messages.handleNonParticipantAction({
            messageId: model.messageId,
            action,
            userIds: [...preview.userIds],
            channelId: preview.channelId,
          }),
        );
      } catch {
        setError(action === 'add_all' ? 'Failed to add users' : 'Failed to dismiss message');
      } finally {
        setIsLoading(false);
      }
    },
    [model.messageId, preview, setError, setIsLoading, zero],
  );

  const stopAndRun = useCallback(
    (action: 'add_all' | 'ignore_all') =>
      (event: GestureResponderEvent): void => {
        event.stopPropagation();
        void runAction(action);
      },
    [runAction],
  );

  if (!preview) {
    return null;
  }

  const showActions = preview.userIds.length > 0 && model.messageId !== null;
  const actionTextColor = tokens.linkColor;

  return (
    <View className='py-1 flex-row justify-center'>
      <View className='my-4 max-w-[95%] self-center rounded-lg bg-conversation-composer-system-bg p-1.5 gap-1.5 light:shadow-[0px_1px_0.5px_0px_rgba(0,0,0,0.06)]'>
        {markdown.trim() ? (
          <BlockMarkdown
            markdown={resolvedMarkdown}
            mine={false}
            viewerId={model.viewerId}
            variant='system'
            onOpenUrl={url => {
              void onOpenUrl(url);
            }}
          />
        ) : null}
        {error ? <Text className='text-xs font-medium text-status-danger'>{error}</Text> : null}
        {showActions ? (
          <>
            <View className='h-px w-full bg-conversation-composer-call-divider' />
            <View className='w-full flex-row items-center'>
              {preview.canAddMembers ? (
                <Pressable
                  accessibilityRole='button'
                  accessibilityLabel='Add mentioned users'
                  disabled={isLoading}
                  className='flex-1 items-center justify-center py-1'
                  onPress={stopAndRun('add_all')}
                >
                  <Text
                    className='text-xs font-semibold leading-[1.35]'
                    style={{ color: actionTextColor }}
                  >
                    {isLoading ? 'Adding…' : 'Add Them'}
                  </Text>
                </Pressable>
              ) : null}
              {preview.canAddMembers ? (
                <View className='w-px self-stretch bg-conversation-composer-call-divider' />
              ) : null}
              <Pressable
                accessibilityRole='button'
                accessibilityLabel={preview.canAddMembers ? 'Do nothing' : 'Dismiss message'}
                disabled={isLoading}
                className='flex-1 items-center justify-center py-1'
                onPress={stopAndRun('ignore_all')}
              >
                <Text
                  className='text-xs font-semibold leading-[1.35]'
                  style={{ color: actionTextColor }}
                >
                  {preview.canAddMembers ? 'Do Nothing' : 'Got it'}
                </Text>
              </Pressable>
            </View>
          </>
        ) : null}
      </View>
    </View>
  );
};

export const NonParticipantMessageCard = memo(NonParticipantMessageCardView);
NonParticipantMessageCard.displayName = 'NonParticipantMessageCard';
