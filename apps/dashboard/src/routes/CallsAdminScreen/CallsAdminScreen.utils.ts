import type {
  CallAdminAction,
  CallAdminSummaryStatus,
  CallAdminUser,
} from '../../services/Call/callAdminService';

export const CALLS_ADMIN_TRACK = 'Calls Admin';

export type BadgeVariant = 'primary' | 'secondary' | 'destructive' | 'success' | 'outline';

export const ACTION_LABELS: Record<CallAdminAction, string> = {
  cancel: 'Cancel',
  forceEnd: 'Force end',
  unlinkTranscript: 'Unlink transcript',
  regenerateSummary: 'Regenerate summary',
  reprocessTranscript: 'Reprocess transcript',
  changeOwner: 'Change owner…',
};

export const formatDateTime = (value: string | null): string =>
  value ? new Date(value).toLocaleString() : '—';

/** `IN_PROGRESS` → `In progress`. */
export const titleCase = (value: string): string =>
  value.charAt(0) + value.slice(1).toLowerCase().replace(/_/g, ' ');

export const userLabel = (user: CallAdminUser): string => user.name || user.email || user.id;

export const callStatusVariant = (status: string): BadgeVariant => {
  switch (status) {
    case 'ACTIVE':
    case 'IN_PROGRESS':
      return 'primary';
    case 'SCHEDULED':
      return 'outline';
    default:
      return 'secondary';
  }
};

export const summaryStatusVariant = (status: CallAdminSummaryStatus): BadgeVariant => {
  switch (status) {
    case 'ready':
      return 'success';
    case 'failed':
      return 'destructive';
    default:
      return 'primary';
  }
};
