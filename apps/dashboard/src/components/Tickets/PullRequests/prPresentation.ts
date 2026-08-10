// Presentation helpers for the ticket PR panel: colors + labels for PR status
// and validation state. Pure, no React — easy to reuse and unit-test.

import type {
  TicketPrValidationState,
  TicketPullRequest,
} from '../../../api/ticketPullRequestsApi';

export interface Swatch {
  label: string;
  color: string; // text color
  background: string; // badge background
}

export function statusSwatch(status: string): Swatch {
  switch ((status || '').toUpperCase()) {
    case 'MERGED':
      return { label: 'Merged', color: '#6f42c1', background: '#f3edff' };
    case 'DECLINED':
      return { label: 'Declined', color: '#b42318', background: '#fef3f2' };
    case 'DELETED':
      return { label: 'Deleted', color: '#667085', background: '#f2f4f7' };
    case 'UPDATED':
      return { label: 'Updated', color: '#175cd3', background: '#eff8ff' };
    case 'OPEN':
    default:
      return { label: 'Open', color: '#067647', background: '#ecfdf3' };
  }
}

export function validationSwatch(state: TicketPrValidationState): Swatch {
  switch (state) {
    case 'valid':
      return { label: 'Valid', color: '#067647', background: '#ecfdf3' };
    case 'warning':
      return { label: 'Warning', color: '#b54708', background: '#fffaeb' };
    case 'invalid':
      return { label: 'Invalid', color: '#b42318', background: '#fef3f2' };
    case 'unknown':
    default:
      return { label: 'Unchecked', color: '#667085', background: '#f2f4f7' };
  }
}

export function branchLabel(pr: TicketPullRequest): string {
  if (!pr.sourceBranchName && !pr.destinationBranchName) return '';
  return `${pr.sourceBranchName || '?'} → ${pr.destinationBranchName || '?'}`;
}
