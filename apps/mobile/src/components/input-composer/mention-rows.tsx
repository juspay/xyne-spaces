import { memo, useCallback, type ReactElement, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Hash, Lock } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';

import type { MentionChannelOption, MentionUserOption } from './utils/mentions';
import { cn } from '@/src/utils/cn';
import Avatar from '@/src/components/ui/avatar';

export const MentionEmpty = ({ label }: { label: string }): ReactElement => (
  <View className='px-4 py-6'>
    <Text className='text-center text-sm text-secondary-foreground'>{label}</Text>
  </View>
);

export const MentionPanel = ({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}): ReactElement => (
  <View
    className={cn(
      'mx-2 mb-2 overflow-hidden rounded-[18px] border-[0.5px] border-border bg-card z-10',
      className,
    )}
  >
    {children}
  </View>
);

type ChannelRowProps = {
  item: MentionChannelOption;
  onSelectItem: (item: MentionChannelOption) => void;
};

type UserRowProps = {
  item: MentionUserOption;
  onSelectItem: (item: MentionUserOption) => void;
};

export const MentionChannelRow = memo(function MentionChannelRow({
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

export const MentionUserRow = memo(function MentionUserRow({
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
