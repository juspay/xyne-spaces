import { type ReactElement } from 'react';
import {
  ScrollView,
  View,
  type ScrollViewProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Badge } from '@/src/components/ui/badge';
import { haptics } from '@/src/utils/haptics';

export type ChatFilterTabOption<T extends string> = {
  value: T;
  label: string;
  count?: number;
};

interface ChatFilterTabsProps<T extends string> {
  tabs: ChatFilterTabOption<T>[];
  activeTab: T;
  onTabChange: (tab: T) => void;
  scrollable?: boolean;
  /**
   * Scrollable variant only. Global search floats this row over a results list
   * with the keyboard up, where the default `'never'` would spend the first tap
   * dismissing the keyboard instead of switching category.
   */
  keyboardShouldPersistTaps?: ScrollViewProps['keyboardShouldPersistTaps'];
  /** Scrollable variant only — merged over the default row padding. */
  style?: StyleProp<ViewStyle>;
  /** Scrollable variant only — merged over the default content padding. */
  contentContainerStyle?: StyleProp<ViewStyle>;
}

export const ChatFilterTabs = <T extends string>({
  tabs,
  activeTab,
  onTabChange,
  scrollable = false,
  keyboardShouldPersistTaps,
  style,
  contentContainerStyle,
}: ChatFilterTabsProps<T>): ReactElement => {
  const items = tabs.map(tab => {
    const isActive = activeTab === tab.value;
    return (
      <Badge
        key={tab.value}
        label={tab.label}
        count={tab.count}
        variant={isActive ? 'active' : 'default'}
        onPress={() => {
          if (!isActive) {
            void haptics.selection();
          }
          onTabChange(tab.value);
        }}
      />
    );
  });

  if (scrollable) {
    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        {...(keyboardShouldPersistTaps ? { keyboardShouldPersistTaps } : {})}
        style={style}
        contentContainerStyle={[
          {
            paddingVertical: 6,
            paddingHorizontal: 12,
            paddingBottom: 10,
            gap: 10,
          },
          contentContainerStyle,
        ]}
      >
        {items}
      </ScrollView>
    );
  }

  return <View className='flex-row gap-2'>{items}</View>;
};

export default ChatFilterTabs;
