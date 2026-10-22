import { type ReactElement } from 'react';
import { View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import type { MarkdownStyle } from 'react-native-enriched-markdown';

import { createWriteApprovalViewModel, isWriteApprovalFlow } from '@/src/utils/flowApprovalUtils';

import { FlowWriteApprovalCard } from './FlowWriteApprovalCard';
import { renderFlowActionButton } from './FlowActionButtonRenderer';
import type { FlowActionContext, RenderMarkdown } from './FlowRendererTypes';
import type { FlowDefinitionLike } from '@/src/utils/flowJsonMarkdown';

export const renderFlowWriteApproval = ({
  activeFlow,
  containerStyle,
  markdownStyle,
  renderMarkdown,
  ...actionContext
}: {
  activeFlow: FlowDefinitionLike;
  containerStyle?: StyleProp<ViewStyle>;
  markdownStyle: MarkdownStyle;
  renderMarkdown: RenderMarkdown;
} & FlowActionContext): ReactElement | null => {
  const viewModel = isWriteApprovalFlow(activeFlow)
    ? createWriteApprovalViewModel(activeFlow, actionContext.normalizeText)
    : null;
  if (!viewModel) return null;

  const titleStyle: Pick<TextStyle, 'fontSize' | 'lineHeight'> = {
    fontSize: markdownStyle.paragraph?.fontSize,
    lineHeight: markdownStyle.paragraph?.lineHeight,
  };
  return (
    <View style={[{ minWidth: 0, maxWidth: '100%' }, containerStyle]}>
      <FlowWriteApprovalCard
        viewModel={viewModel}
        titleStyle={titleStyle}
        renderMarkdown={(markdown, key) => renderMarkdown(markdown, key)}
        renderButton={button => renderFlowActionButton(button, actionContext)}
      />
    </View>
  );
};
