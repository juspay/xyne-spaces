import { BottomSheet, Column, Text } from '@expo/ui';
import { Button, Text as SwiftUIText } from '@expo/ui/swift-ui';
import {
  buttonBorderShape,
  buttonStyle,
  controlSize,
  font,
  frame,
  multilineTextAlignment,
  padding,
  tint,
} from '@expo/ui/swift-ui/modifiers';
import { useColorScheme } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCSSVariable } from 'uniwind';

import { getRemoveMemberCopy } from './channel-member-actions';
import type { RemoveMemberSheetProps } from './remove-member-sheet.types';

export function RemoveMemberSheet({
  isPresented,
  memberName,
  channelName,
  visibility,
  isRemoving,
  onDismiss,
  onConfirm,
}: RemoveMemberSheetProps) {
  const colorScheme = useColorScheme();
  const insets = useSafeAreaInsets();
  const ink = { color: colorScheme === 'dark' ? '#FFFFFF' : '#000000' };
  const muted = {
    color: colorScheme === 'dark' ? 'rgba(255,255,255,0.65)' : 'rgba(0,0,0,0.6)',
  };
  const dangerColor = (useCSSVariable('--color-button-danger-bg') as string) || '#F65C5B';
  const { title, description } = getRemoveMemberCopy({
    memberName,
    channelName,
    visibility,
  });

  const labelModifiers = [
    frame({ maxWidth: Infinity }),
    font({ weight: 'semibold' }),
    multilineTextAlignment('center'),
  ];

  return (
    <BottomSheet
      isPresented={isPresented}
      onDismiss={onDismiss}
      modifiers={[
        padding({
          horizontal: 12,
          bottom: Math.max(insets.bottom, 12),
          top: 18,
        }),
      ]}
    >
      <Column spacing={14} modifiers={[frame({ maxWidth: Infinity })]}>
        <Text textStyle={{ ...ink, fontSize: 20, fontWeight: '700' }}>{title}</Text>
        <Text textStyle={{ ...muted, fontSize: 15 }}>{description}</Text>
        <Button
          // SwiftUI button role (not an ARIA role).
          // eslint-disable-next-line jsx-a11y/aria-role
          role='destructive'
          modifiers={[
            buttonStyle('borderedProminent'),
            buttonBorderShape('capsule'),
            controlSize('large'),
            tint(dangerColor),
          ]}
          onPress={() => {
            if (!isRemoving) onConfirm();
          }}
        >
          <SwiftUIText modifiers={labelModifiers}>
            {isRemoving ? 'Removing…' : 'Remove'}
          </SwiftUIText>
        </Button>
        <Button modifiers={[buttonStyle('plain'), controlSize('large')]} onPress={onDismiss}>
          <SwiftUIText modifiers={labelModifiers}>Cancel</SwiftUIText>
        </Button>
      </Column>
    </BottomSheet>
  );
}
