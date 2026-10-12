import { Clock } from 'lucide-react-native';
import type { ReactElement } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { describeJoinRequest, type SubmittedJoinRequest } from '../model/join-request';
import { deckMetrics, deckPalette } from '../theme';

/**
 * Where a person waits after asking an existing company workspace for access.
 *
 * It is a screen of its own rather than a card, and it has no way forward into the app — that is
 * the point. Their request is with an admin, they hold no session, and so there is nothing in the
 * app yet that is theirs to use. The dashboard makes the same call: it leaves them on the screen,
 * says the request is in, and offers only sign-in.
 */
export function RequestSentScreen({
  request,
  onDone,
}: {
  request: SubmittedJoinRequest;
  onDone: () => void;
}): ReactElement {
  const insets = useSafeAreaInsets();
  const message = describeJoinRequest(request);

  return (
    <View style={[styles.screen, { paddingBottom: insets.bottom + 20, paddingTop: insets.top }]}>
      <View style={styles.content}>
        <View style={styles.icon}>
          <Clock size={28} color={deckPalette.textPrimary} strokeWidth={1.8} />
        </View>

        <Text style={styles.title} accessibilityRole='header'>
          {message.title}
        </Text>
        <Text style={styles.body}>{message.body}</Text>
      </View>

      <Pressable
        onPress={onDone}
        accessibilityRole='button'
        accessibilityLabel={message.actionLabel}
        style={({ pressed }) => [styles.action, pressed ? styles.actionPressed : null]}
      >
        <Text style={styles.actionLabel}>{message.actionLabel}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    paddingHorizontal: deckMetrics.gutter,
    backgroundColor: deckPalette.background,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
  },
  icon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
    backgroundColor: deckPalette.card,
  },
  title: {
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '500',
    letterSpacing: -0.4,
    textAlign: 'center',
    color: deckPalette.textPrimary,
  },
  body: {
    fontSize: 16,
    lineHeight: 23,
    textAlign: 'center',
    color: deckPalette.textSecondary,
  },
  action: {
    height: deckMetrics.nextButtonSize,
    borderRadius: deckMetrics.nextButtonSize / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: deckPalette.selected,
  },
  actionPressed: {
    opacity: 0.8,
  },
  actionLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: deckPalette.selectedText,
  },
});
