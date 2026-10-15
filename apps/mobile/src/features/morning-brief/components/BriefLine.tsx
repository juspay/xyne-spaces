import { memo, useMemo, type ReactElement } from 'react';
import { View } from 'react-native';
import { EnrichedMarkdownText } from 'react-native-enriched-markdown';

import { COMPOSER_MD4C_FLAGS } from '@/src/features/chat/v2/components/conversation-composer/utils/markdownStyle';

import type { BriefCitation } from '../api/dailyBriefApi';
import type { BriefRenderContext } from '../hooks/useBriefRenderContext';
import { prepareBriefLine } from '../utils/briefText';
import { BriefCitationChips } from './CitationChip';

export type BriefLineHandlers = {
  /** Inline link taps: mentions, ticket ids, plain URLs. */
  onLinkPress: (url: string) => void;
  /** A single trailing citation chip. */
  onPressCitation: (citation: BriefCitation) => void;
  /** A grouped "+N" chip — opens the sources sheet. */
  onPressGroup: (citations: BriefCitation[]) => void;
};

type BriefLineProps = {
  line: string;
  context: BriefRenderContext;
  handlers: BriefLineHandlers;
};

/**
 * One brief line: the ported text pipeline turns mentions/ticket ids into
 * inline `xyne://` links and EXTRACTS citation tokens, which render as real
 * chip components after the prose (native markdown text cannot host the web's
 * icon chips inline). Returns null when the pipeline empties the line out.
 */
export const BriefLine = memo(function BriefLine({
  line,
  context,
  handlers,
}: BriefLineProps): ReactElement | null {
  const prepared = useMemo(
    () => prepareBriefLine(line, context.lineContext),
    [line, context.lineContext],
  );

  if (!prepared.markdown && prepared.citationRuns.length === 0) return null;

  return (
    <View>
      {prepared.markdown !== null && (
        <EnrichedMarkdownText
          markdown={prepared.markdown}
          markdownStyle={context.markdownStyle}
          md4cFlags={COMPOSER_MD4C_FLAGS}
          onLinkPress={event => handlers.onLinkPress(event.url)}
          selectable={false}
        />
      )}
      <BriefCitationChips
        runs={prepared.citationRuns}
        resolveCitation={context.resolveCitation}
        onPressCitation={handlers.onPressCitation}
        onPressGroup={handlers.onPressGroup}
        palette={context.palette}
      />
    </View>
  );
});
