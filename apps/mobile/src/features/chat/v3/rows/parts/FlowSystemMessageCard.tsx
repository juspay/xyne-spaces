import { useMemo, type ReactElement } from 'react';
import type { MarkdownStyle } from 'react-native-enriched-markdown';
import { View } from 'react-native';

import { useMentionPress } from '@/src/components/conversation-composer/utils/useMentionPress';

import type { ChatMessageRow } from '../../model/chatRow.types';
import { buildBlockMarkdownStyle } from '../blockMarkdownStyle';
import { FlowJsonRenderer } from './FlowJsonRenderer';
import { useChatRenderTokens } from '../../theme/ChatRenderProvider';

type FlowSystemMessageCardProps = {
  row: ChatMessageRow;
};

/**
 * Flow-JSON SYSTEM messages keep the V2 system surface, but render through the
 * V3 Flow renderer so controls and state remain row-owned and recycler-safe.
 */
export function FlowSystemMessageCard({ row }: FlowSystemMessageCardProps): ReactElement | null {
  const tokens = useChatRenderTokens();
  const onOpenUrl = useMentionPress();
  const markdownStyle = useMemo(
    (): MarkdownStyle =>
      buildBlockMarkdownStyle({
        foreground: tokens.systemText,
        foregroundMuted: tokens.foregroundMuted,
        cardBg: tokens.cardBg,
        brand: tokens.brand,
        link: tokens.systemText,
        inlineCodeBackground: tokens.cardBg,
        inlineCodeForeground: tokens.systemText,
        tableHeaderBackground: tokens.tableHeaderBg,
        tableBorderColor: tokens.tableBorderColor,
        variant: 'system',
      }),
    [
      tokens.systemText,
      tokens.foregroundMuted,
      tokens.cardBg,
      tokens.brand,
      tokens.tableHeaderBg,
      tokens.tableBorderColor,
    ],
  );

  if (row.model.body.flowParts.length === 0) return null;

  return (
    <View className='my-4 max-w-[95%] self-center rounded-lg bg-conversation-composer-system-bg p-1.5 light:shadow-[0px_1px_0.5px_0px_rgba(0,0,0,0.06)]'>
      <FlowJsonRenderer
        model={row.model}
        parts={row.model.body.flowParts}
        markdownStyle={markdownStyle}
        markdownVariant='system'
        mine={false}
        onOpenUrl={url => {
          void onOpenUrl(url);
        }}
      />
    </View>
  );
}
