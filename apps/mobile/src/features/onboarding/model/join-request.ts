/**
 * What a person is told after asking an existing company workspace for access.
 *
 * Asking is not joining. The backend queues a `WorkspaceJoinRequest` for an admin and returns
 * without creating a session, so the person has no workspace to be in until it is approved — the
 * dashboard answers that by leaving them on the same screen with a message and no way into the
 * app. This is that message, kept pure so the wording and the status mapping can be tested
 * without a screen.
 *
 * Statuses mirror the backend's `WorkspaceJoinRequestStatus`; `status` is also accepted in the
 * `REQUEST_*` spelling the join endpoint uses for its top-level result.
 */

export const JoinRequestStatus = {
  /** Newly submitted, or submitted earlier and still waiting for an admin. */
  PENDING: 'pending',
  /** An admin accepted it. They now have a workspace, but not a session — signing in again gets one. */
  APPROVED: 'approved',
  /** An admin declined it. */
  REJECTED: 'rejected',
} as const;
export type JoinRequestStatus = (typeof JoinRequestStatus)[keyof typeof JoinRequestStatus];

/**
 * Normalises whatever status string the backend sent.
 *
 * Anything unrecognised reads as pending: the request was accepted by the server, so the honest
 * answer to an unfamiliar status is "it is with an admin", never "it failed" or "you are in".
 */
export function toJoinRequestStatus(raw: string | null | undefined): JoinRequestStatus {
  const status = (raw ?? '').toUpperCase();

  if (status === 'APPROVED') {
    return JoinRequestStatus.APPROVED;
  }
  if (status === 'REJECTED' || status === 'REQUEST_REJECTED') {
    return JoinRequestStatus.REJECTED;
  }
  return JoinRequestStatus.PENDING;
}

export interface SubmittedJoinRequest {
  orgName: string;
  status: JoinRequestStatus;
  /** The backend already had a request from this address, so nothing new was queued. */
  isExisting: boolean;
}

export interface JoinRequestMessage {
  title: string;
  body: string;
  /** What the single button says. Every outcome leaves via sign-in; only the framing differs. */
  actionLabel: string;
}

export function describeJoinRequest(request: SubmittedJoinRequest): JoinRequestMessage {
  const { orgName, status, isExisting } = request;

  switch (status) {
    case JoinRequestStatus.APPROVED:
      return {
        title: 'You’re approved',
        body: `Your request to join ${orgName} was approved. Sign in again to continue.`,
        actionLabel: 'Continue to sign in',
      };

    case JoinRequestStatus.REJECTED:
      return {
        title: 'Request declined',
        body: `An admin at ${orgName} declined your request to join. You can sign in with a different account.`,
        actionLabel: 'Back to sign in',
      };

    case JoinRequestStatus.PENDING:
      return isExisting
        ? {
            title: 'Request already sent',
            body: `Your request to join ${orgName} is still waiting for an admin. You can use Xyne once it is approved.`,
            actionLabel: 'Back to sign in',
          }
        : {
            title: 'Request sent',
            body: `Your request to join ${orgName} has been sent to an admin. You can use Xyne once it is approved.`,
            actionLabel: 'Back to sign in',
          };
  }
}
