// Form state, validation and submit for the Schedule a call screen. Rules follow the dashboard's
// ScheduleCallModal (defaults, start/end handling, payload shape); the people/channel pickers and
// the invitation editor are reduced for v1.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useSelf } from '@/src/hooks/useUsers';
import { stateMachineActor } from '@/src/machines/stateMachine';
import {
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
import { getEditPrefill } from '../utils/editPrefill';
import { toRecipients } from '../utils/recipients';
import type { EditCallData } from '../utils/types';
import { useChannelMembers } from './useChannelMembers';
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
  channel: { id: string; name: string; excludedUserIds?: string[] } | null;
}

export const NO_PARTICIPANTS: ScheduleCallParticipants = { users: [], channel: null };

export const countParticipants = ({ users, channel }: ScheduleCallParticipants): number =>
  channel ? 1 : users.length;

// ponytail: presets only. Add 'custom' (and the Custom editor) when that screen exists.
export type RepeatChoice = 'none' | 'daily' | 'weekdays' | 'monthly';
export type RepeatOptionId = RepeatChoice | 'custom';

/** Each preset has its own frequency, so the frequency alone says which one is picked. */
const REPEAT_OPTION_BY_FREQUENCY = { DAY: 'daily', WEEK: 'weekdays', MONTH: 'monthly' } as const;

const formatCallDuration = (ms: number): string => {
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
};

export const useScheduleCallForm = (editCall: EditCallData | null = null): ScheduleCallForm => {
  const self = useSelf();
  const firstName = (self?.name ?? '').trim().split(/\s+/)[0] ?? '';
  const defaultTitle = firstName ? `${firstName}'s Call` : 'New call';

  const [prefill] = useState(() => {
    if (!editCall) return null;
    const { users, visibleChannels } = stateMachineActor.getSnapshot().context;
    return getEditPrefill(editCall, self?.id, users, visibleChannels);
  });

  const [defaultStart] = useState(getDefaultScheduledStartTime);
  const [titleDraft, setTitleDraft] = useState<string | null>(prefill?.title ?? null);
  // Start and end move together (changing one can push the other), so they share one state
  // object: updates are atomic and the setters below stay referentially stable.
  const [range, setRange] = useState(() => ({
    startsAt: prefill?.startsAt ?? defaultStart,
    endsAt: prefill?.endsAt ?? new Date(defaultStart.getTime() + HOUR_MS),
  }));
  const { startsAt, endsAt } = range;
  const [participants, setParticipants] = useState(prefill?.participants ?? NO_PARTICIPANTS);
  const participantCount = countParticipants(participants);
  const [guests, setGuests] = useState<string[]>(prefill?.guests ?? []);

  const channelMembers = useChannelMembers(participants.channel?.id ?? null);
  const excludedIds = useMemo(
    () => new Set(participants.channel?.excludedUserIds),
    [participants.channel?.excludedUserIds],
  );
  const allMembersExcluded =
    !!channelMembers &&
    channelMembers.length > 0 &&
    channelMembers.every(m => excludedIds.has(m.id));
  // Without the member list the unchecked people can't be sent, which would invite the whole channel.
  const membersLoading = excludedIds.size > 0 && !channelMembers;

  // As on the dashboard, an edited channel call starts with the members who were not on it
  // unchecked, once the member list is in, so the form shows who is really invited.
  const exclusionsSeeded = useRef(false);
  useEffect(() => {
    const channel = participants.channel;
    if (exclusionsSeeded.current || !editCall || !channelMembers || !channel) return;
    if (channel.id !== editCall.channelId) return;
    exclusionsSeeded.current = true;
    const invited = new Set(editCall.participants.filter(p => !p.isExternal).map(p => p.userId));
    const excludedUserIds = channelMembers.filter(m => !invited.has(m.id)).map(m => m.id);
    if (excludedUserIds.length > 0) {
      setParticipants({ ...participants, channel: { ...channel, excludedUserIds } });
    }
  }, [channelMembers, editCall, participants]);
  const setExcludedMembers = useCallback((excludedUserIds: string[]): void => {
    setParticipants(prev =>
      prev.channel ? { ...prev, channel: { ...prev.channel, excludedUserIds } } : prev,
    );
  }, []);
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

  const isEditMode = editCall !== null;
  // ponytail: editing one occurrence only. "Apply to the whole series" needs per-field change
  // tracking (the series endpoint shifts every occurrence from startTime, and replaces the people
  // and guest lists) and must not send the phone's timezone; add it with those in place.
  const isSeriesSubmit = !isEditMode && isRecurring;

  const selfId = self?.id;
  const participantsOnly =
    !!editCall?.organizerUserId && !!selfId && editCall.organizerUserId !== selfId;
  const lockedUserIds = useMemo(
    () =>
      participantsOnly && editCall
        ? new Set(
            editCall.participants
              .filter(
                p =>
                  !p.isExternal &&
                  p.userId !== selfId &&
                  (p.userId === editCall.organizerUserId || p.invitedBy !== selfId),
              )
              .map(p => p.userId),
          )
        : undefined,
    [editCall, participantsOnly, selfId],
  );

  // A series is sent as the local HH:mm of its start and end. Deriving them here (instead of
  // syncing the hook's own copies) means they can never drift from the pickers.
  const recurringStartTime = toHHMM(startsAt);
  const recurringEndTime = toHHMM(endsAt);

  const postUpdates = usePostCallUpdates({
    participantCount,
    initialChannel: prefill?.callUpdatesChannel ?? null,
  });
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
    (id: RepeatChoice): void => {
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
  const startsAtChanged = !editCall || startsAt.getTime() !== new Date(editCall.startsAt).getTime();
  const timeErrors = useMemo(() => {
    if (participantsOnly) return { startsAtError: null, endsAtError: null };
    const { startsAtError, endsAtError } = validateCallDateTimes(startsAt, endsAt);
    if (!isSeriesSubmit) {
      return { startsAtError: startsAtChanged ? startsAtError : null, endsAtError };
    }
    const recurringError = validateRecurringCallTimes(recurringStartTime, recurringEndTime);
    const tooFar =
      startsAt.getTime() - Date.now() > MAX_SERIES_START_AHEAD_MS
        ? 'A repeating call can start at most 60 days ahead'
        : null;
    return {
      startsAtError: startsAtError ?? tooFar,
      endsAtError: endsAtError ?? recurringError,
    };
  }, [
    endsAt,
    isSeriesSubmit,
    participantsOnly,
    recurringEndTime,
    recurringStartTime,
    startsAt,
    startsAtChanged,
  ]);

  const titleError = participantsOnly
    ? null
    : title.trim().length === 0
      ? 'Add a title'
      : title.length > MAX_TITLE_LENGTH
        ? `Title must be less than ${MAX_TITLE_LENGTH} characters`
        : null;

  // What is still missing, in the dashboard's wording; shown when the disabled action is tapped.
  const blockers = [
    titleError,
    participantCount === 0 ? 'Add at least one person' : null,
    allMembersExcluded ? 'Include at least one channel participant' : null,
    membersLoading ? 'Loading channel members…' : null,
    timeErrors.startsAtError,
    timeErrors.endsAtError,
    postUpdates.updateChannelError && !participantsOnly ? 'Pick a channel for post updates' : null,
  ].filter((reason): reason is string => reason !== null);
  const canSubmit = !isSubmitting && blockers.length === 0;

  // ── Submit (payload as the dashboard's onSubmit builds it) ────────────────
  // State alone can let a second tap through before React re-renders; the ref closes that gap.
  const inFlight = useRef(false);
  const submit = useCallback(async (): Promise<boolean> => {
    if (!canSubmit || inFlight.current) return false;
    inFlight.current = true;
    setIsSubmitting(true);
    try {
      const recipients = toRecipients(participants, channelMembers);
      const callUpdatesChannel =
        postUpdates.postCallUpdates && selectedChannelId
          ? { callUpdatesChannel: selectedChannelId }
          : {};
      const invitation = {
        bodyHtml: DEFAULT_INVITATION_HTML,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      };

      if (editCall) {
        await callService.updateScheduledCall(
          editCall.externalId,
          participantsOnly
            ? { targetUserIds: participants.users.map(user => user.id) }
            : {
                title: title.trim(),
                ...(startsAtChanged ? { startsAt: startsAt.getTime() } : {}),
                ...(endsAt.getTime() !== new Date(editCall.endsAt).getTime()
                  ? { endsAt: endsAt.getTime() }
                  : {}),
                ...recipients,
                ...callUpdatesChannel,
                externalInvitees: guests,
              },
        );
        showMessageToast('Call updated', 'success');
        return true;
      }

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
    } catch {
      showMessageToast(editCall ? 'Error updating call' : 'Failed to schedule call', 'error');
      return false;
    } finally {
      inFlight.current = false;
      setIsSubmitting(false);
    }
  }, [
    canSubmit,
    channelMembers,
    editCall,
    endsAt,
    guests,
    isRecurring,
    participantsOnly,
    startsAtChanged,
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
    isEditMode,
    participantsOnly,
    lockedUserIds,
    participants,
    setParticipants,
    setExcludedMembers,
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
  selectRepeat: (id: RepeatChoice) => void;
  isEditMode: boolean;
  participantsOnly: boolean;
  lockedUserIds: ReadonlySet<string> | undefined;
  participants: ScheduleCallParticipants;
  setParticipants: (participants: ScheduleCallParticipants) => void;
  /** Sets which members of the picked channel are left out. */
  setExcludedMembers: (excludedUserIds: string[]) => void;
  guests: string[];
  setGuests: (emails: string[]) => void;
  postUpdates: PostCallUpdates;
  canSubmit: boolean;
  /** Why the action is disabled; empty when it can be submitted. */
  blockers: string[];
  isSubmitting: boolean;
  submit: () => Promise<boolean>;
}
