import { memo, type ReactElement } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useCSSVariable } from 'uniwind';

import { useBubbleAccent } from '@/src/theme/useBubbleAccent';

import { GuideIcon } from '../guide-icons';
import type { GuideCategory, MobileGuide } from '../types';
import { GuideRows } from './guide-list-rows';

const CONTENT_HORIZONTAL_PADDING = 16;

export type UserGuideTopicViewProps = {
  /** Null when the route's category id is unknown. */
  category: GuideCategory | null;
  guides: readonly MobileGuide[];
  onOpenGuide: (guide: MobileGuide) => void;
};

/** One topic's header and its guide list, given as props. */
export const UserGuideTopicView = memo(function UserGuideTopicView({
  category,
  guides,
  onOpenGuide,
}: UserGuideTopicViewProps): ReactElement {
  const { accentSoft, accentText } = useBubbleAccent();
  const labelColor = useCSSVariable('--color-settings-label') as string;
  const descriptionColor = useCSSVariable('--color-settings-description') as string;

  if (!category) {
    return (
      <View className='flex-1 items-center justify-center px-8 pb-24'>
        <Text className='text-center text-[17px] font-semibold' style={{ color: labelColor }}>
          This topic is not available
        </Text>
      </View>
    );
  }

  return (
    <ScrollView
      className='flex-1'
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: CONTENT_HORIZONTAL_PADDING, paddingBottom: 40 }}
    >
      <View className='mt-1 flex-row items-center gap-3'>
        <View
          className='h-11 w-11 items-center justify-center rounded-xl'
          style={{ backgroundColor: accentSoft }}
        >
          <GuideIcon name={category.icon} size={22} color={accentText} />
        </View>
        <View className='flex-1'>
          <Text
            className='text-[24px] font-bold leading-7'
            style={{ color: labelColor }}
            accessibilityRole='header'
          >
            {category.title}
          </Text>
          <Text className='mt-0.5 text-[14px]' style={{ color: descriptionColor }}>
            {category.description}
          </Text>
        </View>
      </View>

      <View className='mt-6'>
        <GuideRows guides={guides} onOpen={onOpenGuide} />
      </View>
    </ScrollView>
  );
});
