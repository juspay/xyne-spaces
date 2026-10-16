import { Fragment, type ReactElement, useState } from 'react';
import { Stack, useRouter } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useCSSVariable } from 'uniwind';

import { HeaderBackButton } from '@/src/components/ui/header-icon-button';
import { Switch } from '@/src/components/ui/switch';
import { useBetaFlags } from '@/src/features/beta-flags';
import {
  FLAGS,
  applyFlagChanges,
  parentFlag,
  setFlag,
  storedFlag,
  type FlagKey,
} from '@/src/flags';
import { haptics } from '@/src/utils/haptics';

export default function BetaSettingsScreen(): ReactElement {
  const router = useRouter();

  const bg = useCSSVariable('--color-settings-bg') as string;
  const sectionBg = useCSSVariable('--color-settings-section-bg') as string;
  const divider = useCSSVariable('--color-settings-row-divider') as string;
  const label = useCSSVariable('--color-settings-label') as string;
  const description = useCSSVariable('--color-settings-description') as string;

  /**
   * Which flags to show comes from CAC, keyed on the signed-in user's email.
   * The list is empty until it answers, and stays empty if it fails — beta is
   * opt-in, so showing nothing is the right failure.
   */
  const { flags, isResolved, hasError } = useBetaFlags();

  /**
   * Only what this screen changed; everything else is read from storage below.
   *
   * Seeding it from `flags` would not work: the list arrives from CAC after
   * mount, so an initialiser would capture an empty one and every switch would
   * read as off no matter what storage held.
   */
  const [changed, setChanged] = useState<Record<string, boolean>>({});

  // The stored value, not the resolved one, so a child disabled by its parent
  // still shows what the user chose for it.
  const switchPosition = (key: FlagKey): boolean => changed[key] ?? storedFlag(key);

  /**
   * An unresolved config is not the same as an empty one. Saying "none
   * available" when the check never completed would describe a misconfiguration
   * as a decision about this account.
   */
  const emptyStateMessage = hasError
    ? 'Could not check which beta features are available. Try again later.'
    : isResolved
      ? 'No beta features are available for your account.'
      : 'Checking what is available\u2026';

  const toggleFlag = (key: FlagKey, next: boolean): void => {
    setFlag(key, next);
    setChanged(current => ({ ...current, [key]: next }));
    if (next) {
      void haptics.toggleOn();
    }
    applyFlagChanges();
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: bg }} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false, contentStyle: { backgroundColor: bg } }} />

      <View
        className='min-h-14 flex-row items-center gap-2 border-b px-2'
        style={{ borderColor: divider }}
      >
        <HeaderBackButton liquidGlass onPress={(): void => router.back()} iconColor={label} />
        <Text className='flex-1 text-[20px] font-semibold' style={{ color: label }}>
          Beta
        </Text>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 28 }}
      >
        <Text className='px-1 pb-2 pt-6 text-[13px]' style={{ color: description }}>
          Unfinished work, off by default. Turning one on restarts the app screen.
        </Text>

        {flags.length === 0 ? (
          <View
            className='overflow-hidden rounded-2xl px-4 py-5'
            style={{ backgroundColor: sectionBg }}
          >
            <Text className='text-[15px]' style={{ color: description }}>
              {emptyStateMessage}
            </Text>
          </View>
        ) : null}

        {flags.length > 0 ? (
          <View className='overflow-hidden rounded-2xl' style={{ backgroundColor: sectionBg }}>
            {flags.map((flag, index) => {
              const key = flag.key;
              const parent = parentFlag(key);
              const isBlocked = parent !== undefined && !switchPosition(parent);
              const isOn = switchPosition(key);

              return (
                <Fragment key={key}>
                  <Pressable
                    onPress={(): void => {
                      if (!isBlocked) {
                        toggleFlag(key, !isOn);
                      }
                    }}
                    disabled={isBlocked}
                    accessibilityRole='switch'
                    accessibilityState={{ checked: isOn, disabled: isBlocked }}
                    accessibilityLabel={flag.label}
                    android_ripple={isBlocked ? undefined : { color: divider }}
                    style={({ pressed }): { opacity: number } => ({
                      opacity: isBlocked ? 0.45 : pressed ? 0.58 : 1,
                    })}
                  >
                    <View className='min-h-[68px] flex-row items-center gap-3 px-4 py-3'>
                      <View className='min-w-0 flex-1'>
                        <Text className='text-[17px]' style={{ color: label }}>
                          {flag.label}
                        </Text>
                        <Text className='mt-0.5 text-[13px]' style={{ color: description }}>
                          {isBlocked ? `Needs ${FLAGS[parent].label}` : flag.description}
                        </Text>
                      </View>
                      <Switch
                        isSelected={isOn}
                        isDisabled={isBlocked}
                        onSelectedChange={(next: boolean): void => {
                          toggleFlag(key, next);
                        }}
                      />
                    </View>
                  </Pressable>
                  {index < flags.length - 1 ? (
                    <View className='h-px' style={{ backgroundColor: divider }} />
                  ) : null}
                </Fragment>
              );
            })}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
