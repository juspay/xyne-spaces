import { memo } from 'react';
import { Pressable } from 'react-native';
import { SquarePen } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type TicketsComposeFabProps = {
  onPress: () => void;
};

export const TicketsComposeFab = memo(function TicketsComposeFab({
  onPress,
}: TicketsComposeFabProps) {
  const insets = useSafeAreaInsets();

  return (
    <Pressable
      accessibilityRole='button'
      accessibilityLabel='Compose'
      onPress={onPress}
      className='absolute size-14 items-center justify-center rounded-2xl bg-action-primary shadow-md active:opacity-90'
      style={{ right: 16, bottom: Math.max(insets.bottom, 12) + 12 }}
    >
      <SquarePen size={22} color='#FFFFFF' strokeWidth={2.2} />
    </Pressable>
  );
});
