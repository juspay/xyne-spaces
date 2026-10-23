import type { ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';

import { useBubbleAccent } from '@/src/theme/useBubbleAccent';

interface CardHeaderProps {
  icon: LucideIcon;
  title: string;
  subtitle: string;
  /** Accent text button at the right, e.g. "See all". */
  action?: { label: string; onPress: () => void };
}

/** Header shared by the Internal and External cards: round icon tile, title and subtitle. */
export const CardHeader = ({ icon, title, subtitle, action }: CardHeaderProps): ReactElement => {
  const Icon = icon;
  const { accentText } = useBubbleAccent();
  const iconColor = useCSSVariable('--color-settings-description') as string;
  return (
    <View className='min-h-14 flex-row items-center gap-3 py-2.5 pl-3.5 pr-1.5'>
      <View className='size-9 items-center justify-center rounded-full bg-secondary'>
        <Icon size={17} color={iconColor} />
      </View>
      <View className='min-w-0 flex-1'>
        <Text className='text-base font-semibold text-foreground' numberOfLines={1}>
          {title}
        </Text>
        <Text className='text-xs text-secondary-foreground' numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
      {action ? (
        <Pressable
          accessibilityRole='button'
          onPress={action.onPress}
          className='h-11 justify-center px-2.5 active:opacity-70'
        >
          <Text className='text-sm font-semibold' style={{ color: accentText }}>
            {action.label}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
};
