import { LegendList } from '@legendapp/list/react-native';
import { memo, useCallback, type ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Hash, Lock } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';

import { useInputComposerMentions } from './hooks/useInputComposerMentions';
import { useChatInputMentionState } from './input-composer-context';
import type { MentionChannelOption, MentionListItem, MentionUserOption } from './utils/mentions';
import { cn } from '@/src/utils/cn';
import Avatar from '@/src/components/ui/avatar';

type MentionsProps = {
  className?: string;
};

type ChannelRowProps = {
  item: MentionChannelOption;
  onSelectItem: (item: MentionListItem) => void;
};

type UserRowProps = {
  item: MentionUserOption;
  onSelectItem: (item: MentionListItem) => void;
};

const MentionChannelRow = memo(function MentionChannelRow({
  item,
  onSelectItem,
}: ChannelRowProps): ReactElement {
  const foreground = useCSSVariable('--color-foreground') as string;
  const handlePress = useCallback(() => onSelectItem(item), [item, onSelectItem]);

  return (
    <Pressable
      onPress={handlePress}
      className='flex-row items-center gap-3 px-4 py-3 active:bg-accent'
    >
      <View className='size-7 items-center justify-center rounded-md'>
        {item.isPrivate ? (
          <Lock size={15} color={foreground} />
        ) : (
          <Hash size={15} color={foreground} />
        )}
      </View>
      <View className='flex-1 min-w-0'>
        <Text className='font-medium text-foreground' numberOfLines={1}>
          #{item.name}
        </Text>
      </View>
    </Pressable>
  );
});

const MentionUserRow = memo(function MentionUserRow({
  item,
  onSelectItem,
}: UserRowProps): ReactElement {
  const handlePress = useCallback(() => onSelectItem(item), [item, onSelectItem]);

  return (
    <Pressable
      onPress={handlePress}
      className='flex-row items-center gap-3 px-4 py-3 active:bg-accent'
    >
      {item.type === 'special' ? (
        <View className='size-7 items-center justify-center rounded-full border border-orange-200 bg-orange-50'>
          <Text className='text-base leading-none'>
            {item.mentionType === 'channel' ? '📢' : '👋'}
          </Text>
        </View>
      ) : item.type === 'group' ? (
        <View className='size-7 items-center justify-center rounded-full border border-green-200 bg-green-50'>
          <Text className='text-base leading-none'>👥</Text>
        </View>
      ) : (
        <Avatar userIds={[item.id]} size={28} />
      )}
      <View className='flex-1 min-w-0'>
        <Text className='font-medium text-foreground' numberOfLines={1}>
          {item.type === 'special'
            ? `@${item.name}`
            : item.type === 'group'
              ? `@${item.alias || item.name}`
              : item.name}
        </Text>
        {item.type === 'user' && item.email ? (
          <Text className='text-xs text-secondary-foreground' numberOfLines={1}>
            {item.email}
          </Text>
        ) : item.description ? (
          <Text className='text-xs text-secondary-foreground' numberOfLines={1}>
            {item.description}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
});

const OpenMentionsList = ({ className }: MentionsProps): ReactElement => {
  const { isChannelMode, items, onSelectItem } = useInputComposerMentions();

  const renderItem = useCallback(
    ({ item }: { item: MentionListItem }): ReactElement =>
      item.type === 'channel' ? (
        <MentionChannelRow item={item} onSelectItem={onSelectItem} />
      ) : (
        <MentionUserRow item={item} onSelectItem={onSelectItem} />
      ),
    [onSelectItem],
  );

  return (
    <View
      className={cn(
        'mx-2 mb-2 overflow-hidden rounded-[18px] border-[0.5px] border-border bg-card z-10',
        className,
      )}
    >
      <LegendList
        style={{ maxHeight: 200 }}
        data={items}
        keyExtractor={item => item.id}
        keyboardShouldPersistTaps='handled'
        nestedScrollEnabled
        showsVerticalScrollIndicator={false}
        renderItem={renderItem}
        ListEmptyComponent={
          <View className='px-4 py-6'>
            <Text className='text-center text-sm text-secondary-foreground'>
              {isChannelMode ? 'No channels found' : 'No people found'}
            </Text>
          </View>
        }
      />
    </View>
  );
};

const MentionsListComponent = ({ className }: MentionsProps): ReactElement | null => {
  const { isMentionOpen } = useChatInputMentionState();
  if (!isMentionOpen) return null;
  return <OpenMentionsList {...(className !== undefined ? { className } : {})} />;
};

export const MentionsList = memo(MentionsListComponent);

export type { MentionUserOption, MentionChannelOption };
MentionsList.displayName = 'ChatInput.MentionsList';
