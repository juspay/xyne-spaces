import { memo, useState, type ReactElement } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { BottomSheetScrollView, BottomSheetView } from '@gorhom/bottom-sheet';
import { Maximize2 } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';

import { AppBottomSheet } from '@/src/components/ui/app-bottom-sheet';
import type { FlowComponentLike } from '@/src/utils/flowJsonMarkdown';
import { createChartViewModel } from '@/src/utils/flowChartUtils';

import { useConversationComposer } from './conversation-composer-context';
import { FlowCardBody } from './flow-card';
import { FlowChartBody } from './flow-chart-body';

const CHART_HEIGHT_PX = 220;
const CHART_PREVIEW_HEIGHT_PX = 420;

type FlowChartMessageProps = {
  component: FlowComponentLike;
  containerStyle?: StyleProp<ViewStyle>;
  /** When true, hide the expand control (nested preview). */
  hideExpand?: boolean;
};

const FlowChartMessageComponent = ({
  component,
  containerStyle,
  hideExpand = false,
}: FlowChartMessageProps): ReactElement | null => {
  const { suppressBubblePress } = useConversationComposer();
  const muted = useCSSVariable('--color-foreground') as string;
  const borderColor = useCSSVariable('--color-border') as string;
  const cardColor = useCSSVariable('--color-chat-card') as string;
  const [expanded, setExpanded] = useState(false);

  const viewModel = createChartViewModel(component);
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
          {!hideExpand ? (
            <Pressable
              accessibilityRole='button'
              accessibilityLabel='Expand chart'
              hitSlop={8}
              onPressIn={event => {
                event.stopPropagation();
                suppressBubblePress();
              }}
              onPress={event => {
                event.stopPropagation();
                setExpanded(true);
              }}
              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, padding: 2 })}
            >
              <Maximize2 size={16} color={muted} />
            </Pressable>
          ) : null}
        </View>

        <View
          style={{
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: borderColor,
            paddingHorizontal: 8,
            paddingVertical: 12,
          }}
        >
          <FlowChartBody
            viewModel={viewModel}
            height={CHART_HEIGHT_PX}
            mutedColor={muted}
            borderColor={borderColor}
            cardColor={cardColor}
          />
        </View>

        {viewModel.caption ? (
          <View
            style={{
              borderTopWidth: StyleSheet.hairlineWidth,
              borderTopColor: borderColor,
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
              <View
                className='overflow-hidden rounded-xl border border-border bg-chat-card'
                style={{ paddingHorizontal: 8, paddingVertical: 12 }}
              >
                <FlowChartBody
                  viewModel={viewModel}
                  height={CHART_PREVIEW_HEIGHT_PX}
                  mutedColor={muted}
                  borderColor={borderColor}
                  cardColor={cardColor}
                />
              </View>
              {viewModel.caption ? (
                <Text className='text-xs leading-4 text-foreground'>{viewModel.caption}</Text>
              ) : null}
            </BottomSheetScrollView>
          </BottomSheetView>
        </AppBottomSheet>
      ) : null}
    </FlowCardBody>
  );
};

const FlowChartMessage = memo(FlowChartMessageComponent);
FlowChartMessage.displayName = 'FlowChartMessage';

export { FlowChartMessage };
