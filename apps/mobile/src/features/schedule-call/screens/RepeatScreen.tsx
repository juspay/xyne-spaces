import { useState, type ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { Check } from 'lucide-react-native';

import { useBubbleAccent } from '@/src/theme/useBubbleAccent';
import { cn } from '@/src/utils/cn';
import { haptics } from '@/src/utils/haptics';

import { PickerScreen } from '../components/PickerScreen';
import type { RepeatOptionId } from '../hooks/useScheduleCallForm';
import { getPickerSession, type PickerSession } from '../pickerSession';

interface RepeatPickerValue {
  selectedId: RepeatOptionId;
  /** e.g. "Monthly on first Sunday", which depends on the chosen start date. */
  monthlyLabel: string;
}

type RepeatSession = PickerSession<RepeatPickerValue, RepeatOptionId>;

// ponytail: "Custom…" (interval, weekdays, end rules) needs its own screen; add it as a last row.
const RepeatPicker = ({ session }: { session: RepeatSession }): ReactElement => {
  const router = useRouter();
  const { accentText } = useBubbleAccent();
  const { selectedId, monthlyLabel } = session.value;

  const options: { id: RepeatOptionId; label: string }[] = [
    { id: 'none', label: 'Does Not Repeat' },
    { id: 'daily', label: 'Daily' },
    { id: 'weekdays', label: 'Every Weekday (Mon – Fri)' },
    { id: 'monthly', label: monthlyLabel },
  ];

  return (
    <PickerScreen title='Repeat'>
      <View className='mx-4 overflow-hidden rounded-2xl bg-settings-section-bg'>
        {options.map((option, index) => {
          const selected = option.id === selectedId;
          return (
            <Pressable
              key={option.id}
              accessibilityRole='radio'
              accessibilityState={{ checked: selected }}
              onPress={() => {
                if (!selected) void haptics.selection();
                session.onChange(option.id);
                router.back();
              }}
              className={cn(
                'min-h-14 flex-row items-center gap-3 px-4 py-3 active:opacity-70',
                index > 0 && 'border-t border-border',
              )}
            >
              <Text className='flex-1 text-base text-foreground'>{option.label}</Text>
              {selected ? <Check size={22} color={accentText} strokeWidth={2.7} /> : null}
            </Pressable>
          );
        })}
      </View>
    </PickerScreen>
  );
};

export default function RepeatScreen(): ReactElement {
  const [session] = useState(() => getPickerSession<RepeatPickerValue, RepeatOptionId>());
  return session ? (
    <RepeatPicker session={session} />
  ) : (
    <Redirect href='/(protected)/(tabs)/calls' />
  );
}
