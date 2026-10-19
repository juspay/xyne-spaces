import { memo, type ReactElement } from 'react';
import { View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

import type { WriteApprovalViewModel } from '@/src/utils/flowApprovalUtils';
import type { FlowActionButton } from '@/src/utils/flowAction';

import { FlowCardBody, FlowCardHeader } from './FlowCard';

type RenderMarkdown = (markdown: string, key: string) => ReactElement | null;

export const FlowWriteApprovalCard = memo(function FlowWriteApprovalCard({
  viewModel,
  titleStyle,
  containerStyle,
  renderMarkdown,
  renderButton,
}: {
  viewModel: WriteApprovalViewModel;
  titleStyle: Pick<TextStyle, 'fontSize' | 'lineHeight'>;
  containerStyle?: StyleProp<ViewStyle>;
  renderMarkdown: RenderMarkdown;
  renderButton: (button: FlowActionButton) => ReactElement;
}): ReactElement {
  const hasBodyBelowHeader =
    viewModel.intro.trim().length > 0 || viewModel.actionBodyMarkdown.trim().length > 0;
  return (
    <FlowCardBody containerStyle={containerStyle} gap={8}>
      <FlowCardHeader
        title={viewModel.title}
        titleStyle={{ fontSize: titleStyle.fontSize, lineHeight: titleStyle.lineHeight ?? 20 }}
        {...(hasBodyBelowHeader ? { containerStyle: { marginBottom: 2 } } : {})}
      />
      {viewModel.intro.trim() ? renderMarkdown(viewModel.intro, 'write-approval-intro') : null}
      {viewModel.actionBodyMarkdown.trim() ? (
        <View
          className='overflow-hidden rounded-md border border-border bg-chat-card p-2'
          style={{ alignSelf: 'stretch', width: '100%', minWidth: 0 }}
        >
          {renderMarkdown(viewModel.actionBodyMarkdown, 'write-approval-body')}
        </View>
      ) : null}
      {viewModel.buttons.length > 0 ? (
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: 8,
            marginTop: 2,
            minWidth: 0,
            maxWidth: '100%',
          }}
        >
          {viewModel.buttons.map(button => renderButton(button))}
        </View>
      ) : null}
    </FlowCardBody>
  );
});
FlowWriteApprovalCard.displayName = 'FlowWriteApprovalCard';
