/**
 * Onboarding deck route (community app).
 *
 * Deliberately a sibling of `login` rather than a child of `(protected)`: the deck runs for a
 * person who has authenticated but belongs to no workspace yet, and `(protected)` is guarded on
 * `isSignedIn`, which only becomes true once a workspace session exists. The deck's last card is
 * what creates that session, so routing it under the guard would make it unreachable.
 *
 * Nothing here navigates on success either — the root navigator swaps to `(protected)` the moment
 * the session lands, which unmounts this screen on its own.
 */

import { useEffect, useMemo, type ReactElement } from 'react';
import { useRouter } from 'expo-router';

import { useAuth } from '@/src/contexts/AuthContext';
import {
  OnboardingScreen,
  toOnboardingContext,
  type SignInSnapshot,
} from '@/src/features/onboarding';

export default function OnboardingRoute(): ReactElement | null {
  const router = useRouter();
  const { pendingAuth, isSignedIn, isLoading } = useAuth();

  const context = useMemo(
    () => toOnboardingContext(pendingAuth as SignInSnapshot | null),
    [pendingAuth],
  );

  // Landed here without a sign-in to onboard — a stale deep link, or the user backed out of the
  // pending auth. Sending them to login is only safe once we know no session is arriving.
  useEffect(() => {
    if (context || isSignedIn || isLoading) {
      return;
    }
    router.replace('/login');
  }, [context, isLoading, isSignedIn, router]);

  if (!context) {
    return null;
  }

  return <OnboardingScreen context={context} />;
}
