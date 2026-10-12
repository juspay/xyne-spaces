import { useCallback, useState } from 'react';

import { useAuth } from '@/src/contexts/AuthContext';

import type { OnboardingAnswers } from '../model/answers';
import type { OnboardingContext } from '../model/context';
import type { OnboardingOutcome } from '../model/flow';
import { toJoinRequestStatus, type SubmittedJoinRequest } from '../model/join-request';
import { buildPendingOnboarding } from '../model/onboarding-record';
import { clearProgress } from '../state/onboarding-progress';
import {
  clearPendingOnboarding,
  forgetJoinRequest,
  rememberJoinRequest,
  writePendingOnboarding,
} from '../state/pending-onboarding';

export interface OnboardingCommit {
  commit: (
    outcome: OnboardingOutcome,
    answers: OnboardingAnswers,
    communityWorkspaceId: string | null,
  ) => Promise<void>;
  isCommitting: boolean;
  error: string | null;
  clearError: () => void;
  /**
   * Set when the answers ended in a request to an existing workspace rather than a session.
   * The person is still signed out at that point, so the screen has to say where they stand —
   * nothing else will, because no navigation happens.
   */
  submittedRequest: SubmittedJoinRequest | null;
  /** Leaves the waiting state for sign-in. */
  leaveRequest: () => void;
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
 *
 * The answers to the deck's questions are not sent from here: there is no session yet to send
 * them with. They are written down first (before the call that creates the session, so a kill in
 * between cannot lose them) and the signed-in shell stores them — see
 * `use-flush-pending-onboarding`.
 *
 * `onComplete` is for the one caller with no session to create: a person who was already let in
 * and only had questions left (see `ApprovedOnboardingGate`).
 */
export function useOnboardingCommit(
  context: OnboardingContext,
  onComplete?: () => void,
): OnboardingCommit {
  const {
    joinCommunityAndSwitch,
    createOrganization,
    createEnterpriseWorkspace,
    requestEnterpriseJoin,
    clearPendingAuth,
  } = useAuth();

  const [isCommitting, setIsCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submittedRequest, setSubmittedRequest] = useState<SubmittedJoinRequest | null>(null);

  const commit = useCallback(
    async (
      outcome: OnboardingOutcome,
      answers: OnboardingAnswers,
      communityWorkspaceId: string | null,
    ): Promise<void> => {
      setIsCommitting(true);
      setError(null);

      // A request ends without a session and without questions, so there is nothing to store.
      if (outcome.kind !== 'request-enterprise-join') {
        writePendingOnboarding(buildPendingOnboarding(context.email, answers, outcome));
      }

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
            const result = await requestEnterpriseJoin(outcome.workspaceId);
            // Deliberately stops here. The request only queues for an admin, and joining the
            // community on top of it created a session — which is how someone whose access had
            // not been approved ended up inside the app. The backend returns no session for
            // this, and neither should we: they stay signed out and are told where they stand.
            setSubmittedRequest({
              orgName: outcome.orgName,
              status: toJoinRequestStatus(result.status),
              isExisting: result.isExisting,
            });
            // So that once an admin approves, the sign-in that follows asks the questions this
            // deck skipped. Only a device that asked is held up — see `pending-onboarding`.
            rememberJoinRequest(context.email, outcome.orgName);
            break;
          }
        }
      } catch (caught: unknown) {
        // The attempt did not happen, so neither did its answers; the retry writes its own.
        clearPendingOnboarding();
        setError(messageOf(caught, 'Something went wrong. Please try again.'));
        setIsCommitting(false);
        return;
      }

      // Only on the happy path: a failed commit must leave the deck resumable.
      clearProgress();
      setIsCommitting(false);

      if (outcome.kind !== 'request-enterprise-join') {
        // They have answered now, whichever way they got in; a request made earlier is moot.
        forgetJoinRequest();
        onComplete?.();
      }
    },
    [
      context.email,
      createEnterpriseWorkspace,
      createOrganization,
      joinCommunityAndSwitch,
      onComplete,
      requestEnterpriseJoin,
    ],
  );

  return {
    commit,
    isCommitting,
    error,
    clearError: () => setError(null),
    submittedRequest,
    // Drops the pending sign-in, which is what sends the route back to login.
    leaveRequest: clearPendingAuth,
  };
}
