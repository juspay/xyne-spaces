import { useCallback, useMemo, type ReactElement } from 'react';
import { Pressable, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from '@/src/components/ui/safe-area-view';
import { LegendList } from '@legendapp/list/react-native';
import { Stack, useRouter } from 'expo-router';
import { Check } from 'lucide-react-native';
import { HeaderBackButton } from '@/src/components/ui/header-icon-button';
import { useCSSVariable } from 'uniwind';

import { useSetting } from '@/src/machines/settingsMachine';
import { haptics } from '@/src/utils/haptics';
import {
  CHAT_BUBBLE_COLOR_VARS,
  CHAT_BUBBLE_PICKER_OPTIONS,
  type ChatBubbleOption,
} from '@/src/theme/chatBubbleTheme';

const GRID_COLUMNS = 4;
const GRID_GAP = 28;
const HORIZONTAL_PADDING = 30;
const MAX_SWATCH_SIZE = 62;
const MIN_SWATCH_SIZE = 34;
const SELECTED_RING_EXTRA_SIZE = 12;
const ROW_GAP = 34;

const resolveColor = (value: string | undefined, fallback: string): string =>
  value && value.trim().length > 0 && !value.startsWith('var(') ? value : fallback;

type ChatBubbleColors = {
  bg: string;
  label: string;
};

const useChatBubbleColors = (): ChatBubbleColors => {
  const bg = useCSSVariable('--color-settings-bg') as string;
  const label = useCSSVariable('--color-settings-label') as string;

  return useMemo(() => ({ bg, label }), [bg, label]);
};

type ChatBubbleSwatchProps = {
  option: ChatBubbleOption;
  color: string;
  colors: ChatBubbleColors;
  size: number;
  isSelected: boolean;
  onPress: () => void;
};

const ChatBubbleSwatch = ({
  option,
  color,
  colors,
  size,
  isSelected,
  onPress,
}: ChatBubbleSwatchProps): ReactElement => {
  const ringSize = size + SELECTED_RING_EXTRA_SIZE;

  return (
    <Pressable
      accessibilityRole='button'
      accessibilityState={{ selected: isSelected }}
      accessibilityLabel={`Preview chat bubble color ${option.index + 1}`}
      onPress={() => {
        if (!isSelected) void haptics.selection();
        onPress();
      }}
      className='items-center justify-center active:opacity-70'
      style={{
        width: ringSize,
        height: ringSize,
      }}
    >
      {isSelected ? (
        <View
          pointerEvents='none'
          className='absolute rounded-full border-[3px] border-settings-label'
          style={{
            width: ringSize,
            height: ringSize,
          }}
        />
      ) : null}
      <View
        className='items-center justify-center rounded-full'
        style={{
          width: size,
          height: size,
          backgroundColor: color,
        }}
      >
        {isSelected ? (
          <View
            className='items-center justify-center rounded-full bg-settings-bg'
            style={{
              width: size * 0.38,
              height: size * 0.38,
            }}
          >
            <Check size={size * 0.24} color={colors.label} strokeWidth={4} />
          </View>
        ) : null}
      </View>
    </Pressable>
  );
};

export default function ChatBubbleSettingsScreen(): ReactElement {
  const router = useRouter();
  const colors = useChatBubbleColors();
  const { height, width } = useWindowDimensions();
  const selectedBubbleColorVar = useSetting('chatTheme.bubbleColorVar');
  const cssColors = useCSSVariable(CHAT_BUBBLE_COLOR_VARS as unknown as string[]) as string[];
  const availableSwatchSize = Math.floor(
    (width - HORIZONTAL_PADDING * 2 - GRID_GAP * (GRID_COLUMNS - 1)) / GRID_COLUMNS -
      SELECTED_RING_EXTRA_SIZE,
  );
  const swatchSize = Math.max(MIN_SWATCH_SIZE, Math.min(MAX_SWATCH_SIZE, availableSwatchSize));
  const ringSize = swatchSize + SELECTED_RING_EXTRA_SIZE;
  const estimatedListHeight = Math.max(1, height - 56);

  const resolvedColors = useMemo(
    () =>
      CHAT_BUBBLE_PICKER_OPTIONS.map(option =>
        resolveColor(cssColors?.[option.index], option.lightColor),
      ),
    [cssColors],
  );
  const listExtraData = useMemo(
    () => ({
      colors,
      resolvedColors,
      selectedBubbleColorVar,
      swatchSize,
    }),
    [colors, resolvedColors, selectedBubbleColorVar, swatchSize],
  );
  const getFixedItemSize = useCallback(() => ringSize, [ringSize]);

  return (
    <SafeAreaView style={{ flex: 1 }} className='bg-settings-bg' edges={['top', 'bottom']}>
      <Stack.Screen
        options={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}
      />
      <View className='min-h-14 flex-row items-center gap-2 border-b border-settings-row-divider px-2'>
        <HeaderBackButton liquidGlass onPress={() => router.back()} iconColor={colors.label} />
        <Text
          className='flex-1 text-[20px] font-medium leading-8 text-settings-label'
          numberOfLines={1}
        >
          Chat bubble
        </Text>
      </View>
      <LegendList
        data={CHAT_BUBBLE_PICKER_OPTIONS}
        numColumns={GRID_COLUMNS}
        keyExtractor={item => item.varName}
        estimatedItemSize={ringSize}
        estimatedListSize={{ height: estimatedListHeight, width }}
        getFixedItemSize={getFixedItemSize}
        extraData={listExtraData}
        recycleItems
        showsVerticalScrollIndicator={false}
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingBottom: 36,
          paddingHorizontal: HORIZONTAL_PADDING,
          paddingTop: 24,
        }}
        columnWrapperStyle={{
          columnGap: GRID_GAP,
          rowGap: ROW_GAP,
        }}
        renderItem={({ item: option, index }) => (
          <View className='items-center justify-center' style={{ height: ringSize }}>
            <ChatBubbleSwatch
              option={option}
              color={resolvedColors[index] ?? option.lightColor}
              colors={colors}
              size={swatchSize}
              isSelected={selectedBubbleColorVar === option.varName}
              onPress={() =>
                router.push({
                  pathname: '/settings/chat-theme/chat-bubble-preview',
                  params: { initialIndex: String(index) },
                })
              }
            />
          </View>
        )}
      />
    </SafeAreaView>
  );
}
