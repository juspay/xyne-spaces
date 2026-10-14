import { Check } from 'lucide-react-native';
import { type ReactElement } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Button } from '@/src/components/ui/button';
import type { ChatRenderTokens } from '@/src/theme/chatRenderTokens';
import type {
  CallScheduleSelection,
  CallScheduleViewModel,
} from '@/src/utils/flowCallScheduleUtils';

import {
  CallScheduleDurationSwitcher,
  CallScheduleHeader,
  CallScheduleSlotLabel,
  CallScheduleSlotRow,
} from './FlowCallScheduleControls';

export const ProposedCallScheduleBody = ({
  viewModel,
  selection,
  canInteract,
  isSubmitting,
  tokens,
  onSelectionChange,
  onApprove,
}: {
  viewModel: Extract<CallScheduleViewModel, { phase: 'proposed' }>;
  selection: CallScheduleSelection;
  canInteract: boolean;
  isSubmitting: boolean;
  tokens: ChatRenderTokens;
  onSelectionChange: (selection: CallScheduleSelection) => void;
  onApprove: (selection: CallScheduleSelection) => void;
}): ReactElement => {
  const disabled = !canInteract || isSubmitting;
  return (
    <>
      <View style={{ gap: 12, paddingHorizontal: 12, paddingVertical: 12, minWidth: 0 }}>
        <CallScheduleHeader
          title={viewModel.title}
          attendees={viewModel.attendees}
          mutedIcon={tokens.foreground}
        />
        <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: tokens.borderColor }} />
        <View style={{ gap: 10, minWidth: 0 }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
            }}
          >
            <Text className='flex-1 text-sm font-medium text-foreground'>Available slots</Text>
            <CallScheduleDurationSwitcher
              value={selection.duration}
              disabled={disabled}
              mutedIcon={tokens.foregroundMuted}
              foreground={tokens.foreground}
              menuBackground={tokens.popoverColor}
              borderColor={tokens.borderColor}
              onChange={duration => onSelectionChange({ ...selection, duration })}
            />
          </View>
          <View style={{ gap: 10 }}>
            {viewModel.slots.map(slot => (
              <CallScheduleSlotRow
                key={slot.id}
                slot={slot}
                duration={selection.duration}
                selected={slot.id === selection.slotId}
                disabled={disabled}
                foreground={tokens.foreground}
                emptyBorder={tokens.borderColor}
                onSelect={() => onSelectionChange({ ...selection, slotId: slot.id })}
              />
            ))}
          </View>
        </View>
      </View>
      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 8,
          paddingHorizontal: 12,
          paddingVertical: 10,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: tokens.borderColor,
        }}
      >
        <Button
          size='xs'
          label='Approve'
          variant='primary'
          disabled={disabled}
          loading={isSubmitting}
          onPressIn={event => event.stopPropagation()}
          onPress={event => {
            event.stopPropagation();
            onApprove(selection);
          }}
        />
        <Text className='px-2 py-1.5 text-sm font-medium text-foreground'>Set manually</Text>
      </View>
    </>
  );
};

export const ScheduledCallScheduleBody = ({
  viewModel,
  tokens,
}: {
  viewModel: Extract<CallScheduleViewModel, { phase: 'scheduled' }>;
  tokens: ChatRenderTokens;
}): ReactElement => (
  <View style={{ gap: 12, paddingHorizontal: 12, paddingVertical: 12, minWidth: 0 }}>
    <CallScheduleHeader
      title={viewModel.title}
      attendees={viewModel.attendees}
      mutedIcon={tokens.foreground}
    />
    <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: tokens.borderColor }} />
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0 }}>
      <View
        className='bg-flow-card-status-completed-bg'
        style={{
          width: 16,
          height: 16,
          borderRadius: 8,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Check size={10} color='#009d2a' strokeWidth={2.5} />
      </View>
      <CallScheduleSlotLabel start={viewModel.start} duration={viewModel.duration} />
      <View className='rounded bg-flow-card-status-completed-bg px-1.5 py-0.5'>
        <Text className='text-xs font-semibold text-flow-card-status-completed-text'>
          Scheduled
        </Text>
      </View>
    </View>
  </View>
);
