import { memo, type ReactElement } from 'react';
import { View } from 'react-native';
import type { MarkdownStyle } from 'react-native-enriched-markdown';

import type { FlowDefinitionLike } from '@/src/utils/flowJsonMarkdown';

import type { FlowJsonPart, MessageRowModel } from '../../model/chatRow.types';
import { htmlToMD } from '../../model/text/htmlToMD';
import { FlowJsonMessageBody } from './FlowJsonMessageBody';
import type { BlockMarkdownVariant } from '../blockMarkdownStyle';
import { FlowMarkdown } from './FlowMarkdown';

type FlowJsonRendererProps = {
  model: MessageRowModel;
  parts: readonly FlowJsonPart[];
  markdownStyle: MarkdownStyle;
  mine: boolean;
  onOpenUrl: (url: string) => void;
  markdownVariant?: BlockMarkdownVariant;
};

const FlowJsonRendererComponent = ({
  model,
  parts,
  markdownStyle,
  mine,
  onOpenUrl,
  markdownVariant,
}: FlowJsonRendererProps): ReactElement => (
  <View style={{ minWidth: 0, maxWidth: '100%' }}>
    {parts.map((part, index) => {
      if (part.type === 'flow') {
        const flow = part.definition as FlowDefinitionLike;
        return (
          <FlowJsonMessageBody
            key={`${String(flow.screenId ?? 'flow')}-${index}`}
            flow={flow}
            model={model}
            markdownStyle={markdownStyle}
            {...(markdownVariant ? { markdownVariant } : {})}
            mine={mine}
            onOpenUrl={onOpenUrl}
            containerStyle={{ minWidth: 0, maxWidth: '100%' }}
          />
        );
      }
      const markdown = htmlToMD(part.html);
      if (!markdown.trim()) return null;
      return (
        <FlowMarkdown
          key={`flow-surrounding-${index}`}
          markdown={markdown}
          inheritedContainerStyle={{ minWidth: 0, maxWidth: '100%' }}
          mine={mine}
          viewerId={model.viewerId}
          onOpenUrl={onOpenUrl}
          {...(markdownVariant ? { variant: markdownVariant } : {})}
        />
      );
    })}
  </View>
);

export const FlowJsonRenderer = memo(FlowJsonRendererComponent);
