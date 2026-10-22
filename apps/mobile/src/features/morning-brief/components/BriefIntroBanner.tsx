import type { ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { X } from 'lucide-react-native';

import { BRIEF_SERIF_FONT } from './BriefTitle';

/** Web `--primary` — the banner's coral halo. */
const BANNER_GLOW = '#FD6B6B';

type BriefIntroBannerProps = {
  briefEnabled: boolean | undefined;
  enabling: boolean;
  onEnableBrief: () => void;
  onDismiss: () => void;
  mutedColor: string;
  borderColor: string;
};

/**
 * Dismissible first-run banner — 16px-radius card with a coral glow bleeding
 * in from the top edge (the web fakes it with a blurred radial; a soft
 * top-anchored linear gradient reads the same at this size).
 */
export function BriefIntroBanner({
  briefEnabled,
  enabling,
  onEnableBrief,
  onDismiss,
  mutedColor,
  borderColor,
}: BriefIntroBannerProps): ReactElement {
  return (
    <View
      className='relative mb-8 overflow-hidden rounded-2xl border px-6 py-5'
      style={{ borderColor }}
    >
      <LinearGradient
        colors={[`${BANNER_GLOW}38`, `${BANNER_GLOW}12`, `${BANNER_GLOW}00`]}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 72 }}
      />
      <View className='items-center gap-2'>
        <Text
          className='text-center text-foreground'
          style={{ fontFamily: BRIEF_SERIF_FONT, fontSize: 16, lineHeight: 20 }}
        >
          Your Morning Brief
        </Text>
        <Text className='text-center text-[15px] text-foreground/80' style={{ lineHeight: 20 }}>
          Everything that needs you, is overdue, waiting, and assigned to you summarized
        </Text>
        {briefEnabled === false && (
          <Text className='text-center text-[13px]' style={{ color: mutedColor, lineHeight: 18 }}>
            You are not set up to receive this each morning yet.
          </Text>
        )}
        {briefEnabled === false && (
          <View className='mt-1 flex-row items-center gap-2'>
            <Pressable
              onPress={onEnableBrief}
              disabled={enabling}
              accessibilityRole='button'
              className='h-8 justify-center rounded-lg bg-foreground px-3'
              style={({ pressed }) => ({ opacity: enabling ? 0.5 : pressed ? 0.9 : 1 })}
            >
              <Text className='text-[14px] font-semibold text-background'>
                {enabling ? 'Turning on…' : 'Turn on morning brief'}
              </Text>
            </Pressable>
          </View>
        )}
      </View>
      <Pressable
        onPress={onDismiss}
        accessibilityRole='button'
        accessibilityLabel='Dismiss'
        className='absolute right-3 top-3 h-6 w-6 items-center justify-center rounded-md'
        style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
      >
        <X size={14} color={mutedColor} strokeWidth={2} />
      </Pressable>
    </View>
  );
}
