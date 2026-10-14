import type { ReactElement } from 'react';
import { Pressable, Text } from 'react-native';

import { cn } from '@/src/utils/cn';
import { haptics } from '@/src/utils/haptics';

type CustomFieldProps = {
  icon: ReactElement;
  label: string;
  value: string;
  isActive: boolean;
  onPress: () => void;
};

export function CustomField({
  icon,
  label,
  value,
  isActive,
  onPress,
}: CustomFieldProps): ReactElement {
  return (
    <Pressable
      accessibilityRole='button'
      accessibilityState={{ selected: isActive }}
      onPress={() => {
        if (!isActive) void haptics.selection();
        onPress();
      }}
      className={cn(
        'flex-row items-center gap-3 px-4 py-4 active:bg-accent',
        isActive ? 'bg-accent' : '',
        label === 'Time' ? 'border-t border-border' : '',
      )}
    >
      {icon}
      <Text className='flex-1 text-[15px] text-foreground/70'>{label}</Text>
      <Text className='text-[16px] font-medium text-foreground'>{value}</Text>
    </Pressable>
  );
}
