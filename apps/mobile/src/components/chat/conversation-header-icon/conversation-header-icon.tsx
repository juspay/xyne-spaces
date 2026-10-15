import React from 'react';
import { View } from 'react-native';
import { Hash, Lock } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';

import Avatar from '@/src/components/ui/avatar';

/**
 * The leading identity glyph in a conversation's header pill: the other
 * participant's avatar for a DM, a lock or hash for everything else.
 *
 * Extracted from ChatHeaderV3 so the thread header renders the same identity
 * rather than a generic thread glyph — the two drifted apart once already.
 *
 * The presence dot is written inline rather than reusing the PresenceDot
 * primitive: that one has no background-coloured ring and sits a pixel further
 * out, and it opens its own presence subscription when callers already hold
 * `isOnline` from useConversationHeaderData.
 */
export type ConversationHeaderIconProps = {
  isDM: boolean;
  isChannel: boolean;
  isPrivateChannel: boolean;
  dmProfileUserId: string | null;
  isOnline: boolean;
};

const ConversationHeaderIcon: React.FC<ConversationHeaderIconProps> = ({
  isDM,
  isChannel,
  isPrivateChannel,
  dmProfileUserId,
  isOnline,
}) => {
  const foregroundColor = useCSSVariable('--color-foreground') as string;

  if (isDM) {
    return (
      <View className='relative '>
        <Avatar userIds={dmProfileUserId ? [dmProfileUserId] : []} size={20} />
        <View
          className={`absolute bottom-0 right-0 size-2 translate-x-px translate-y-px rounded-full border border-background ${
            isOnline ? 'bg-green-500' : 'bg-[#9CA3AF]'
          }`}
        />
      </View>
    );
  }
  if (isChannel) {
    if (isPrivateChannel) return <Lock color={foregroundColor} size={18} />;
    return <Hash color={foregroundColor} size={18} />;
  }
  return <Hash color={foregroundColor} size={18} />;
};

export default ConversationHeaderIcon;
