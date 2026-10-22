import { memo, useEffect, useState, type ReactElement } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ChevronDown, ExternalLink, FileText, RefreshCw, Sparkles } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';

import { haptics } from '@/src/utils/haptics';
import { openDashboardCanvas } from '@/src/utils/canvasUrl';
import { cn } from '@/src/utils/cn';

import type { CallSummaryTab } from '../hooks/use-call-detail-data';
import { useCanvasDocument } from '../hooks/use-canvas-document';
import { CanvasDocumentView, type CitationTarget } from './canvas-document-view';
import { MarkdownSummary } from './markdown-summary';

function ShimmerLines(): ReactElement {
  const widths = ['92%', '78%', '85%', '60%', '88%', '70%'] as const;
  return (
    <View className='gap-3 pt-1' accessibilityLabel='Loading summary'>
      <View className='h-5 w-1/2 rounded-md bg-secondary' />
      {widths.map((width, index) => (
        <View key={index} className='h-3.5 rounded-md bg-secondary' style={{ width }} />
      ))}
    </View>
  );
}

function CanvasTabContent({
  tab,
  nonce,
  aiSummary,
  onCitationPress,
}: {
  tab: CallSummaryTab;
  nonce: number;
  aiSummary: string | null;
  onCitationPress: (citation: CitationTarget) => void;
}): ReactElement {
  const router = useRouter();
  const muted = useCSSVariable('--color-secondary-foreground') as string;
  const foreground = useCSSVariable('--color-foreground') as string;
  const document = useCanvasDocument(tab.canvasId, nonce);

  const openFullCanvas = (): void => {
    void haptics.buttonTap();
    openDashboardCanvas(router, tab.canvasId);
  };

  const openButton = (
    <Pressable
      onPress={openFullCanvas}
      accessibilityRole='button'
      className='flex-row items-center gap-1.5 self-start rounded-full border border-border px-3 h-8 active:opacity-70'
    >
      <ExternalLink size={13} color={foreground} />
      <Text className='text-[12.5px] font-medium text-foreground'>Open full canvas</Text>
    </Pressable>
  );

  if (document.status === 'loading') return <ShimmerLines />;

  if (document.status === 'ready') {
    return (
      <View className='gap-5'>
        <CanvasDocumentView blocks={document.blocks} onCitationPress={onCitationPress} />
        {openButton}
      </View>
    );
  }

  // Y-Sweet unreachable or the canvas is still empty: show what the call row has.
  const isSummaryTab = tab.kind === 'detailed-summary';
  return (
    <View className='gap-4'>
      {isSummaryTab && aiSummary ? (
        <MarkdownSummary summary={aiSummary} />
      ) : (
        <Text className='text-sm leading-5' style={{ color: muted }}>
          {document.status === 'empty'
            ? isSummaryTab
              ? 'The detailed summary is still being written. Check back in a moment.'
              : 'This PRD is still being generated.'
            : "Couldn't load this canvas here."}
        </Text>
      )}
      <View className='flex-row flex-wrap gap-2'>
        {openButton}
        <Pressable
          onPress={document.reload}
          accessibilityRole='button'
          className='flex-row items-center gap-1.5 rounded-full border border-border px-3 h-8 active:opacity-70'
        >
          <RefreshCw size={13} color={foreground} />
          <Text className='text-[12.5px] font-medium text-foreground'>Retry</Text>
        </Pressable>
      </View>
    </View>
  );
}

export interface SummaryPanelProps {
  tabs: CallSummaryTab[];
  isLoading: boolean;
  aiSummary: string | null;
  canvasNonce: number;
  templateLabel: string;
  templateIcon: string;
  isGenerating: boolean;
  generatingLabel: string | null;
  canChangeTemplate: boolean;
  onTemplatePress: () => void;
  onCitationPress: (citation: CitationTarget) => void;
}

export const SummaryPanel = memo(function SummaryPanel({
  tabs,
  isLoading,
  aiSummary,
  canvasNonce,
  templateLabel,
  templateIcon,
  isGenerating,
  generatingLabel,
  canChangeTemplate,
  onTemplatePress,
  onCitationPress,
}: SummaryPanelProps): ReactElement {
  const muted = useCSSVariable('--color-secondary-foreground') as string;
  const foreground = useCSSVariable('--color-foreground') as string;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const activeTab = tabs.find(tab => tab.id === selectedId) ?? tabs[0] ?? null;

  useEffect(() => {
    if (selectedId && !tabs.some(tab => tab.id === selectedId)) setSelectedId(null);
  }, [selectedId, tabs]);

  return (
    <View className='gap-4'>
      <View className='flex-row items-center gap-2'>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          className='flex-1'
          contentContainerStyle={{ gap: 6, paddingRight: 4 }}
        >
          {tabs.length === 0 ? (
            <View className='flex-row items-center gap-1.5 h-8 rounded-full bg-secondary px-3'>
              <Sparkles size={13} color={foreground} />
              <Text className='text-[12.5px] font-medium text-foreground'>Summary</Text>
            </View>
          ) : (
            tabs.map(tab => {
              const isActive = tab.id === activeTab?.id;
              const isSummary = tab.kind === 'detailed-summary';
              return (
                <Pressable
                  key={tab.id}
                  accessibilityRole='tab'
                  accessibilityState={{ selected: isActive }}
                  onPress={(): void => {
                    void haptics.selection();
                    if (isActive && isSummary && canChangeTemplate) {
                      onTemplatePress();
                      return;
                    }
                    setSelectedId(tab.id);
                  }}
                  className={cn(
                    'flex-row items-center gap-1.5 h-8 rounded-full px-3 border',
                    isActive ? 'bg-secondary border-border' : 'border-transparent',
                  )}
                >
                  {isSummary ? (
                    isGenerating ? (
                      <ActivityIndicator
                        size='small'
                        color={foreground}
                        style={{ transform: [{ scale: 0.7 }] }}
                      />
                    ) : (
                      <Text className='text-[12px]'>{templateIcon}</Text>
                    )
                  ) : (
                    <FileText size={13} color={isActive ? foreground : muted} />
                  )}
                  <Text
                    numberOfLines={1}
                    className={cn(
                      'text-[12.5px] font-medium max-w-[160px]',
                      isActive ? 'text-foreground' : 'text-secondary-foreground',
                    )}
                  >
                    {isSummary
                      ? isGenerating && generatingLabel
                        ? generatingLabel
                        : templateLabel
                      : tab.title}
                  </Text>
                  {isSummary && canChangeTemplate ? (
                    <ChevronDown size={13} color={isActive ? foreground : muted} />
                  ) : null}
                </Pressable>
              );
            })
          )}
        </ScrollView>
      </View>

      <View className='h-px bg-border' />

      {isLoading ? (
        <ShimmerLines />
      ) : activeTab ? (
        <CanvasTabContent
          key={`${activeTab.canvasId}:${activeTab.kind === 'detailed-summary' ? canvasNonce : 0}`}
          tab={activeTab}
          nonce={activeTab.kind === 'detailed-summary' ? canvasNonce : 0}
          aiSummary={aiSummary}
          onCitationPress={onCitationPress}
        />
      ) : aiSummary ? (
        <MarkdownSummary summary={aiSummary} />
      ) : (
        <Text className='text-sm leading-5' style={{ color: muted }}>
          No detailed summary available for this call.
        </Text>
      )}
    </View>
  );
});
