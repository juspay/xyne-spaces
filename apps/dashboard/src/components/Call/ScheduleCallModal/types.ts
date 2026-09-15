import type { ScheduleCallRequest } from '../../../services/Call/callService';

export type RecurrenceFrequency = 'DAY' | 'WEEK' | 'MONTH';
export type MonthlyType = 'monthly_day' | 'monthly_nth_weekday';
export type SeriesEndsType = 'never' | 'on' | 'after';

/** Shape of a scheduled call passed in for pre-filling in edit mode. */
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
  /** Organizer of the call. A non-organizer participant may only edit the invite list. */
  organizerUserId?: string | null;
  channelId?: string | null;
  recurringSeriesId?: string | null;
  callUpdatesChannel?: string | null;
}

export interface ScheduleCallModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** When provided, opens in edit mode pre-filled with this call. */
  initialCall?: EditCallData | null;
  mode?: 'create' | 'edit';
  /** Called after a successful edit save. */
  onSuccess?: () => void;
  /** Pre-fill start/end when opening in create mode from a calendar click. */
  initialStartsAt?: Date | null;
  initialEndsAt?: Date | null;
  /** When set, restricts participants to channel members and hides the recurring option. */
  channelId?: string;
  /** When set, links the scheduled call to this thread conversation. */
  conversationId?: string;
  /** When set, pre-fills the call title in create mode. */
  initialTitle?: string;
  /** Controls how entered external invitee emails are delivered. */
  externalInviteDelivery?: ScheduleCallRequest['externalInviteDelivery'];
  /** Pre-fill participants when opening in create mode (e.g. from "Meet With" users). */
  initialParticipants?: string[] | null;
}

export interface ScheduleCallFormData {
  title: string;
  startsAt: Date;
  endsAt: Date;
  participants: string[];
  externalEmails: string[];
  /** Organizer's free-form invitation message body as HTML (written via TipTap). */
  invitationMessageHtml: string;
  /** Editable display-title for the invitation (falls back to `title`). */
  invitationTitle: string;
  /** Editable organizer name for the invitation header. */
  invitationOrganizerName: string;
  /** Editable organizer email for the invitation header. */
  invitationOrganizerEmail: string;
  /** Optional org/team name for the header band. */
  invitationOrgName: string;
}

export interface PreviousRecurrenceState {
  isRecurring: boolean;
  recurrenceFrequency: RecurrenceFrequency;
  recurrenceDays: string[];
  repeatValue: number | '';
  monthlyType: MonthlyType;
  seriesEndsType: SeriesEndsType;
  seriesEndsOn: Date | null;
  occurrenceCount: number | '';
}
