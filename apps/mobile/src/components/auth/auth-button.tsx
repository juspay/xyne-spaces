/**
 * Shared building blocks for the signed-out screens (`app/login.tsx`, `app/community.tsx`).
 *
 * These follow the login screen's convention of inline styles driven by the `--color-auth-*` CSS
 * variables rather than uniwind `className`, so both screens stay visually identical.
 */

import React, { ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useCSSVariable } from 'uniwind';

export function AuthButton({
  label,
  onPress,
  disabled,
  icon,
  variant = 'primary',
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  icon?: React.ReactNode;
  variant?: 'primary' | 'secondary';
}): ReactElement {
  const bgVar =
    variant === 'primary' ? '--color-auth-primary-btn-bg' : '--color-auth-secondary-btn-bg';
  const fgVar =
    variant === 'primary' ? '--color-auth-primary-btn-text' : '--color-auth-secondary-btn-text';
  const backgroundColor = useCSSVariable(bgVar) as string;
  const textColor = useCSSVariable(fgVar) as string;
  return (
    <Pressable
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        backgroundColor,
        borderRadius: 10,
        paddingVertical: 12,
        paddingHorizontal: 16,
        minHeight: 48,
        opacity: disabled ? 0.65 : 1,
      }}
      onPress={onPress}
      disabled={disabled}
    >
      {icon}
      <Text style={{ fontSize: 14, fontWeight: '600', color: textColor }}>{label}</Text>
    </Pressable>
  );
}

/** Horizontal rule with a centered label (defaults to the login screen's "or"). */
export function Divider({ label = 'or' }: { label?: string }): ReactElement {
  const dividerLine = useCSSVariable('--color-auth-divider') as string;
  const secondaryText = useCSSVariable('--color-auth-secondary-text') as string;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 2 }}>
      <View style={{ flex: 1, height: 1, backgroundColor: dividerLine }} />
      <Text style={{ fontSize: 12, color: secondaryText }}>{label}</Text>
      <View style={{ flex: 1, height: 1, backgroundColor: dividerLine }} />
    </View>
  );
}
