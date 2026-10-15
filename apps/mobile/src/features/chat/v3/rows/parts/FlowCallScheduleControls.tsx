import { Calendar, Check, ChevronDown, Clock } from 'lucide-react-native';
import { type ReactElement } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import Avatar from '@/src/components/ui/avatar';
import { Dropdown } from '@/src/components/ui/dropdown';
import {
  CALL_SCHEDULE_DURATION_OPTIONS,
  callScheduleDurationLabel,
  formatCallSlotLabel,
  isLikelyUserId,
  type CallScheduleDuration,
  type CallScheduleSlot,
} from '@/src/utils/flowCallScheduleUtils';

export const CallScheduleHeader = ({
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
  const overflow = Math.max(0, userIds.length - shownIds.length);
  const names = attendees.filter(name => !isLikelyUserId(name)).slice(0, 3);

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
      ) : names.length > 0 ? (
        <Text className='max-w-[40%] text-xs text-foreground' numberOfLines={2}>
          {names.join(', ')}
        </Text>
      ) : null}
    </View>
  );
};

export const CallScheduleSlotLabel = ({
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

export const CallScheduleSlotRow = ({
  slot,
  duration,
  selected,
  disabled,
  onSelect,
  foreground,
  emptyBorder,
}: {
  slot: CallScheduleSlot;
  duration: CallScheduleDuration;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
  foreground: string;
  emptyBorder: string;
}): ReactElement => (
  <Pressable
    accessibilityRole='radio'
    accessibilityState={{ selected, disabled }}
    disabled={disabled}
    onPressIn={event => event.stopPropagation()}
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
        <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: '#fff' }} />
      ) : null}
    </View>
    <CallScheduleSlotLabel start={slot.start} duration={duration} />
  </Pressable>
);

export const CallScheduleDurationSwitcher = ({
  value,
  disabled,
  mutedIcon,
  foreground,
  menuBackground,
  borderColor,
  onChange,
}: {
  value: CallScheduleDuration;
  disabled: boolean;
  mutedIcon: string;
  foreground: string;
  menuBackground: string;
  borderColor: string;
  onChange: (duration: CallScheduleDuration) => void;
}): ReactElement => (
  <Dropdown>
    <Dropdown.Trigger
      accessibilityLabel={`Duration ${callScheduleDurationLabel(value)}`}
      disabled={disabled}
      onPressIn={event => event.stopPropagation()}
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
