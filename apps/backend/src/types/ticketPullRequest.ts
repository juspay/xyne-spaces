// DTOs and input contracts for the ticket-initiated Bitbucket Pull Request flow.
//
// These types are the boundary between the ticket PR API/controller and the
// dashboard. They MUST NOT carry any provider credentials, tokens, or raw
// Bitbucket error payloads — only user-safe, display-ready data.

export type TicketPullRequestValidationState = 'valid' | 'warning' | 'invalid' | 'unknown';

export type TicketPullRequestValidationReason =
  | 'missing-ticket-key'
  | 'duplicate-pr'
  | 'ticket-resolved'
  | 'repository-inaccessible'
  | 'permission-denied';

export interface TicketPullRequestValidation {
  state: TicketPullRequestValidationState;
  reason?: TicketPullRequestValidationReason;
  message?: string;
}

export interface TicketPullRequestReviewer {
  name: string;
  email?: string;
  approved?: boolean;
}

/**
 * User-facing representation of a PR linked to a ticket. Mirrors the
 * `PullRequests` row plus opportunistically-computed validation/metadata.
 */
export interface TicketPullRequestDto {
  id: string;
  prId: number;
  repoName: string;
  repositoryUrl: string | null;
  sourceBranchName: string;
  destinationBranchName: string;
  status: string; // OPEN | UPDATED | MERGED | DECLINED | DELETED (PRStatus)
  prUrl: string | null;
  ticketId: string;
  validation: TicketPullRequestValidation;
  reviewers?: TicketPullRequestReviewer[];
  commentCount?: number;
  lastSyncedAt?: string;
}

export interface CreateTicketPRInput {
  /** Full Bitbucket repository URL, e.g. https://bitbucket.host/projects/KEY/repos/slug */
  repositoryUrl: string;
  sourceBranchName: string;
  destinationBranchName: string;
  title?: string;
  description?: string;
}

export interface LinkTicketPRInput {
  /** Full Bitbucket pull-request URL. */
  pullRequestUrl: string;
}

/**
 * Typed service errors. Mapped to HTTP status + `{ error }` at the controller
 * boundary so route handlers stay thin and no raw errors leak to clients.
 */
export type TicketPullRequestErrorCode =
  | 'TICKET_NOT_FOUND'
  | 'PERMISSION_DENIED'
  | 'FEATURE_DISABLED'
  | 'INVALID_INPUT'
  | 'INVALID_PR_URL'
  | 'REPOSITORY_INACCESSIBLE'
  | 'PROVIDER_ERROR'
  | 'PR_NOT_FOUND'
  | 'PROVIDER_UNSUPPORTED';

export class TicketPullRequestError extends Error {
  code: TicketPullRequestErrorCode;
  httpStatus: number;

  constructor(code: TicketPullRequestErrorCode, message: string, httpStatus: number) {
    super(message);
    this.name = 'TicketPullRequestError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}
