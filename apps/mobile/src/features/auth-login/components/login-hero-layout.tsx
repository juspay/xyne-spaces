import type { ReactElement, ReactNode } from 'react';
import { StatusBar, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ArtifactFeed } from './artifact-feed';
import {
  AuthProviderRow,
  type AuthProviderId,
  type AuthProviderRowProps,
} from './auth-provider-row';
import { HighlightHeadline, type HeadlineLine } from './highlight-headline';
import { LOGIN_GUTTER, loginPalette } from '../theme';

const DEFAULT_HEADLINE: readonly HeadlineLine[] = [
  { text: 'The most' },
  { text: 'future-proof', highlighted: true },
  { text: 'way to bring AI to your Org' },
];

export type LoginHeroLayoutProps = {
  onSelectProvider: (provider: AuthProviderId) => void;
  disabled?: boolean;
  busyProvider?: AuthProviderRowProps['busyProvider'];
  headline?: readonly HeadlineLine[];
  /** Slot above the headline, for flavour-specific notices (e.g. the community being joined). */
  notice?: ReactNode;
};

/**
 * The signed-out hero: decorative channel artwork filling the top, the headline and the sign-in
 * providers pinned to the bottom.
 *
 * Presentational only — it owns no auth state. Each flavour's login screen supplies the handlers,
 * so the same layout can back both the community and the internal builds.
 */
export function LoginHeroLayout({
  onSelectProvider,
  disabled = false,
  busyProvider = null,
  headline = DEFAULT_HEADLINE,
  notice,
}: LoginHeroLayoutProps): ReactElement {
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.screen}>
      <StatusBar barStyle='light-content' />

      <View style={[styles.feed, { paddingTop: insets.top + 8 }]}>
        <ArtifactFeed />
      </View>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 28 }]}>
        {notice}
        <HighlightHeadline lines={headline} />
        <AuthProviderRow
          onSelect={onSelectProvider}
          disabled={disabled}
          busyProvider={busyProvider}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: loginPalette.background,
  },
  feed: {
    flex: 1,
    paddingHorizontal: LOGIN_GUTTER,
  },
  footer: {
    paddingHorizontal: LOGIN_GUTTER,
    paddingTop: 8,
    gap: 32,
  },
});
