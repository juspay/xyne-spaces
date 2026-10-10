import { Mail } from 'lucide-react-native';
import { memo, type ReactElement, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { GoogleLogo } from '@/src/assets/icons/GoogleLogo';
import { MicrosoftLogo } from '@/src/assets/icons/MicrosoftLogo';

import { loginPalette } from '../theme';

export type AuthProviderId = 'google' | 'microsoft' | 'email';

export type AuthProviderRowProps = {
  onSelect: (provider: AuthProviderId) => void;
  disabled?: boolean;
  /** Swaps that provider's mark for a spinner while its sign-in is in flight. */
  busyProvider?: AuthProviderId | null;
};

const PROVIDERS: readonly { id: AuthProviderId; label: string; mark: ReactNode }[] = [
  { id: 'google', label: 'Continue with Google', mark: <GoogleLogo width={24} height={24} /> },
  {
    id: 'microsoft',
    label: 'Continue with Microsoft',
    mark: <MicrosoftLogo width={22} height={22} />,
  },
  {
    id: 'email',
    label: 'Continue with email',
    mark: <Mail size={24} color={loginPalette.textPrimary} strokeWidth={1.8} />,
  },
];

/** The three sign-in affordances, as equal-width icon tiles. */
export const AuthProviderRow = memo(function AuthProviderRow({
  onSelect,
  disabled = false,
  busyProvider = null,
}: AuthProviderRowProps): ReactElement {
  return (
    <View style={styles.row}>
      {PROVIDERS.map(provider => {
        const isBusy = busyProvider === provider.id;
        return (
          <Pressable
            key={provider.id}
            onPress={() => onSelect(provider.id)}
            disabled={disabled}
            accessibilityRole='button'
            accessibilityLabel={provider.label}
            accessibilityState={{ disabled, busy: isBusy }}
            style={({ pressed }) => [
              styles.tile,
              pressed && styles.tilePressed,
              disabled && styles.tileDisabled,
            ]}
          >
            {isBusy ? <ActivityIndicator color={loginPalette.textPrimary} /> : provider.mark}
          </Pressable>
        );
      })}
    </View>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 10,
  },
  tile: {
    flex: 1,
    height: 58,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: loginPalette.surface,
  },
  tilePressed: {
    backgroundColor: loginPalette.surfaceRaised,
  },
  tileDisabled: {
    opacity: 0.5,
  },
});
