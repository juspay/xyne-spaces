import { SmilePlus } from 'lucide-react-native';
import { type ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';

import { QUICK_REACTIONS } from './actionVisibility';
import { messageActionsChrome } from './messageActionsChrome';

export type QuickReactionsRailProps = {
  accent: string;
  foreground: string;
  sheetBg: string;
  onReact: (emoji: string) => void;
  onMore: () => void;
};

export function QuickReactionsRail({
  accent,
  foreground,
  sheetBg,
  onReact,
  onMore,
}: QuickReactionsRailProps): ReactElement {
  return (
    <View style={[messageActionsChrome.rail, { backgroundColor: sheetBg }]}>
      {QUICK_REACTIONS.map(emoji => (
        <Pressable
          key={emoji}
          accessibilityRole='button'
          accessibilityLabel={`React ${emoji}`}
          style={[messageActionsChrome.quickButton, { backgroundColor: accent }]}
          onPressIn={(event): void => event.stopPropagation()}
          onPress={(event): void => {
            event.stopPropagation();
            onReact(emoji);
          }}
        >
          <Text className='text-xl'>{emoji}</Text>
        </Pressable>
      ))}
      <Pressable
        accessibilityRole='button'
        accessibilityLabel='More reactions'
        style={[messageActionsChrome.quickButton, { backgroundColor: accent }]}
        onPressIn={(event): void => event.stopPropagation()}
        onPress={(event): void => {
          event.stopPropagation();
          onMore();
        }}
      >
        <SmilePlus size={20} color={foreground} />
      </Pressable>
    </View>
  );
}
