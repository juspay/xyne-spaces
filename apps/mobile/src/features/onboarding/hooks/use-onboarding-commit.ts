import { useCallback, useState } from 'react';

import { useAuth } from '@/src/contexts/AuthContext';

import type { OnboardingOutcome } from '../model/flow';
import { clearProgress } from '../state/onboarding-progress';

export interface OnboardingCommit {
  commit: (outcome: OnboardingOutcome, communityWorkspaceId: string | null) => Promise<void>;
  isCommitting: boolean;
  error: string | null;
  clearError: () => void;
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/**
 * Turns the deck's answers into the one auth call they add up to.
 *
 * Nothing is committed card by card on purpose. Every one of these calls creates a session, and a
 * session flips the root navigator over to the app — so firing early would yank the deck away
 * mid-flow. Running them once, on the last card, is also what makes Back harmless throughout.
 */
export function useOnboardingCommit(): OnboardingCommit {
  const {
    joinCommunityAndSwitch,
    createOrganization,
    createEnterpriseWorkspace,
    requestEnterpriseJoin,
  } = useAuth();

  const [isCommitting, setIsCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const commit = useCallback(
    async (outcome: OnboardingOutcome, communityWorkspaceId: string | null): Promise<void> => {
      setIsCommitting(true);
      setError(null);
      try {
        switch (outcome.kind) {
          case 'nothing':
            break;

          case 'join-community': {
            if (!communityWorkspaceId) {
              throw new Error('The Xyne community is unavailable right now. Please try again.');
            }
            await joinCommunityAndSwitch(communityWorkspaceId);
            break;
          }

          case 'create-org':
            await createOrganization({
              orgName: outcome.orgName,
              workspaceName: outcome.workspaceName,
            });
            break;

          case 'create-enterprise-workspace':
            await createEnterpriseWorkspace(outcome.workspaceName);
            break;

          case 'request-enterprise-join': {
            await requestEnterpriseJoin(outcome.workspaceId);
            // The request only queues; the community is where they wait for an admin, which is
            // what the card promised them.
            if (communityWorkspaceId) {
              await joinCommunityAndSwitch(communityWorkspaceId);
            }
            break;
          }
        }
      } catch (caught: unknown) {
        setError(messageOf(caught, 'Something went wrong. Please try again.'));
        setIsCommitting(false);
        return;
      }

      // Only on the happy path: a failed commit must leave the deck resumable.
      clearProgress();
      setIsCommitting(false);
    },
    [createEnterpriseWorkspace, createOrganization, joinCommunityAndSwitch, requestEnterpriseJoin],
  );

  return { commit, isCommitting, error, clearError: () => setError(null) };
}
