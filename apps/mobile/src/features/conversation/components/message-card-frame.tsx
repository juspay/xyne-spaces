import type { ReactElement, ReactNode } from 'react';
import {
  Pressable,
  View,
  type PressableProps,
  type PressableStateCallbackType,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { LONG_PRESS_DELAY_MS, MESSAGE_CARD_FRAME_PADDING, PRESSED_OPACITY } from '../constants';

type MessageCardFrameProps = Pick<
  PressableProps,
  'accessibilityRole' | 'accessibilityLabel' | 'accessibilityHint'
> & {
  /** The grey frame's corner. */
  radius: number;
  /** The white panel's corner, 4 inside the frame. */
  innerRadius: number;
  /** The panel's own padding and gaps. */
  innerStyle?: StyleProp<ViewStyle> | undefined;
  /** Makes the whole card a tap target that fades while pressed; without it the card is inert. */
  onPress?: (() => void) | undefined;
  /** Passed with `onPress`, so the card's own pressable does not swallow the row's hold. */
  onLongPress?: (() => void) | undefined;
  /** Drawn on the frame under the panel (the plan's note). */
  footer?: ReactNode;
  children: ReactNode;
};

/**
 * The frame every card in a message has (Figma "Tickets & code", "Room / Plan
 * card"): a white panel 4 inside a grey frame. Ticket, pull request and plan
 * cards differ only in their radii and what the panel holds.
 */
export function MessageCardFrame({
  radius,
  innerRadius,
  innerStyle,
  onPress,
  onLongPress,
  footer,
  children,
  ...accessibility
}: MessageCardFrameProps): ReactElement {
  const frameStyle: ViewStyle = { borderRadius: radius, padding: MESSAGE_CARD_FRAME_PADDING };
  const panel = (
    <>
      <View
        className='overflow-hidden bg-spaces-background'
        style={[{ borderRadius: innerRadius }, innerStyle]}
      >
        {children}
      </View>
      {footer}
    </>
  );

  if (!onPress) {
    return (
      <View className='self-stretch bg-spaces-surface' style={frameStyle}>
        {panel}
      </View>
    );
  }

  return (
    <Pressable
      {...accessibility}
      onPress={onPress}
      {...(onLongPress ? { onLongPress } : {})}
      delayLongPress={LONG_PRESS_DELAY_MS}
      className='self-stretch bg-spaces-surface'
      style={({ pressed }: PressableStateCallbackType): ViewStyle =>
        pressed ? { ...frameStyle, opacity: PRESSED_OPACITY } : frameStyle
      }
    >
      {panel}
    </Pressable>
  );
}
