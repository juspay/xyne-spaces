import { memo, useMemo } from 'react';
import { Text, View } from 'react-native';
import { EnrichedMarkdownText, type MarkdownStyle } from 'react-native-enriched-markdown';
import { useCSSVariable } from 'uniwind';

import {
  buildComposerMarkdownStyle,
  COMPOSER_MD4C_FLAGS,
} from '@/src/features/chat/v2/components/conversation-composer/utils/markdownStyle';
import { prepareChatMarkdownForMd4c } from '@/src/utils/htmlParagraphsToMarkdown';

type EmailSummaryContentProps = {
  summary: string;
  keypoints: string[];
};

/**
 * Renders the AI summary as enriched markdown (paragraph + bullet keypoints).
 */
export const EmailSummaryContent = memo(function EmailSummaryContent({
  summary,
  keypoints,
}: EmailSummaryContentProps) {
  const foreground = useCSSVariable('--color-foreground') as string;
  const foregroundMuted = useCSSVariable('--color-secondary-foreground') as string;
  const cardBg = useCSSVariable('--color-card') as string;
  const brand = useCSSVariable('--color-brand') as string;
  const linkColor = useCSSVariable('--color-primary') as string;

  const markdown = useMemo(() => {
    const parts: string[] = [];
    const trimmedSummary = summary.trim();
    if (trimmedSummary) {
      parts.push(trimmedSummary);
    }
    if (keypoints.length > 0) {
      const bullets = keypoints.map(point => `- ${point}`).join('\n');
      parts.push(bullets);
    }
    return parts.join('\n\n');
  }, [keypoints, summary]);

  const markdownStyle = useMemo<MarkdownStyle>(() => {
    const base = buildComposerMarkdownStyle({
      foreground: resolveColor(foreground, '#202124'),
      foregroundMuted: resolveColor(foregroundMuted, '#5f6368'),
      cardBg: resolveColor(cardBg, '#ffffff'),
      brand: resolveColor(brand, '#1B8755'),
      linkColor: resolveColor(linkColor, '#1a73e8'),
      variant: 'activity',
    });
    return {
      ...base,
      paragraph: {
        ...base.paragraph,
        marginBottom: 10,
        fontSize: 15,
        lineHeight: 22,
      },
    };
  }, [foreground, foregroundMuted, cardBg, brand, linkColor]);

  if (!markdown.trim()) {
    return (
      <Text selectable={false} className='text-[15px] leading-5.5 text-secondary-foreground'>
        No summary available.
      </Text>
    );
  }

  return (
    <View>
      <EnrichedMarkdownText
        md4cFlags={COMPOSER_MD4C_FLAGS}
        markdown={prepareChatMarkdownForMd4c(markdown)}
        markdownStyle={markdownStyle}
        selectable={false}
      />
    </View>
  );
});

function resolveColor(value: string | undefined, fallback: string): string {
  if (typeof value === 'string' && value.trim().length > 0 && !value.startsWith('var(')) {
    return value;
  }
  return fallback;
}
