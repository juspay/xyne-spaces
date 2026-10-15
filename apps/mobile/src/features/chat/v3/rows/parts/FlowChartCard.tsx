import { Maximize2 } from 'lucide-react-native';
import { memo, useCallback, type ReactElement } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { BottomSheetScrollView, BottomSheetView } from '@gorhom/bottom-sheet';

import { AppBottomSheet } from '@/src/components/ui/app-bottom-sheet';
import { createChartViewModel, type ChartViewModel } from '@/src/utils/flowChartUtils';
import type { FlowComponentLike } from '@/src/utils/flowJsonMarkdown';

import { useChatRenderTokens } from '../../theme/ChatRenderProvider';
import { useRecyclingState } from '../useRecyclingState';
import { FlowCardBody } from './FlowCard';
import { FlowChartBody } from './FlowChartBody';

const CHART_HEIGHT_PX = 220;
const CHART_PREVIEW_HEIGHT_PX = 420;

const ChartSurface = ({
  viewModel,
  height,
  recyclingKey,
}: {
  viewModel: ChartViewModel;
  height: number;
  recyclingKey: string;
}): ReactElement => {
  const tokens = useChatRenderTokens();
  return (
    <View
      className='overflow-hidden rounded-xl border border-border bg-chat-card'
      style={{ paddingHorizontal: 8, paddingVertical: 12 }}
    >
      <FlowChartBody
        viewModel={viewModel}
        height={height}
        mutedColor={tokens.foreground}
        borderColor={tokens.borderColor}
        cardColor={tokens.chatCardColor}
        recyclingKey={recyclingKey}
      />
    </View>
  );
};
ChartSurface.displayName = 'ChartSurface';

export const FlowChartCard = memo(function FlowChartCard({
  component,
  containerStyle,
  recyclingKey,
}: {
  component: FlowComponentLike;
  containerStyle?: StyleProp<ViewStyle>;
  recyclingKey: string;
}): ReactElement | null {
  const tokens = useChatRenderTokens();
  const [expanded, setExpanded] = useRecyclingState(`${recyclingKey}:chart-expanded`, false);
  const viewModel = createChartViewModel(component);
  const openExpanded = useCallback(
    (event: GestureResponderEvent): void => {
      event.stopPropagation();
      setExpanded(true);
    },
    [setExpanded],
  );
  const stopPropagation = useCallback((event: GestureResponderEvent): void => {
    event.stopPropagation();
  }, []);

  if (!viewModel) return null;

  const expandTitle = viewModel.caption ?? 'Chart';

  return (
    <FlowCardBody containerStyle={containerStyle} gap={0}>
      <View
        className='overflow-hidden rounded-xl border border-border bg-chat-card'
        style={{ alignSelf: 'stretch', width: '100%', minWidth: 0 }}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            paddingHorizontal: 14,
            paddingVertical: 12,
          }}
        >
          <Text className='font-mono text-sm text-foreground' style={{ letterSpacing: 0.2 }}>
            Chart
          </Text>
          <Pressable
            accessibilityRole='button'
            accessibilityLabel='Expand chart'
            hitSlop={8}
            onPressIn={stopPropagation}
            onPress={openExpanded}
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, padding: 2 })}
          >
            <Maximize2 size={16} color={tokens.foreground} />
          </Pressable>
        </View>

        <View
          style={{
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: tokens.borderColor,
            paddingHorizontal: 8,
            paddingVertical: 12,
          }}
        >
          <FlowChartBody
            viewModel={viewModel}
            height={CHART_HEIGHT_PX}
            mutedColor={tokens.foreground}
            borderColor={tokens.borderColor}
            cardColor={tokens.chatCardColor}
            recyclingKey={`${recyclingKey}:preview`}
          />
        </View>

        {viewModel.caption ? (
          <View
            style={{
              borderTopWidth: StyleSheet.hairlineWidth,
              borderTopColor: tokens.borderColor,
              paddingHorizontal: 14,
              paddingVertical: 12,
            }}
          >
            <Text className='text-xs leading-4 text-foreground'>{viewModel.caption}</Text>
          </View>
        ) : null}
      </View>

      {expanded ? (
        <AppBottomSheet
          isOpen={expanded}
          onOpenChange={setExpanded}
          mode='snap'
          snapPoints={['85%']}
          backdropOpacity={0.45}
        >
          <BottomSheetView style={{ flex: 1 }}>
            <BottomSheetScrollView
              contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 28, gap: 12 }}
            >
              <Text className='text-base font-semibold text-foreground'>{expandTitle}</Text>
              <ChartSurface
                viewModel={viewModel}
                height={CHART_PREVIEW_HEIGHT_PX}
                recyclingKey={`${recyclingKey}:expanded`}
              />
              {viewModel.caption ? (
                <Text className='text-xs leading-4 text-foreground'>{viewModel.caption}</Text>
              ) : null}
            </BottomSheetScrollView>
          </BottomSheetView>
        </AppBottomSheet>
      ) : null}
    </FlowCardBody>
  );
});
FlowChartCard.displayName = 'FlowChartCard';
