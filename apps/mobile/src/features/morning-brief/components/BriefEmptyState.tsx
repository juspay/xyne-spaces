import type { ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';

type BriefEmptyStateProps = {
  briefEnabled: boolean | undefined;
  enabling: boolean;
  onEnable: () => void;
};

/** Copy mirrors the web's empty state, CTA included. */
export function BriefEmptyState({
  briefEnabled,
  enabling,
  onEnable,
}: BriefEmptyStateProps): ReactElement {
  const disabled = briefEnabled === false;
  return (
    <View className='items-start gap-3'>
      <Text className='text-[15px] text-foreground' style={{ lineHeight: 22, letterSpacing: -0.1 }}>
        {disabled
          ? 'No brief to show yet. Turn on the morning brief to get one each day, or use “Generate” to create one now.'
          : 'No brief to show yet. Use “Generate” to create one.'}
      </Text>
      {disabled && (
        <Pressable
          onPress={onEnable}
          disabled={enabling}
          accessibilityRole='button'
          className='h-8 justify-center rounded-lg bg-foreground px-3'
          style={({ pressed }) => ({ opacity: enabling ? 0.5 : pressed ? 0.9 : 1 })}
        >
          <Text className='text-[14px] font-semibold text-background'>
            {enabling ? 'Turning on…' : 'Turn on morning brief'}
          </Text>
        </Pressable>
      )}
    </View>
  );
}
