import { memo, type ReactElement } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import type { FlowComponentLike } from '@/src/utils/flowJsonMarkdown';
import {
  createCallScheduleViewModel,
  readCallScheduleSelection,
  type CallScheduleSelection,
} from '@/src/utils/flowCallScheduleUtils';

import { useChatRenderTokens } from '../../theme/ChatRenderProvider';
import { FlowCardBody } from './FlowCard';
import { ProposedCallScheduleBody, ScheduledCallScheduleBody } from './FlowCallScheduleParts';

type FlowCallScheduleCardProps = {
  component: FlowComponentLike;
  containerStyle?: StyleProp<ViewStyle>;
  canInteract: boolean;
  isSubmitting: boolean;
  selectionValue: unknown;
  onSelectionChange: (selection: CallScheduleSelection) => void;
  onApprove: (selection: CallScheduleSelection) => void;
};

export const FlowCallScheduleCard = memo(function FlowCallScheduleCard({
  component,
  containerStyle,
  canInteract,
  isSubmitting,
  selectionValue,
  onSelectionChange,
  onApprove,
}: FlowCallScheduleCardProps): ReactElement | null {
  const tokens = useChatRenderTokens();
  const viewModel = createCallScheduleViewModel(component);
  if (!viewModel) return null;

  const selection =
    viewModel.phase === 'proposed'
      ? readCallScheduleSelection(selectionValue, {
          slotId: viewModel.defaultSlotId,
          duration: viewModel.defaultDuration,
        })
      : null;

  return (
    <FlowCardBody containerStyle={containerStyle} gap={0}>
      <View
        className='overflow-hidden rounded-xl border border-border bg-chat-card'
        style={{ alignSelf: 'stretch', width: '100%', minWidth: 0 }}
      >
        {viewModel.phase === 'proposed' && selection ? (
          <ProposedCallScheduleBody
            viewModel={viewModel}
            selection={selection}
            canInteract={canInteract}
            isSubmitting={isSubmitting}
            tokens={tokens}
            onSelectionChange={onSelectionChange}
            onApprove={onApprove}
          />
        ) : viewModel.phase === 'scheduled' ? (
          <ScheduledCallScheduleBody viewModel={viewModel} tokens={tokens} />
        ) : null}
      </View>
    </FlowCardBody>
  );
});
FlowCallScheduleCard.displayName = 'FlowCallScheduleCard';
