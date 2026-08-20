// Pure, dependency-free helpers for the ticket-initiated Bitbucket PR flow.
//
// Kept free of DB / provider imports so they can be unit-tested in isolation
// and reused by both the API path and the webhook path without side effects.

import type {
  TicketPullRequestValidation,
  TicketPullRequestValidationState,
} from '@/types/ticketPullRequest';

export interface ParsedBitbucketRepo {
  projectKey: string;
  repoSlug: string;
}

export interface ParsedBitbucketPr extends ParsedBitbucketRepo {
  prId: number;
  prUrl: string; // canonical, query/fragment stripped
}

/**
 * Parse a Bitbucket repository URL into { projectKey, repoSlug }.
 * Accepts e.g. https://bitbucket.host/projects/XYNE/repos/xyne-spaces (with or
 * without a trailing path / .git suffix). Returns null when it is not a
 * recognizable Bitbucket Server repo URL.
 */
export function parseBitbucketRepoUrl(repoUrl: string): ParsedBitbucketRepo | null {
  if (!repoUrl) return null;
  const match = repoUrl.match(/\/projects\/([^/]+)\/repos\/([^/?#]+)/i);
  if (!match) return null;
  const projectKey = match[1];
  const repoSlug = match[2].replace(/\.git$/i, '');
  if (!projectKey || !repoSlug) return null;
  return { projectKey, repoSlug };
}

/**
 * Parse a Bitbucket pull-request URL into repo + prId + canonical URL.
 * Accepts .../projects/KEY/repos/SLUG/pull-requests/123[/overview?...#...].
 * Returns null when it is not a recognizable Bitbucket PR URL.
 */
export function parseBitbucketPrUrl(prUrl: string): ParsedBitbucketPr | null {
  if (!prUrl) return null;
  const match = prUrl.match(
    /^(https?:\/\/[^/]+\/projects\/([^/]+)\/repos\/([^/]+)\/pull-requests\/(\d+))/i,
  );
  if (!match) return null;
  const canonical = match[1];
  const projectKey = match[2];
  const repoSlug = match[3];
  const prId = parseInt(match[4], 10);
  if (!Number.isFinite(prId)) return null;
  return { projectKey, repoSlug, prId, prUrl: canonical };
}

// Same family of ticket-key patterns the validation service accepts:
//   "feat: XYNE-123 title", "fix: XYNE-123: title", "XYNE-123: title"
const TICKET_KEY_IN_TITLE = /^(?:(?:feat|fix):\s+)?([A-Za-z][A-Za-z0-9]*)-\s*(\d+)\s*[:\s]/;

/** Extract a normalized ticket key (e.g. "XYNE-123") from a PR title, or null. */
export function extractTicketKeyFromTitle(title: string): string | null {
  if (!title) return null;
  const m = title.trim().match(TICKET_KEY_IN_TITLE);
  if (!m) return null;
  return `${m[1].toUpperCase()}-${m[2]}`;
}

export interface ComputeValidationInput {
  ticketXyneId: string;
  prTitle?: string;
  prStatus?: string; // PRStatus
  ticketResolved?: boolean;
  duplicate?: boolean;
  /** Strict mode makes a missing/mismatched ticket key `invalid` instead of `warning`. */
  strict?: boolean;
}

/**
 * Normalize a PR's association with its ticket into a UI-ready validation
 * object. Pure — no I/O. `unknown` is returned when there is not enough
 * information (e.g. no title available) to make a judgement.
 */
export function computeValidation(input: ComputeValidationInput): TicketPullRequestValidation {
  const { ticketXyneId, prTitle, ticketResolved, duplicate, strict } = input;

  if (ticketResolved) {
    return {
      state: 'invalid',
      reason: 'ticket-resolved',
      message: `Ticket ${ticketXyneId} is already resolved.`,
    };
  }

  if (duplicate) {
    return {
      state: 'invalid',
      reason: 'duplicate-pr',
      message: `Another PR with the same branches is already linked to ${ticketXyneId}.`,
    };
  }

  if (prTitle === undefined || prTitle === null || prTitle === '') {
    return { state: 'unknown' };
  }

  const keyInTitle = extractTicketKeyFromTitle(prTitle);
  if (keyInTitle && keyInTitle.toUpperCase() === ticketXyneId.toUpperCase()) {
    return { state: 'valid' };
  }

  const state: TicketPullRequestValidationState = strict ? 'invalid' : 'warning';
  return {
    state,
    reason: 'missing-ticket-key',
    message: `PR title does not contain this ticket key (${ticketXyneId}).`,
  };
}
