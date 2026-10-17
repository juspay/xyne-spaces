import { memo, useMemo, type ReactElement } from 'react';
import { View } from 'react-native';
import { EnrichedMarkdownText, type MarkdownStyle } from 'react-native-enriched-markdown';
import { useCSSVariable } from 'uniwind';

import {
  buildComposerMarkdownStyle,
  COMPOSER_MD4C_FLAGS,
} from '@/src/features/chat/v2/components/conversation-composer/utils/markdownStyle';
import { htmlToMD } from '@/src/features/chat/v2/components/conversation-composer/utils/htmlToMD';
import { prepareChatMarkdownForMd4c } from '@/src/utils/htmlParagraphsToMarkdown';

import { callSummaryFormat } from '../utils/call-detail-format';

function resolveColor(value: string | undefined, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0 && !value.startsWith('var(')
    ? value
    : fallback;
}

/** The call's short AI summary (markdown or legacy HTML) as enriched markdown. */
export const MarkdownSummary = memo(function MarkdownSummary({
  summary,
}: {
  summary: string;
}): ReactElement {
  const foreground = useCSSVariable('--color-foreground') as string;
  const muted = useCSSVariable('--color-secondary-foreground') as string;
  const cardBg = useCSSVariable('--color-card') as string;
  const brand = useCSSVariable('--color-brand') as string;
  const link = useCSSVariable('--color-action-primary') as string;

  const markdown = useMemo(() => {
    const source = callSummaryFormat(summary) === 'html' ? htmlToMD(summary) : summary;
    return prepareChatMarkdownForMd4c(source.trim());
  }, [summary]);

  const style = useMemo<MarkdownStyle>(() => {
    const base = buildComposerMarkdownStyle({
      foreground: resolveColor(foreground, '#202124'),
      foregroundMuted: resolveColor(muted, '#5f6368'),
      cardBg: resolveColor(cardBg, '#ffffff'),
      brand: resolveColor(brand, '#1B8755'),
      linkColor: resolveColor(link, '#1a73e8'),
      variant: 'activity',
    });
    return {
      ...base,
      paragraph: { ...base.paragraph, marginBottom: 10, fontSize: 15, lineHeight: 23 },
    };
  }, [foreground, muted, cardBg, brand, link]);

  return (
    <View>
      <EnrichedMarkdownText
        md4cFlags={COMPOSER_MD4C_FLAGS}
        markdown={markdown}
        markdownStyle={style}
        selectable
      />
    </View>
  );
});
