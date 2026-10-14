import React from 'react';
import { StyleSheet, View } from 'react-native';
import { BottomSheetBackdrop, type BottomSheetBackdropProps } from '@gorhom/bottom-sheet';

interface CallSheetBackdropProps extends BottomSheetBackdropProps {
  /** Whether the sheet is meant to be open. While false the backdrop never takes a touch. */
  isOpen: boolean;
  opacity?: number;
  onPress?: () => void;
}

/**
 * Backdrop for the call bottom sheets, which stay mounted (closed) over the whole call screen.
 *
 * gorhom's backdrop is a full-screen view that starts out touchable and only turns touch-through
 * once the sheet's animated index reads `<= -1`. If the container grows after the sheet has
 * settled closed (e.g. the window's height changes after the call screen mounts), the index sticks
 * just above -1 (e.g. -0.98): the backdrop stays invisible but keeps swallowing every tap, so no
 * call button works. Gating it on our own open state makes it touch-through whenever the sheet is
 * closed, whatever the index says.
 */
export function CallSheetBackdrop({
  isOpen,
  opacity,
  onPress,
  ...props
}: CallSheetBackdropProps): React.ReactElement {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents={isOpen ? 'box-none' : 'none'}>
      <BottomSheetBackdrop
        {...props}
        disappearsOnIndex={-1}
        appearsOnIndex={0}
        pressBehavior='close'
        {...(opacity === undefined ? {} : { opacity })}
        {...(onPress === undefined ? {} : { onPress })}
      />
    </View>
  );
}
