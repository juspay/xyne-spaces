/**
 * Completes a community invite for a user who is already signed in to another workspace.
 *
 * The signed-out path goes through `app/community.tsx` → `app/login.tsx`; this screen exists for the
 * case where a `/community/join?workspaceId=…` link is opened with a live session, which needs the
 * full workspace-switch teardown rather than a fresh sign-in.
 */

import { ReactElement, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useCSSVariable } from 'uniwind';

import { useAuth } from '@/src/contexts/AuthContext';
import {
  clearPendingCommunityWorkspace,
  getPendingCommunityWorkspace,
} from '@/src/services/communityIntent';

const CommunityJoinScreen = (): ReactElement => {
  const router = useRouter();
  const { joinCommunityAndSwitch } = useAuth();
  const background = useCSSVariable('--color-background') as string;
  const primaryText = useCSSVariable('--color-auth-primary-text') as string;
  const secondaryText = useCSSVariable('--color-auth-secondary-text') as string;
  const errorColor = useCSSVariable('--color-auth-error') as string;
  const linkColor = useCSSVariable('--color-auth-link') as string;

  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) {
      return;
    }
    startedRef.current = true;

    const pending = getPendingCommunityWorkspace();
    if (!pending) {
      router.replace('/(protected)');
      return;
    }

    void (async () => {
      try {
        const outcome = await joinCommunityAndSwitch(pending.id);
        if (outcome.kind === 'joined') {
          router.replace('/(protected)');
          return;
        }
        setStatusMessage(
          outcome.request.status === 'REQUEST_REJECTED'
            ? 'A workspace admin rejected this access request.'
            : 'Your request has been submitted and will be reviewed by community owners.',
        );
      } catch (joinError: unknown) {
        clearPendingCommunityWorkspace();
        setError(
          joinError instanceof Error && joinError.message
            ? joinError.message
            : 'Failed to join this community.',
        );
      }
    })();
  }, [joinCommunityAndSwitch, router]);

  const message = error ?? statusMessage;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: background }}>
      <View
        style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 }}
      >
        {message ? (
          <>
            <Text
              style={{
                fontSize: 15,
                fontWeight: '600',
                color: error ? errorColor : primaryText,
                textAlign: 'center',
              }}
            >
              {error ? 'Unable to join community' : 'Request submitted'}
            </Text>
            <Text
              style={{ fontSize: 13, color: secondaryText, textAlign: 'center', lineHeight: 20 }}
            >
              {message}
            </Text>
            <Pressable
              onPress={() => router.replace('/(protected)')}
              style={{ paddingVertical: 8 }}
            >
              <Text style={{ fontSize: 13, fontWeight: '600', color: linkColor }}>
                Back to Xyne Spaces
              </Text>
            </Pressable>
          </>
        ) : (
          <>
            <ActivityIndicator />
            <Text style={{ fontSize: 14, color: secondaryText }}>Joining community...</Text>
          </>
        )}
      </View>
    </SafeAreaView>
  );
};

export default CommunityJoinScreen;
