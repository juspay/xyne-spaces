import { memo, useCallback, useMemo, type ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';

import type { DisplaySearchResult } from '@/src/types/search';
import { resolveSearchResultCreatedAtMs } from '@/src/utils/search';

import { useSenderIsAgent } from '../hooks/use-sender-is-agent';
import { findResultTime } from '../model/channel-find';
import { AgentTag } from './agent-tag';
import { SenderFace } from './message-avatar';
import {
  getMessageRowStyle,
  MESSAGE_HEADER_CLASS,
  MESSAGE_HEADER_STYLE,
  MESSAGE_META_TEXT_CLASS,
  MESSAGE_NAME_TEXT_CLASS,
} from './message-row-style';

type FindResultRowProps = {
  result: DisplaySearchResult;
  currentUserId: string | undefined;
  onPress: (result: DisplaySearchResult) => void;
};

/**
 * One match, drawn as the room draws a message (Figma "Room / Message"): the
 * 32 face, name and time, then the words. The words are the search index's
 * plain text, so mentions, files and reactions are not drawn here; the
 * message itself shows them once the room lands on it.
 */
export const FindResultRow = memo(function FindResultRow({
  result,
  currentUserId,
  onPress,
}: FindResultRowProps): ReactElement {
  const context = result.searchContext;
  const senderId = context?.senderId ?? result.avatar ?? '';
  const senderName = context?.senderName ?? '';
  const isSelf = senderId.length > 0 && senderId === currentUserId;
  const isAgent = useSenderIsAgent(senderId);
  const name = isSelf ? 'You' : senderName;
  const words = result.context ?? '';
  const createdAt = resolveSearchResultCreatedAtMs(result);
  const time = findResultTime(createdAt === undefined ? undefined : Number(createdAt), Date.now());

  const fallbackUser = useMemo(
    () => (senderId ? { id: senderId, name: senderName, displayName: senderName } : undefined),
    [senderId, senderName],
  );
  const handlePress = useCallback((): void => onPress(result), [onPress, result]);

  return (
    <Pressable
      accessibilityRole='button'
      accessibilityLabel={[name, time, words].filter(Boolean).join(', ')}
      accessibilityHint='Shows this message in the conversation'
      onPress={handlePress}
      className='flex-row'
      style={getMessageRowStyle}
    >
      <SenderFace
        userId={senderId}
        displayName={senderName}
        isSelf={isSelf}
        fallbackUser={fallbackUser}
      />
      <View className='min-w-0 flex-1'>
        <View className={MESSAGE_HEADER_CLASS} style={MESSAGE_HEADER_STYLE}>
          <Text className={MESSAGE_NAME_TEXT_CLASS} numberOfLines={1}>
            {name}
          </Text>
          {isAgent ? <AgentTag /> : null}
          {time ? <Text className={`shrink-0 ${MESSAGE_META_TEXT_CLASS}`}>{time}</Text> : null}
        </View>
        <Text className='text-[16px] leading-[22px] tracking-[-0.176px] text-spaces-foreground'>
          {words}
        </Text>
      </View>
    </Pressable>
  );
});
