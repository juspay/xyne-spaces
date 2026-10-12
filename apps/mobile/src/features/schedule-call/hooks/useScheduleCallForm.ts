// Form state, validation and submit for the Schedule a call screen. Rules follow the dashboard's
// ScheduleCallModal (defaults, start/end handling, payload shape); the people/channel pickers and
// the invitation editor are reduced for v1.
import { useCallback, useMemo, useState } from 'react';

import { useSelf } from '@/src/hooks/useUsers';
import {
  ApiError,
  callService,
  type CreateRecurringSeriesRequest,
  type ScheduleCallRequest,
} from '@/src/services/Call/callService';
import { mergeTimePart } from '@/src/utils/timeSelection';
import { showMessageToast } from '@/src/utils/toast';

import {
  mergeDateWithTime,
  validateCallDateTimes,
  validateRecurringCallTimes,
} from '../utils/callTimeValidation';
import { getDefaultScheduledStartTime, getWeekdayOccurrence, toHHMM } from '../utils/dateTime';
import { usePostCallUpdates, type PostCallUpdates } from './usePostCallUpdates';
import { useRecurringCallForm } from './useRecurringCallForm';

const HOUR_MS = 60 * 60 * 1000;
const MAX_TITLE_LENGTH = 80;
/** The backend only materialises 60 days of instances; a series starting later gets none. */
const MAX_SERIES_START_AHEAD_MS = 60 * 24 * HOUR_MS;
const DEFAULT_INVITATION_HTML = "<p>You've been invited to a call. Details below.</p>";

export interface ScheduleCallUser {
  id: string;
  name: string;
  email: string;
  picture: string | null;
}

/**
 * Who is invited: individual people (a picked group is expanded into its members), or one whole
 * channel. Never a mix.
 */
export interface ScheduleCallParticipants {
  users: ScheduleCallUser[];
  channel: { id: string; name: string } | null;
}

export const NO_PARTICIPANTS: ScheduleCallParticipants = { users: [], channel: null };

export const countParticipants = ({ users, channel }: ScheduleCallParticipants): number =>
  channel ? 1 : users.length;

/** A channel goes as `channelId` (the backend invites its members); otherwise as user ids. */
const toRecipients = ({ users, channel }: ScheduleCallParticipants): Recipients =>
  channel ? { channelId: channel.id } : { targetUserIds: users.map(u => u.id) };

type Recipients = { channelId: string } | { targetUserIds: string[] };

// ponytail: presets only. Add 'custom' (and the Custom editor) when that screen exists.
export type RepeatOptionId = 'none' | 'daily' | 'weekdays' | 'monthly';

/** Each preset has its own frequency, so the frequency alone says which one is picked. */
const REPEAT_OPTION_BY_FREQUENCY = { DAY: 'daily', WEEK: 'weekdays', MONTH: 'monthly' } as const;

const formatCallDuration = (ms: number): string => {
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
};

export const useScheduleCallForm = (): ScheduleCallForm => {
  const self = useSelf();
  const firstName = (self?.name ?? '').trim().split(/\s+/)[0] ?? '';
  const defaultTitle = firstName ? `${firstName}'s Call` : 'New call';

  const [defaultStart] = useState(getDefaultScheduledStartTime);
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  // Start and end move together (changing one can push the other), so they share one state
  // object: updates are atomic and the setters below stay referentially stable.
  const [range, setRange] = useState(() => ({
    startsAt: defaultStart,
    endsAt: new Date(defaultStart.getTime() + HOUR_MS),
  }));
  const { startsAt, endsAt } = range;
  const [participants, setParticipants] = useState(NO_PARTICIPANTS);
  const participantCount = countParticipants(participants);
  const [guests, setGuests] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const title = titleDraft ?? defaultTitle;

  const recurrence = useRecurringCallForm({ startsAt });
  const {
    isRecurring,
    recurrenceFrequency,
    buildRrule,
    setIsRecurring,
    setRecurrenceFrequency,
    setRecurrenceDays,
    setMonthlyType,
  } = recurrence;

  // A series is sent as the local HH:mm of its start and end. Deriving them here (instead of
  // syncing the hook's own copies) means they can never drift from the pickers.
  const recurringStartTime = toHHMM(startsAt);
  const recurringEndTime = toHHMM(endsAt);

  const postUpdates = usePostCallUpdates({ participantCount });
  const selectedChannelId = postUpdates.selectedChannel?.id;

  // ── Dates and times ───────────────────────────────────────────────────────
  /** Moving the start date keeps the call's length (at least 1h), as on the dashboard. */
  const setStartDate = useCallback((date: Date): void => {
    setRange(({ startsAt: start, endsAt: end }) => {
      const merged = mergeDateWithTime(date, start);
      const length = Math.max(end.getTime() - start.getTime(), HOUR_MS);
      return { startsAt: merged, endsAt: new Date(merged.getTime() + length) };
    });
  }, []);

  /** A start at or after the end pushes the end to start + 1h, as on the dashboard. */
  const setStartTime = useCallback((time: Date): void => {
    setRange(({ startsAt: start, endsAt: end }) => {
      const next = mergeTimePart(start, time);
      return { startsAt: next, endsAt: next >= end ? new Date(next.getTime() + HOUR_MS) : end };
    });
  }, []);

  const setEndDate = useCallback((date: Date): void => {
    setRange(prev => ({ ...prev, endsAt: mergeDateWithTime(date, prev.endsAt) }));
  }, []);

  const setEndTime = useCallback((time: Date): void => {
    setRange(prev => ({ ...prev, endsAt: mergeTimePart(prev.endsAt, time) }));
  }, []);

  // ── Repeat (the dashboard dropdown's presets; Custom… comes later) ─────────
  const repeatOptionId: RepeatOptionId = isRecurring
    ? REPEAT_OPTION_BY_FREQUENCY[recurrenceFrequency]
    : 'none';

  const selectRepeat = useCallback(
    (id: RepeatOptionId): void => {
      if (id === 'none') {
        setIsRecurring(false);
        return;
      }
      setIsRecurring(true);
      if (id === 'daily') {
        setRecurrenceFrequency('DAY');
        setRecurrenceDays([]);
      } else if (id === 'weekdays') {
        setRecurrenceFrequency('WEEK');
        setRecurrenceDays(['MO', 'TU', 'WE', 'TH', 'FR']);
      } else {
        setRecurrenceFrequency('MONTH');
        setMonthlyType('monthly_nth_weekday');
        setRecurrenceDays([]);
      }
    },
    [setIsRecurring, setMonthlyType, setRecurrenceDays, setRecurrenceFrequency],
  );

  const monthlyRepeatLabel = useMemo(() => {
    const { weekday, ordinalWord } = getWeekdayOccurrence(startsAt);
    return `Monthly on ${ordinalWord} ${weekday}`;
  }, [startsAt]);

  // ── Validation ────────────────────────────────────────────────────────────
  const timeErrors = useMemo(() => {
    const { startsAtError, endsAtError } = validateCallDateTimes(startsAt, endsAt);
    if (!isRecurring) return { startsAtError, endsAtError };
    const recurringError = validateRecurringCallTimes(recurringStartTime, recurringEndTime);
    const tooFar =
      startsAt.getTime() - Date.now() > MAX_SERIES_START_AHEAD_MS
        ? 'A repeating call can start at most 60 days ahead'
        : null;
    return {
      startsAtError: startsAtError ?? tooFar,
      endsAtError: endsAtError ?? recurringError,
    };
  }, [endsAt, isRecurring, recurringEndTime, recurringStartTime, startsAt]);

  const titleError =
    title.trim().length === 0
      ? 'Add a title'
      : title.length > MAX_TITLE_LENGTH
        ? `Title must be less than ${MAX_TITLE_LENGTH} characters`
        : null;

  // What is still missing, in the dashboard's wording; shown when the disabled action is tapped.
  const blockers = [
    titleError,
    participantCount === 0 ? 'Add at least one person' : null,
    timeErrors.startsAtError,
    timeErrors.endsAtError,
    postUpdates.updateChannelError ? 'Pick a channel for post updates' : null,
  ].filter((reason): reason is string => reason !== null);
  const canSubmit = !isSubmitting && blockers.length === 0;

  // ── Submit (payload as the dashboard's onSubmit builds it) ────────────────
  const submit = useCallback(async (): Promise<boolean> => {
    if (!canSubmit) return false;
    setIsSubmitting(true);
    try {
      const recipients = toRecipients(participants);
      const callUpdatesChannel =
        postUpdates.postCallUpdates && selectedChannelId
          ? { callUpdatesChannel: selectedChannelId }
          : {};
      const invitation = {
        bodyHtml: DEFAULT_INVITATION_HTML,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      };

      if (isRecurring) {
        const request: CreateRecurringSeriesRequest = {
          title: title.trim(),
          ...recipients,
          ...callUpdatesChannel,
          timezone: invitation.timezone,
          recurrenceRule: buildRrule(),
          startTime: recurringStartTime,
          endTime: recurringEndTime,
          startsOn: startsAt.getTime(),
          ...(guests.length > 0 ? { externalInvitees: guests, invitation } : {}),
        };
        await callService.createRecurringSeries(request);
        showMessageToast('Recurring series created', 'success');
      } else {
        const request: ScheduleCallRequest = {
          title: title.trim(),
          startsAt: startsAt.getTime(),
          endsAt: endsAt.getTime(),
          ...recipients,
          ...callUpdatesChannel,
          ...(guests.length > 0
            ? { externalInvitees: guests, externalInviteDelivery: 'standalone', invitation }
            : {}),
        };
        await callService.scheduleCall(request);
        showMessageToast(
          guests.length > 0
            ? `Call scheduled. Invitation sent to ${guests.length} guest(s).`
            : 'Call scheduled',
          'success',
        );
      }
      return true;
    } catch (error) {
      showMessageToast(
        error instanceof ApiError && error.message ? error.message : 'Failed to schedule call',
        'error',
      );
      return false;
    } finally {
      setIsSubmitting(false);
    }
  }, [
    canSubmit,
    endsAt,
    guests,
    isRecurring,
    postUpdates.postCallUpdates,
    selectedChannelId,
    buildRrule,
    recurringEndTime,
    recurringStartTime,
    participants,
    startsAt,
    title,
  ]);

  return {
    title,
    setTitle: setTitleDraft,
    titleError,
    startsAt,
    endsAt,
    durationLabel: formatCallDuration(endsAt.getTime() - startsAt.getTime()),
    setStartDate,
    setStartTime,
    setEndDate,
    setEndTime,
    startsAtError: timeErrors.startsAtError,
    endsAtError: timeErrors.endsAtError,
    repeatOptionId,
    repeatLabel: recurrence.recurrenceLabel,
    monthlyRepeatLabel,
    selectRepeat,
    participants,
    setParticipants,
    guests,
    setGuests,
    postUpdates,
    canSubmit,
    blockers,
    isSubmitting,
    submit,
  };
};

export interface ScheduleCallForm {
  title: string;
  setTitle: (title: string) => void;
  titleError: string | null;
  startsAt: Date;
  endsAt: Date;
  durationLabel: string;
  setStartDate: (date: Date) => void;
  setStartTime: (time: Date) => void;
  setEndDate: (date: Date) => void;
  setEndTime: (time: Date) => void;
  startsAtError: string | null;
  endsAtError: string | null;
  repeatOptionId: RepeatOptionId;
  repeatLabel: string;
  monthlyRepeatLabel: string;
  selectRepeat: (id: RepeatOptionId) => void;
  participants: ScheduleCallParticipants;
  setParticipants: (participants: ScheduleCallParticipants) => void;
  guests: string[];
  setGuests: (emails: string[]) => void;
  postUpdates: PostCallUpdates;
  canSubmit: boolean;
  /** Why the action is disabled; empty when it can be submitted. */
  blockers: string[];
  isSubmitting: boolean;
  submit: () => Promise<boolean>;
}
