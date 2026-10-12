import { useMemo, useState, type ReactElement, type ReactNode } from 'react';

import { useAuth } from '@/src/contexts/AuthContext';

import type { OnboardingContext } from '../model/context';
import { OnboardingScreen } from '../screens/onboarding-screen';
import { forgetJoinRequest, hasJoinRequest } from '../state/pending-onboarding';

/**
 * Asks a person the deck's questions once, on the way in, after an admin approved their request.
 *
 * Asking a company for access ends the deck before any question is put. When the request is
 * approved the next sign-in simply succeeds — the backend now lists that workspace for them — and
 * they are inside the app without the deck ever having a say. This is that say: it holds the
 * signed-in shell back, shows the questions-only deck, then lets the shell through.
 *
 * It keys off the marker left when the request was sent, not off the backend's `isNewUser`, so it
 * only ever holds up someone who asked from this device. Everyone else's sign-in is unchanged.
 */
export function ApprovedOnboardingGate({ children }: { children: ReactNode }): ReactElement {
  const { user } = useAuth();
  const email = user?.email ?? null;
  const name = user?.name ?? null;

  const [isAsking, setIsAsking] = useState(() => email !== null && hasJoinRequest(email));

  const context = useMemo<OnboardingContext | null>(
    () =>
      email === null
        ? null
        : {
            email,
            profileName: name?.trim() || null,
            existingCompany: null,
            publicEmailDomainError: null,
            // Already placed in a workspace, so the start fork has nothing left to ask — the same
            // shape as an invite.
            isInvited: true,
          },
    [email, name],
  );

  if (!isAsking || context === null) {
    return <>{children}</>;
  }

  return (
    <OnboardingScreen
      context={context}
      onComplete={() => {
        forgetJoinRequest();
        setIsAsking(false);
      }}
    />
  );
}
