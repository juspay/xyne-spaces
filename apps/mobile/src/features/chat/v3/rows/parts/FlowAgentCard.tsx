import { memo, type ReactElement } from 'react';
import { Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

import Avatar from '@/src/components/ui/avatar';
import { useUserSnapshot } from '@/src/components/ui/avatar/avatar.utils';
import type { AgentCardViewModel } from '@/src/utils/flowAgentUtils';
import type { FlowActionButton } from '@/src/utils/flowAction';

import { FlowCardBody, FlowCardHeader } from './FlowCard';

type RenderMarkdown = (
  markdown: string,
  key: string,
  style?: StyleProp<ViewStyle>,
) => ReactElement | null;

export const FlowAgentCard = memo(function FlowAgentCard({
  viewModel,
  titleStyle,
  containerStyle,
  buttons,
  renderMarkdown,
  renderButton,
}: {
  viewModel: AgentCardViewModel;
  titleStyle: Pick<TextStyle, 'fontSize' | 'lineHeight'>;
  containerStyle?: StyleProp<ViewStyle>;
  buttons: readonly FlowActionButton[];
  renderMarkdown: RenderMarkdown;
  renderButton: (button: FlowActionButton) => ReactElement;
}): ReactElement {
  const hasBodyBelowHeader =
    viewModel.description.trim().length > 0 ||
    Boolean(viewModel.auditLine) ||
    Boolean(viewModel.decidedByLabel) ||
    Boolean(viewModel.footnote);
  const decidedByUser = useUserSnapshot(viewModel.decidedByUserId ?? '');
  const decidedByDisplayName =
    decidedByUser?.displayName?.trim() ||
    decidedByUser?.name?.trim() ||
    viewModel.decidedByName?.trim();

  return (
    <FlowCardBody containerStyle={containerStyle} gap={8}>
      <FlowCardHeader
        title={viewModel.title}
        statusLabel={viewModel.statusLabel}
        statusTone={viewModel.statusTone}
        titleStyle={{
          fontSize: titleStyle.fontSize,
          lineHeight: titleStyle.lineHeight ?? 20,
        }}
        {...(hasBodyBelowHeader ? { containerStyle: { marginBottom: 2 } } : {})}
      />
      <View style={{ gap: 2, minWidth: 0 }}>
        <Text className='text-base font-semibold text-foreground'>{viewModel.name}</Text>
        <Text className='text-sm text-foreground'>@{viewModel.slug}</Text>
      </View>
      {viewModel.description.trim() ? (
        <View style={{ gap: 4, minWidth: 0 }}>
          <Text className='text-sm font-semibold text-flow-card-header-title'>Description</Text>
          {renderMarkdown(viewModel.description, 'agent-description')}
        </View>
      ) : null}
      {viewModel.footnote?.trim() ? renderMarkdown(viewModel.footnote, 'agent-footnote') : null}
      {viewModel.decidedByLabel ? (
        <View
          style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0, marginTop: 2 }}
        >
          <Text className='text-xs font-semibold text-foreground'>{viewModel.decidedByLabel}</Text>
          <View
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0, flex: 1 }}
          >
            {viewModel.decidedByUserId ? (
              <Avatar userIds={[viewModel.decidedByUserId]} size={18} rounded={false} />
            ) : null}
            {decidedByDisplayName ? (
              <Text className='shrink text-xs font-semibold text-foreground' numberOfLines={1}>
                {decidedByDisplayName}
              </Text>
            ) : null}
          </View>
        </View>
      ) : viewModel.auditLine ? (
        <Text className='text-sm text-foreground'>{viewModel.auditLine}</Text>
      ) : null}
      {buttons.length > 0 ? (
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: 8,
            marginTop: 2,
            minWidth: 0,
            maxWidth: '100%',
            justifyContent: 'flex-end',
          }}
        >
          {buttons.map(button => renderButton(button))}
        </View>
      ) : null}
    </FlowCardBody>
  );
});
FlowAgentCard.displayName = 'FlowAgentCard';
