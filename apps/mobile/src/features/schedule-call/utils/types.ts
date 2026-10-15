// Ported from xyne-spaces apps/dashboard ScheduleCallModal/types.ts and CallHistoryScreen/useCallHistory.ts.
import type { CallDisplayData } from '@/src/types/calls';

export type RecurrenceFrequency = 'DAY' | 'WEEK' | 'MONTH';
export type MonthlyType = 'monthly_day' | 'monthly_nth_weekday';
export type SeriesEndsType = 'never' | 'on' | 'after';

export interface EditCallData {
  id: string;
  externalId: string;
  title: string;
  startsAt: string | number | Date;
  endsAt: string | number | Date;
  participants: Array<{
    userId: string;
    email?: string | null;
    isExternal?: boolean | null;
    invitedBy?: string | null;
  }>;
  organizerUserId?: string | null;
  channelId?: string | null;
  recurringSeriesId?: string | null;
  callUpdatesChannel?: string | null;
}

export const buildEditCallData = (
  call: CallDisplayData,
  participants: EditCallData['participants'] = call.participants ?? [],
): EditCallData => ({
  id: call.id,
  externalId: call.externalId,
  title: call.title ?? '',
  startsAt: call.startsAt ?? call.createdAt,
  endsAt: call.endsAt ?? call.createdAt,
  participants: [...participants],
  organizerUserId: call.organizerId ?? call.createdByUserId,
  channelId: call.channelId,
  recurringSeriesId: call.recurringSeriesId,
  callUpdatesChannel: call.callUpdatesChannel ?? null,
});
