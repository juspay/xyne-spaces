import { format } from 'date-fns';
import { CallStatus } from '@xyne/shared';
import { formatTimeAmPm } from './dateUtils';

export type PillState = 'SCHEDULED' | 'ACTIVE' | 'ENDED' | 'CANCELLED';

export const PILL_STATUS_LABEL: Record<PillState, string> = {
  SCHEDULED: 'Upcoming',
  ACTIVE: 'Active',
  ENDED: 'Ended',
  CANCELLED: 'Cancelled',
};

export const toPillState = (status: string | null | undefined): PillState => {
  switch (status) {
    case CallStatus.CANCELLED:
      return 'CANCELLED';
    // Nothing writes IN_PROGRESS, but the other call surfaces read it as ACTIVE.
    case CallStatus.ACTIVE:
    case CallStatus.IN_PROGRESS:
      return 'ACTIVE';
    case CallStatus.ENDED:
      return 'ENDED';
    default:
      return 'SCHEDULED';
  }
};

/** Viewer-local, matching the Calls screen rather than the backend's IST-pinned copy. */
export const formatCallWindow = (startsAt: number | null, endsAt: number | null): string | null => {
  if (!startsAt) return null;
  const day = format(new Date(startsAt), 'EEE d MMM');
  const start = formatTimeAmPm(startsAt);
  return endsAt ? `${day} · ${start} – ${formatTimeAmPm(endsAt)}` : `${day} · ${start}`;
};
