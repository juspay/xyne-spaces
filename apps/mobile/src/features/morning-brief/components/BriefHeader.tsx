import type { ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { MenuView } from '@react-native-menu/menu';
import { EllipsisVertical, Sparkles } from 'lucide-react-native';

import { HeaderBackButton } from '@/src/components/ui/header-icon-button';
import { haptics } from '@/src/utils/haptics';

export type BriefMenuOption = 'settings' | 'history';

// Deliberately image-less: text-only rows on both platforms. (An action
// without an `image` also frees the iOS menu's leading icon column — and
// sidesteps the lib's Fabric bug where an unset imageColor arrives as 0 and
// tints a provided icon transparent.)
const MENU_ACTIONS = [
  { id: 'settings' as const, title: 'Settings' },
  { id: 'history' as const, title: 'Version history' },
];

type BriefHeaderProps = {
  actionLabel: string;
  actionDisabled: boolean;
  onRegenerate: () => void;
  onSelectMenuOption: (option: BriefMenuOption) => void;
  mutedColor: string;
  borderColor: string;
};

/**
 * Screen header: back + "Morning Brief" (the app's standard gap-3 pairing,
 * as on the shortcuts screens), then the Regenerate pill and a kebab that
 * opens the PLATFORM menu — UIMenu on iOS, PopupMenu on Android — anchored
 * at the button, with Settings and Version history.
 */
export function BriefHeader({
  actionLabel,
  actionDisabled,
  onRegenerate,
  onSelectMenuOption,
  mutedColor,
  borderColor,
}: BriefHeaderProps): ReactElement {
  const router = useRouter();

  return (
    <View className='min-h-14 flex-row items-center px-2'>
      <View className='min-w-0 flex-1 flex-row items-center gap-3'>
        <HeaderBackButton liquidGlass accessibilityLabel='Go back' onPress={() => router.back()} />
        <Text
          className='min-w-0 flex-1 text-[15px] font-semibold text-foreground'
          style={{ letterSpacing: -0.1 }}
          numberOfLines={1}
        >
          Morning Brief
        </Text>
      </View>
      <Pressable
        onPress={onRegenerate}
        disabled={actionDisabled}
        accessibilityRole='button'
        accessibilityLabel={actionLabel}
        className='h-8 flex-row items-center gap-1.5 rounded-lg border px-3'
        style={({ pressed }) => ({
          borderColor,
          opacity: actionDisabled ? 0.5 : pressed ? 0.7 : 1,
        })}
      >
        <Sparkles size={15} color={mutedColor} strokeWidth={1.8} />
        <Text className='text-[13px]' style={{ color: mutedColor }}>
          {actionLabel}
        </Text>
      </Pressable>
      <MenuView
        actions={MENU_ACTIONS}
        onPressAction={({ nativeEvent }) => {
          const option = nativeEvent.event;
          if (option === 'settings' || option === 'history') {
            onSelectMenuOption(option);
          }
        }}
        shouldOpenOnLongPress={false}
      >
        {/* MenuView intercepts the tap and opens the native menu at this
            anchor; the Pressable supplies the visual + haptic only. */}
        <Pressable
          onPressIn={() => void haptics.buttonTap()}
          accessibilityRole='button'
          accessibilityLabel='More options'
          className='ml-1 h-8 w-8 items-center justify-center rounded-lg'
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
        >
          <EllipsisVertical size={18} color={mutedColor} strokeWidth={1.8} />
        </Pressable>
      </MenuView>
    </View>
  );
}
