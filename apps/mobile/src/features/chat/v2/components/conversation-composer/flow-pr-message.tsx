import { memo, useCallback, useMemo, useState, type ReactElement } from 'react';
import { Linking, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { BottomSheetScrollView, BottomSheetView } from '@gorhom/bottom-sheet';
import { GitBranch } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';

import { AppBottomSheet } from '@/src/components/ui/app-bottom-sheet';
import { Button } from '@/src/components/ui/button';
import { isSafeFlowLink, type FlowComponentLike } from '@/src/utils/flowJsonMarkdown';
import {
  createPrCardViewModel,
  prDescPreviewText,
  type PrBadgeTone,
  type PrCardViewModel,
} from '@/src/utils/flowPrUtils';

import { useConversationComposer } from './conversation-composer-context';
import { FlowCardBody } from './flow-card';

type FlowPrMessageProps = {
  component: FlowComponentLike;
  containerStyle?: StyleProp<ViewStyle>;
  renderMarkdown: (
    markdown: string,
    key: string,
    style?: StyleProp<ViewStyle>,
  ) => ReactElement | null;
  renderNestedMarkdown?: (markdown: string, key: string) => ReactElement | null;
};

const usePrBadgeColors = (): Record<PrBadgeTone, { bg: string; fg: string }> => {
  const createdBg = useCSSVariable('--color-pr-badge-created-bg') as string;
  const createdFg = useCSSVariable('--color-pr-badge-created-fg') as string;
  const mergedBg = useCSSVariable('--color-pr-badge-merged-bg') as string;
  const mergedFg = useCSSVariable('--color-pr-badge-merged-fg') as string;
  const dangerBg = useCSSVariable('--color-pr-badge-danger-bg') as string;
  const dangerFg = useCSSVariable('--color-pr-badge-danger-fg') as string;

  return useMemo(
    () => ({
      created: { bg: createdBg, fg: createdFg },
      merged: { bg: mergedBg, fg: mergedFg },
      danger: { bg: dangerBg, fg: dangerFg },
    }),
    [createdBg, createdFg, dangerBg, dangerFg, mergedBg, mergedFg],
  );
};

const StatusBadge = ({
  viewModel,
  colors,
}: {
  viewModel: PrCardViewModel;
  colors: Record<PrBadgeTone, { bg: string; fg: string }>;
}): ReactElement => {
  const tone = colors[viewModel.badgeTone];
  return (
    <View
      style={{
        alignSelf: 'flex-start',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        borderRadius: 6,
        paddingHorizontal: 8,
        paddingVertical: 4,
        backgroundColor: tone.bg,
      }}
    >
      <GitBranch size={14} color={tone.fg} />
      <Text style={{ color: tone.fg, fontSize: 13, fontWeight: '600' }}>
        {viewModel.statusLabel}
      </Text>
    </View>
  );
};

const FlowPrMessageComponent = ({
  component,
  containerStyle,
  renderMarkdown,
  renderNestedMarkdown,
}: FlowPrMessageProps): ReactElement | null => {
  const { suppressBubblePress } = useConversationComposer();
  const badgeColors = usePrBadgeColors();
  const borderColor = useCSSVariable('--color-border') as string;
  const [detailsOpen, setDetailsOpen] = useState(false);

  const viewModel = createPrCardViewModel(component);

  const openExternalUrl = useCallback(
    (url: string): void => {
      suppressBubblePress();
      if (!isSafeFlowLink(url)) return;
      void Linking.openURL(url);
    },
    [suppressBubblePress],
  );

  if (!viewModel) return null;

  const prUrl = viewModel.url;
  const descPreview = viewModel.desc ? prDescPreviewText(viewModel.desc) : '';

  return (
    <FlowCardBody containerStyle={containerStyle} gap={0}>
      <View
        className='overflow-hidden rounded-xl border border-border bg-chat-card'
        style={{ alignSelf: 'stretch', width: '100%', minWidth: 0 }}
      >
        <View style={{ gap: 10, paddingHorizontal: 12, paddingVertical: 12, minWidth: 0 }}>
          <StatusBadge viewModel={viewModel} colors={badgeColors} />
          <Text className='text-[15px] font-semibold leading-5 text-foreground'>
            {viewModel.title}
          </Text>
          {descPreview ? (
            <Text className='text-sm leading-5 text-foreground' numberOfLines={2}>
              {descPreview}
            </Text>
          ) : null}
        </View>

        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 8,
            paddingHorizontal: 12,
            paddingVertical: 10,
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: borderColor,
          }}
        >
          <Button
            size='xs'
            label='View Details'
            variant='secondary'
            onPressIn={event => {
              event.stopPropagation();
              suppressBubblePress();
            }}
            onPress={event => {
              event.stopPropagation();
              suppressBubblePress();
              setDetailsOpen(true);
            }}
          />
          {prUrl ? (
            <Button
              size='xs'
              label={viewModel.openProviderLabel}
              variant='secondary'
              onPressIn={event => {
                event.stopPropagation();
                suppressBubblePress();
              }}
              onPress={event => {
                event.stopPropagation();
                openExternalUrl(prUrl);
              }}
            />
          ) : null}
        </View>
      </View>

      {detailsOpen ? (
        <AppBottomSheet
          isOpen={detailsOpen}
          onOpenChange={setDetailsOpen}
          mode='snap'
          snapPoints={['75%']}
          backdropOpacity={0.45}
        >
          <BottomSheetView style={{ flex: 1 }}>
            <BottomSheetScrollView
              contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24, gap: 12 }}
            >
              <StatusBadge viewModel={viewModel} colors={badgeColors} />
              <Text className='text-lg font-semibold leading-6 text-foreground'>
                {viewModel.title}
              </Text>
              {viewModel.desc
                ? (renderNestedMarkdown?.(viewModel.desc, 'pr-desc') ??
                  renderMarkdown(viewModel.desc, 'pr-desc'))
                : null}
              {prUrl ? (
                <Button
                  size='xs'
                  label={viewModel.openProviderLabel}
                  variant='primary'
                  onPress={() => openExternalUrl(prUrl)}
                />
              ) : null}
            </BottomSheetScrollView>
          </BottomSheetView>
        </AppBottomSheet>
      ) : null}
    </FlowCardBody>
  );
};

const FlowPrMessage = memo(FlowPrMessageComponent);
FlowPrMessage.displayName = 'FlowPrMessage';

export { FlowPrMessage };
