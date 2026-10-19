import { cloneElement, isValidElement, useCallback, type ReactElement } from 'react';
import { Pressable, type StyleProp, type ViewStyle } from 'react-native';

import { useTrayInternals } from './tray-context';

export type TrayTriggerProps = {
  /** View to open on. Omitted opens the tray's `defaultView`. */
  view?: string;
  /**
   * Render the child as the trigger instead of wrapping it in a Pressable, so
   * an existing button keeps its own styling and press feedback.
   */
  asChild?: boolean;
  style?: StyleProp<ViewStyle>;
  children: ReactElement | ReactElement[];
};

export function TrayTrigger({
  view,
  asChild = false,
  style,
  children,
}: TrayTriggerProps): ReactElement {
  const { open } = useTrayInternals();
  const onPress = useCallback(() => open(view), [open, view]);

  if (asChild && isValidElement(children)) {
    return cloneElement(children as ReactElement<{ onPress?: () => void }>, { onPress });
  }

  return (
    <Pressable accessibilityRole='button' onPress={onPress} style={style}>
      {children}
    </Pressable>
  );
}
