import { ChevronLeft } from 'lucide-react-native';
import { type ReactElement, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useCSSVariable } from 'uniwind';

import { cn } from '@/src/utils/cn';
import { haptics } from '@/src/utils/haptics';

/**
 * The pieces every tray list is built from, so each feature's views read as one
 * family without importing each other's.
 */
export const TRAY_ROW_HEIGHT = 52;

type OptionRowProps = {
  label: string;
  leading: ReactNode;
  trailing?: ReactNode;
  highlighted?: boolean;
  /** Accent-coloured label, for the row that creates or destroys rather than chooses. */
  emphasis?: boolean;
  onPress: () => void;
};

/** One tappable line of a tray list. */
export function OptionRow({
  label,
  leading,
  trailing,
  highlighted = false,
  emphasis = false,
  onPress,
}: OptionRowProps): ReactElement {
  return (
    <Pressable
      accessibilityRole='button'
      accessibilityState={{ selected: highlighted }}
      onPress={() => {
        void haptics.buttonTap();
        onPress();
      }}
      className={cn('flex-row items-center rounded-2xl px-3', highlighted && 'bg-spaces-surface')}
      style={{ height: TRAY_ROW_HEIGHT }}
    >
      <View className='w-6 items-center justify-center'>{leading}</View>
      <Text
        numberOfLines={1}
        className={cn(
          'flex-1 text-[16px] font-medium ml-3',
          emphasis ? 'text-spaces-accent' : 'text-spaces-foreground',
        )}
      >
        {label}
      </Text>
      {trailing}
    </Pressable>
  );
}

/** The small muted line that opens a view: "Move #x to", "Native App". */
export function TrayTitle({ children }: { children: string }): ReactElement {
  return (
    <Text numberOfLines={1} className='px-3 pb-2 text-[14px] text-spaces-muted'>
      {children}
    </Text>
  );
}

/**
 * Back arrow and the view's title, for the views that sit one level in.
 */
export function BackHeader({ title, onBack }: { title: string; onBack: () => void }): ReactElement {
  const foreground = useCSSVariable('--color-spaces-foreground') as string;

  return (
    <View className='flex-row items-center pb-3'>
      <Pressable
        accessibilityRole='button'
        accessibilityLabel='Back'
        hitSlop={8}
        onPress={() => {
          void haptics.buttonTap();
          onBack();
        }}
        className='h-9 w-9 items-center justify-center rounded-full bg-spaces-surface'
      >
        <ChevronLeft size={20} color={foreground} strokeWidth={2} />
      </Pressable>
      <Text numberOfLines={1} className='flex-1 pl-3 text-[14px] text-spaces-muted'>
        {title}
      </Text>
    </View>
  );
}
