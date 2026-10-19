import { memo, useEffect, useMemo, useState, type ReactElement } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Calendar, Check, ChevronDown, Clock } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';

import Avatar from '@/src/components/ui/avatar';
import { Button } from '@/src/components/ui/button';
import { Dropdown } from '@/src/components/ui/dropdown';
import type { FlowComponentLike } from '@/src/utils/flowJsonMarkdown';
import {
  CALL_SCHEDULE_DURATION_OPTIONS,
  callScheduleDurationLabel,
  createCallScheduleViewModel,
  formatCallSlotLabel,
  isLikelyUserId,
  readCallScheduleSelection,
  type CallScheduleDuration,
  type CallScheduleSelection,
  type CallScheduleSlot,
  type CallScheduleViewModel,
} from '@/src/utils/flowCallScheduleUtils';

import { useConversationComposer } from './conversation-composer-context';
import { FlowCardBody } from './flow-card';

type FlowCallScheduleMessageProps = {
  component: FlowComponentLike;
  containerStyle?: StyleProp<ViewStyle>;
  canInteract: boolean;
  isSubmitting: boolean;
  selectionValue: unknown;
  onSelectionChange: (selection: CallScheduleSelection) => void;
  onApprove: () => void;
};

const Header = ({
  title,
  attendees,
  mutedIcon,
}: {
  title: string;
  attendees: string[];
  mutedIcon: string;
}): ReactElement => {
  const userIds = attendees.filter(isLikelyUserId);
  const shownIds = userIds.slice(0, 2);
  const overflow = Math.max(0, userIds.length - 2);
  const nameLabels = attendees.filter(name => !isLikelyUserId(name)).slice(0, 3);

  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, minWidth: 0 }}>
      <Calendar size={18} color={mutedIcon} style={{ marginTop: 1 }} />
      <Text className='min-w-0 flex-1 text-sm font-semibold leading-5 text-foreground'>
        {title}
      </Text>
      {shownIds.length > 0 ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 0 }}>
          <Avatar userIds={shownIds} size={24} />
          {overflow > 0 ? (
            <Text className='text-xs font-medium text-foreground'>+{overflow}</Text>
          ) : null}
        </View>
      ) : null}
      {shownIds.length === 0 && nameLabels.length > 0 ? (
        <Text className='max-w-[40%] text-xs text-foreground' numberOfLines={2}>
          {nameLabels.join(', ')}
        </Text>
      ) : null}
    </View>
  );
};

const SlotLabel = ({
  start,
  duration,
}: {
  start: string;
  duration: CallScheduleDuration;
}): ReactElement | null => {
  const label = formatCallSlotLabel(start, duration);
  if (!label) return null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
      <Text className='text-sm font-medium tabular-nums text-foreground'>{label.dateLabel}</Text>
      <Text className='text-sm tabular-nums text-foreground'>{label.rangeLabel}</Text>
    </View>
  );
};

const SlotRow = ({
  slot,
  duration,
  selected,
  disabled,
  onSelect,
  suppressBubblePress,
  foreground,
  emptyBorder,
}: {
  slot: CallScheduleSlot;
  duration: CallScheduleDuration;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
  suppressBubblePress: () => void;
  foreground: string;
  emptyBorder: string;
}): ReactElement => (
  <Pressable
    accessibilityRole='radio'
    accessibilityState={{ selected, disabled }}
    disabled={disabled}
    onPressIn={event => {
      event.stopPropagation();
      suppressBubblePress();
    }}
    onPress={event => {
      event.stopPropagation();
      onSelect();
    }}
    style={({ pressed }) => ({
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      opacity: disabled ? 0.55 : pressed ? 0.75 : 1,
    })}
  >
    <View
      style={{
        width: 16,
        height: 16,
        borderRadius: 8,
        borderWidth: selected ? 0 : 1.6,
        borderColor: emptyBorder,
        backgroundColor: selected ? foreground : 'transparent',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {selected ? (
        <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: '#ffffff' }} />
      ) : null}
    </View>
    <SlotLabel start={slot.start} duration={duration} />
  </Pressable>
);

const DurationSwitcher = ({
  value,
  disabled,
  mutedIcon,
  foreground,
  menuBackground,
  borderColor,
  onChange,
  suppressBubblePress,
}: {
  value: CallScheduleDuration;
  disabled: boolean;
  mutedIcon: string;
  foreground: string;
  menuBackground: string;
  borderColor: string;
  onChange: (duration: CallScheduleDuration) => void;
  suppressBubblePress: () => void;
}): ReactElement => (
  <Dropdown>
    <Dropdown.Trigger
      accessibilityLabel={`Duration ${callScheduleDurationLabel(value)}`}
      disabled={disabled}
      onPressIn={event => {
        event.stopPropagation();
        suppressBubblePress();
      }}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        opacity: disabled ? 0.55 : pressed ? 0.7 : 1,
      })}
    >
      <Clock size={14} color={mutedIcon} />
      <Text className='text-sm font-medium tabular-nums text-foreground'>
        {callScheduleDurationLabel(value)}
      </Text>
      <ChevronDown size={14} color={mutedIcon} />
    </Dropdown.Trigger>

    <Dropdown.Content
      side='bottom'
      align='end'
      sideOffset={6}
      minWidth={112}
      maxWidth={140}
      scrollable={false}
      overlayColor='rgba(0,0,0,0.02)'
      contentStyle={{ paddingVertical: 4 }}
      style={{
        backgroundColor: menuBackground,
        borderColor,
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 10,
      }}
    >
      {CALL_SCHEDULE_DURATION_OPTIONS.map(duration => {
        const selected = duration === value;
        return (
          <Dropdown.Item
            key={duration}
            label={callScheduleDurationLabel(duration)}
            onSelect={() => onChange(duration)}
            labelStyle={{
              fontSize: 14,
              lineHeight: 18,
              fontWeight: selected ? '600' : '400',
              color: foreground,
            }}
            right={selected ? <Check size={14} color={foreground} strokeWidth={2.4} /> : undefined}
          />
        );
      })}
    </Dropdown.Content>
  </Dropdown>
);

const ProposedBody = ({
  viewModel,
  selection,
  canInteract,
  isSubmitting,
  mutedIcon,
  foreground,
  emptyBorder,
  borderColor,
  menuBackground,
  onSelectionChange,
  onApprove,
  suppressBubblePress,
}: {
  viewModel: Extract<CallScheduleViewModel, { phase: 'proposed' }>;
  selection: CallScheduleSelection;
  canInteract: boolean;
  isSubmitting: boolean;
  mutedIcon: string;
  foreground: string;
  emptyBorder: string;
  borderColor: string;
  menuBackground: string;
  onSelectionChange: (selection: CallScheduleSelection) => void;
  onApprove: () => void;
  suppressBubblePress: () => void;
}): ReactElement => {
  const disabled = !canInteract || isSubmitting;

  return (
    <>
      <View style={{ gap: 12, paddingHorizontal: 12, paddingVertical: 12, minWidth: 0 }}>
        <Header title={viewModel.title} attendees={viewModel.attendees} mutedIcon={mutedIcon} />
        <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: borderColor }} />
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
            <DurationSwitcher
              value={selection.duration}
              disabled={disabled}
              mutedIcon={mutedIcon}
              foreground={foreground}
              menuBackground={menuBackground}
              borderColor={borderColor}
              suppressBubblePress={suppressBubblePress}
              onChange={duration => onSelectionChange({ ...selection, duration })}
            />
          </View>
          <View style={{ gap: 10 }}>
            {viewModel.slots.map(slot => (
              <SlotRow
                key={slot.id}
                slot={slot}
                duration={selection.duration}
                selected={slot.id === selection.slotId}
                disabled={disabled}
                suppressBubblePress={suppressBubblePress}
                foreground={foreground}
                emptyBorder={emptyBorder}
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
          borderTopColor: borderColor,
        }}
      >
        <Button
          size='xs'
          label='Approve'
          variant='primary'
          disabled={disabled}
          loading={isSubmitting}
          onPressIn={event => {
            event.stopPropagation();
            suppressBubblePress();
          }}
          onPress={event => {
            event.stopPropagation();
            onApprove();
          }}
        />
        <Text className='px-2 py-1.5 text-sm font-medium text-foreground'>Set manually</Text>
      </View>
    </>
  );
};

const ScheduledBody = ({
  viewModel,
  mutedIcon,
  borderColor,
}: {
  viewModel: Extract<CallScheduleViewModel, { phase: 'scheduled' }>;
  mutedIcon: string;
  borderColor: string;
}): ReactElement => (
  <View style={{ gap: 12, paddingHorizontal: 12, paddingVertical: 12, minWidth: 0 }}>
    <Header title={viewModel.title} attendees={viewModel.attendees} mutedIcon={mutedIcon} />
    <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: borderColor }} />
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
      <SlotLabel start={viewModel.start} duration={viewModel.duration} />
      <View className='rounded bg-flow-card-status-completed-bg px-1.5 py-0.5'>
        <Text className='text-xs font-semibold text-flow-card-status-completed-text'>
          Scheduled
        </Text>
      </View>
    </View>
  </View>
);

const FlowCallScheduleMessageComponent = ({
  component,
  containerStyle,
  canInteract,
  isSubmitting,
  selectionValue,
  onSelectionChange,
  onApprove,
}: FlowCallScheduleMessageProps): ReactElement | null => {
  const { suppressBubblePress } = useConversationComposer();
  const mutedIcon = useCSSVariable('--color-foreground') as string;
  const foreground = useCSSVariable('--color-foreground') as string;
  const borderColor = useCSSVariable('--color-border') as string;
  const menuBackground = useCSSVariable('--color-popover') as string;

  const viewModel = useMemo(() => createCallScheduleViewModel(component), [component]);
  const [seeded, setSeeded] = useState(false);

  useEffect(() => {
    if (!viewModel || viewModel.phase !== 'proposed') return;
    if (selectionValue !== undefined) {
      setSeeded(true);
      return;
    }
    if (seeded) return;
    onSelectionChange({
      slotId: viewModel.defaultSlotId,
      duration: viewModel.defaultDuration,
    });
    setSeeded(true);
  }, [onSelectionChange, seeded, selectionValue, viewModel]);

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
          <ProposedBody
            viewModel={viewModel}
            selection={selection}
            canInteract={canInteract}
            isSubmitting={isSubmitting}
            mutedIcon={mutedIcon}
            foreground={foreground}
            emptyBorder={borderColor}
            borderColor={borderColor}
            menuBackground={menuBackground}
            onSelectionChange={onSelectionChange}
            onApprove={onApprove}
            suppressBubblePress={suppressBubblePress}
          />
        ) : viewModel.phase === 'scheduled' ? (
          <ScheduledBody viewModel={viewModel} mutedIcon={mutedIcon} borderColor={borderColor} />
        ) : null}
      </View>
    </FlowCardBody>
  );
};

const FlowCallScheduleMessage = memo(FlowCallScheduleMessageComponent);
FlowCallScheduleMessage.displayName = 'FlowCallScheduleMessage';

export { FlowCallScheduleMessage };
