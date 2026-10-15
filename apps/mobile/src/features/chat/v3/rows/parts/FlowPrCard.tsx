import { GitBranch } from 'lucide-react-native';
import { memo, useCallback, type ReactElement } from 'react';
import { Linking, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { BottomSheetScrollView, BottomSheetView } from '@gorhom/bottom-sheet';

import { AppBottomSheet } from '@/src/components/ui/app-bottom-sheet';
import { Button } from '@/src/components/ui/button';
import { isSafeFlowLink, type FlowComponentLike } from '@/src/utils/flowJsonMarkdown';
import {
  createPrCardViewModel,
  prDescPreviewText,
  type PrBadgeTone,
  type PrCardViewModel,
} from '@/src/utils/flowPrUtils';

import { useChatRenderTokens } from '../../theme/ChatRenderProvider';
import { useRecyclingState } from '../useRecyclingState';
import { FlowCardBody } from './FlowCard';

type RenderMarkdown = (markdown: string, key: string) => ReactElement | null;

const StatusBadge = ({
  viewModel,
  palette,
}: {
  viewModel: PrCardViewModel;
  palette: Record<PrBadgeTone, { background: string; foreground: string }>;
}): ReactElement => {
  const badge = palette[viewModel.badgeTone];
  return (
    <View
      className='self-start flex-row items-center gap-1.5 rounded-md px-2 py-1'
      style={{ backgroundColor: badge.background }}
    >
      <GitBranch size={14} color={badge.foreground} />
      <Text style={{ color: badge.foreground, fontSize: 13, fontWeight: '600' }}>
        {viewModel.statusLabel}
      </Text>
    </View>
  );
};

export const FlowPrCard = memo(function FlowPrCard({
  component,
  containerStyle,
  renderMarkdown,
  recyclingKey,
}: {
  component: FlowComponentLike;
  containerStyle?: StyleProp<ViewStyle>;
  renderMarkdown: RenderMarkdown;
  recyclingKey: string;
}): ReactElement | null {
  const tokens = useChatRenderTokens();
  const [detailsOpen, setDetailsOpen] = useRecyclingState(`${recyclingKey}:pr-details`, false);
  const viewModel = createPrCardViewModel(component);

  const openExternalUrl = useCallback((url: string): void => {
    if (!isSafeFlowLink(url)) return;
    void Linking.openURL(url);
  }, []);

  if (!viewModel) return null;

  const descriptionPreview = viewModel.desc ? prDescPreviewText(viewModel.desc) : '';
  return (
    <FlowCardBody containerStyle={containerStyle} gap={0}>
      <View
        className='overflow-hidden rounded-xl border border-border bg-chat-card'
        style={{ alignSelf: 'stretch', width: '100%', minWidth: 0 }}
      >
        <View style={{ gap: 10, paddingHorizontal: 12, paddingVertical: 12, minWidth: 0 }}>
          <StatusBadge viewModel={viewModel} palette={tokens.prBadgePalette} />
          <Text className='text-[15px] font-semibold leading-5 text-foreground'>
            {viewModel.title}
          </Text>
          {descriptionPreview ? (
            <Text className='text-sm leading-5 text-foreground' numberOfLines={2}>
              {descriptionPreview}
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
            borderTopColor: tokens.borderColor,
          }}
        >
          <Button
            size='xs'
            label='View Details'
            variant='secondary'
            onPressIn={event => event.stopPropagation()}
            onPress={event => {
              event.stopPropagation();
              setDetailsOpen(true);
            }}
          />
          {viewModel.url ? (
            <Button
              size='xs'
              label={viewModel.openProviderLabel}
              variant='secondary'
              onPressIn={event => event.stopPropagation()}
              onPress={event => {
                event.stopPropagation();
                openExternalUrl(viewModel.url ?? '');
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
              <StatusBadge viewModel={viewModel} palette={tokens.prBadgePalette} />
              <Text className='text-lg font-semibold leading-6 text-foreground'>
                {viewModel.title}
              </Text>
              {viewModel.desc ? renderMarkdown(viewModel.desc, 'pr-desc') : null}
              {viewModel.url ? (
                <Button
                  size='xs'
                  label={viewModel.openProviderLabel}
                  variant='primary'
                  onPress={() => openExternalUrl(viewModel.url ?? '')}
                />
              ) : null}
            </BottomSheetScrollView>
          </BottomSheetView>
        </AppBottomSheet>
      ) : null}
    </FlowCardBody>
  );
});
FlowPrCard.displayName = 'FlowPrCard';
