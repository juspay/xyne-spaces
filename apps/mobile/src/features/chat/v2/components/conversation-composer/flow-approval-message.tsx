import { memo, type ReactElement } from 'react';
import { View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

import type { WriteApprovalViewModel } from '@/src/utils/flowApprovalUtils';
import type { FlowActionButton } from '@/src/utils/flowAction';

import { FlowCardBody, FlowCardHeader } from './flow-card';
import { PARAGRAPH_LINE_HEIGHT } from './utils/markdownStyle';

type FlowWriteApprovalMessageProps = {
  viewModel: WriteApprovalViewModel;
  titleStyle: TextStyle;
  containerStyle?: StyleProp<ViewStyle>;
  renderMarkdown: (
    markdown: string,
    key: string,
    style?: StyleProp<ViewStyle>,
  ) => ReactElement | null;
  renderNestedMarkdown?: (markdown: string, key: string) => ReactElement | null;
  renderButton: (button: FlowActionButton) => ReactElement;
};

const FlowWriteApprovalMessageComponent = ({
  viewModel,
  titleStyle,
  containerStyle,
  renderMarkdown,
  renderNestedMarkdown,
  renderButton,
}: FlowWriteApprovalMessageProps): ReactElement => {
  const hasBodyBelowHeader =
    viewModel.intro.trim().length > 0 || viewModel.actionBodyMarkdown.trim().length > 0;

  return (
    <FlowCardBody containerStyle={containerStyle} gap={8}>
      <FlowCardHeader
        title={viewModel.title}
        titleStyle={{
          fontSize: titleStyle.fontSize,
          lineHeight: titleStyle.lineHeight ?? PARAGRAPH_LINE_HEIGHT,
        }}
        {...(hasBodyBelowHeader ? { containerStyle: { marginBottom: 2 } } : {})}
      />

      {viewModel.intro.trim()
        ? (renderNestedMarkdown?.(viewModel.intro, 'write-approval-intro') ??
          renderMarkdown(viewModel.intro, 'write-approval-intro'))
        : null}

      {viewModel.actionBodyMarkdown.trim() ? (
        <View
          className='overflow-hidden rounded-md border border-border bg-chat-card p-2'
          style={{ alignSelf: 'stretch', width: '100%', minWidth: 0 }}
        >
          {renderNestedMarkdown?.(viewModel.actionBodyMarkdown, 'write-approval-body') ??
            renderMarkdown(viewModel.actionBodyMarkdown, 'write-approval-body')}
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
};

const FlowWriteApprovalMessage = memo(FlowWriteApprovalMessageComponent);
FlowWriteApprovalMessage.displayName = 'FlowWriteApprovalMessage';

export { FlowWriteApprovalMessage };
