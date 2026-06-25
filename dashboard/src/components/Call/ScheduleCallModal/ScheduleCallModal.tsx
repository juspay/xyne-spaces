import React, { useMemo, useCallback, useEffect, useState, useRef } from 'react';
import { RRule } from 'rrule';
import { Button } from '../../ui/Button';
import Input from '../../ui/Input';
import { ChannelScopeType, ChannelVisibility, isDeskChannelType } from '@xyne/shared';
import { useSelf, useActiveUsers, useUsers } from '../../../hooks/useUsers';
import { useZero } from '../../../hooks/useZero';
import { isUserDeactivated } from '../../../utils/userDisplayName';
import { useAllVisibleChannels, useChannel } from '../../../hooks/useChannels';
import { useUserGroupSearch } from '../../../hooks/useUserGroupSearch';
import { callService, type ScheduleCallRequest } from '../../../services/Call/callService';
import DOMPurify from 'dompurify';
import { queries } from '../../../zero/queries';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { cn } from '../../../utils/classNames';
import Dialog from '../../ui/Dialog';
import type { DropdownListItemType } from '../../ui/Combobox/Combobox.types';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../ui/dropdown-menu';
import { ChevronDown, ChevronUp, Hash, Info, Lock, Users, X } from 'lucide-react';
import { DatePicker } from '../../ui/DatePicker/DatePicker';
import { TimePicker } from '../../ui/TimePicker/TimePicker';
import { RadioGroup, Radio } from '../../ui/RadioGroup/RadioGroup';
import { SearchParticipants } from '../../../routes/CallHistoryScreen/SearchParticipants';
import Avatar from '../../ui/Avatar/Avatar';
import { Controller, useForm } from 'react-hook-form';
import { getUserDisplayName } from '../../../utils/userDisplayName';
import {
  parseParticipants,
  matchParticipants,
  looksLikeBulkEntry,
} from '../../../utils/participantUtils';
import { toast } from 'sonner';
import { AnimatePresence, motion } from 'framer-motion';
import { Checkbox } from '../../ui/Checkbox/Checkbox';
import { Tooltip } from '../../ui/Tooltip/Tooltip';
import { ExternalInviteesInput } from './ExternalInviteesInput';
import { InvitationPreviewStep } from './InvitationPreviewStep';
import {
  validateCallDateTimes,
  validateRecurringCallTimes,
  mergeDateWithTime,
} from '../../../utils/callTimeValidation';

/** Shape of a scheduled call passed in for pre-filling in edit mode. */
export interface EditCallData {
  id: string;
  externalId: string;
  title: string;
  startsAt: string | number | Date;
  endsAt: string | number | Date;
  participants: Array<{ userId: string }>;
  channelId?: string | null;
  recurringSeriesId?: string | null;
  callUpdatesChannel?: string | null;
}

interface ScheduleCallModalProps {
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
  /** When true (ticket threads), shows the Guests email-chip input below the
   *  participant picker, and routes the submit through Step 2 (invitation
   *  preview) when at least one guest is added. */
  enableExternalInvitees?: boolean;
  /** Pre-fill participants when opening in create mode (e.g. from "Meet With" users). */
  initialParticipants?: string[] | null;
}

interface ScheduleCallFormData {
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

const DAY_OPTIONS: { key: string; label: string }[] = [
  { key: 'SU', label: 'S' },
  { key: 'MO', label: 'M' },
  { key: 'TU', label: 'T' },
  { key: 'WE', label: 'W' },
  { key: 'TH', label: 'T' },
  { key: 'FR', label: 'F' },
  { key: 'SA', label: 'S' },
];

const DAY_KEYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;
const ORDINAL_WORDS = ['first', 'second', 'third', 'fourth', 'fifth'];

const toHHMM = (date: Date | null | undefined): string => {
  if (!date) return '00:00';
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
};

const getWeekdayOccurrence = (
  date: Date,
): { occurrence: number; weekday: string; isLast: boolean; ordinalWord: string } => {
  // Return default if date is invalid
  if (!date || !(date instanceof Date) || isNaN(date.getTime())) {
    return { occurrence: 1, weekday: 'Monday', isLast: false, ordinalWord: 'first' };
  }
  const year = date.getFullYear();
  const month = date.getMonth();
  const dayOfMonth = date.getDate();
  const targetWeekday = date.getDay();

  // Count occurrences of this weekday up to and including current date
  let occurrence = 0;
  for (let d = 1; d <= dayOfMonth; d++) {
    const tempDate = new Date(year, month, d);
    if (tempDate.getDay() === targetWeekday) {
      occurrence++;
    }
  }

  // Check if this is the last occurrence in the month
  const lastDayOfMonth = new Date(year, month + 1, 0).getDate();
  let isLast = true;
  for (let d = dayOfMonth + 1; d <= lastDayOfMonth; d++) {
    const tempDate = new Date(year, month, d);
    if (tempDate.getDay() === targetWeekday) {
      isLast = false;
      break;
    }
  }

  const WEEKDAY_NAMES = [
    'Sunday',
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
  ];

  return {
    occurrence,
    weekday: WEEKDAY_NAMES[targetWeekday] ?? 'Monday',
    isLast,
    ordinalWord: ORDINAL_WORDS[occurrence - 1] || `${occurrence}th`,
  };
};

export const ScheduleCallModal: React.FC<ScheduleCallModalProps> = ({
  isOpen,
  onClose,
  initialCall,
  mode = 'create',
  onSuccess,
  initialStartsAt,
  initialEndsAt,
  channelId: threadChannelId,
  conversationId: threadConversationId,
  initialTitle,
  enableExternalInvitees = false,
  initialParticipants,
}) => {
  const user = useSelf();
  const zero = useZero();
  const allUsers = useActiveUsers();
  const fullUserList = useUsers();
  const allVisibleChannels = useAllVisibleChannels();

  // When opened from a thread, fetch channel participants to restrict the picker
  const [channelParticipants] = useCachedQuery(
    queries.channelParticipants({ channelId: threadChannelId ?? '' }),
    { enabled: isOpen && !!threadChannelId },
  );
  const channelParticipantUserIds = useMemo(() => {
    if (!threadChannelId || !channelParticipants) return null;
    return new Set(channelParticipants.map((p: { userId: string }) => p.userId));
  }, [threadChannelId, channelParticipants]);

  // Thread/ticket emails — used to prefill Guests with addresses already on the thread.
  const [ticketEmails] = useCachedQuery(
    queries.getEmailsForTicket({ conversationId: threadConversationId ?? '' }),
    { enabled: isOpen && !!threadConversationId && enableExternalInvitees },
  );

  const threadChannel = useChannel(threadChannelId ?? '');
  const channelOwnEmail = useMemo(() => {
    const name = threadChannel?.name?.trim().toLowerCase();
    if (!name) return null;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(name) ? name : null;
  }, [threadChannel?.name]);

  // Step 1 (participants) / Step 2 (invitation preview) + direction used for
  // the slide animation between them.
  const [step, setStep] = React.useState<'participants' | 'invitation'>('participants');
  const [slideDir, setSlideDir] = React.useState<1 | -1>(1);
  const goToStep = useCallback((next: 'participants' | 'invitation') => {
    setSlideDir(next === 'invitation' ? 1 : -1);
    setStep(next);
  }, []);

  const isEditMode = mode === 'edit' && !!initialCall;
  const [showCustomPanel, setShowCustomPanel] = React.useState(false);

  // Store previous recurrence state
  const [previousRecurrenceState, setPreviousRecurrenceState] = useState<{
    isRecurring: boolean;
    recurrenceFrequency: 'DAY' | 'WEEK' | 'MONTH';
    recurrenceDays: string[];
    repeatValue: number | '';
    monthlyType: 'monthly_day' | 'monthly_nth_weekday';
    seriesEndsType: 'never' | 'on' | 'after';
    seriesEndsOn: Date | null;
    occurrenceCount: number | '';
  } | null>(null);

  // For recurring calls in edit mode — checkbox to edit the whole series
  const [editEntireSeries, setEditEntireSeries] = useState(false);
  const [initialized, setInitialized] = useState(false);

  // Post call updates feature
  const [postCallUpdates, setPostCallUpdates] = useState(false);
  const [updateChannelId, setUpdateChannelId] = useState<string | null>(null);
  const [channelSearchQuery, setChannelSearchQuery] = useState('');
  const [channelPickerOpen, setChannelPickerOpen] = useState(false);
  const channelInputRef = useRef<HTMLInputElement>(null);

  // Fetch recurring call series data via Zero — only when the modal is open and
  // in edit mode for a recurring call, so the query doesn't run when the popup is closed.
  // Always fetch (not just when editEntireSeries) so the dropdown shows correct values.
  const [seriesData] = useCachedQuery(
    queries.recurringSeriesById({ seriesId: initialCall?.recurringSeriesId ?? '' }),
    { enabled: isOpen && isEditMode && !!initialCall?.recurringSeriesId },
  );

  const getDefaultScheduledStartTime = (): Date => {
    const now = new Date();
    const minutes = now.getMinutes();

    const result = new Date(now);

    // Round to nearest 30-minute interval
    if (minutes < 30) {
      result.setMinutes(30, 0, 0); // between 00-29, round to 30
    } else {
      result.setHours(result.getHours() + 1, 0, 0, 0);
    }

    const gapMinutes = (result.getTime() - now.getTime()) / (1000 * 60); // check if gap is less than 25 minutes
    if (gapMinutes < 25) {
      result.setMinutes(result.getMinutes() + 30);
    }

    return result;
  };

  // Filter for DEFAULT public channels only (not DMs, not EMAIL/Desk channels)
  const channels = useMemo(() => {
    return allVisibleChannels.filter(
      channel => channel.scopeType === ChannelScopeType.DEFAULT && !isDeskChannelType(channel.type),
    );
  }, [allVisibleChannels]);

  // Combobox items for the "post call updates" channel picker — filtered by search query
  const channelComboboxItems = useMemo((): DropdownListItemType[] => {
    const q = channelSearchQuery.toLowerCase();
    return channels
      .filter(c => c.name.toLowerCase().includes(q))
      .map(c => ({
        value: c.id,
        label: c.name,
        leftSlot:
          c.visibility === ChannelVisibility.PRIVATE ? (
            <Lock className='size-3.5 text-gray-600' strokeWidth={2.3} />
          ) : (
            <Hash className='size-3.5 text-gray-600' strokeWidth={2.3} />
          ),
      }));
  }, [channels, channelSearchQuery]);

  const selectedChannelItem = useMemo((): DropdownListItemType | null => {
    if (!updateChannelId) return null;
    const channel = channels.find(c => c.id === updateChannelId);
    if (!channel) return null;
    return {
      value: channel.id,
      label: channel.name,
      leftSlot:
        channel.visibility === ChannelVisibility.PRIVATE ? (
          <Lock className='size-3.5 text-gray-600' strokeWidth={2.3} />
        ) : (
          <Hash className='size-3.5 text-gray-600' strokeWidth={2.3} />
        ),
    };
  }, [updateChannelId, channels]);

  const defaultStart = getDefaultScheduledStartTime();

  const {
    control,
    handleSubmit,
    watch,
    setValue,
    reset,
    setError,
    clearErrors,
    formState: { errors, isSubmitting },
  } = useForm<ScheduleCallFormData>({
    defaultValues: {
      title: (() => {
        const displayName = getUserDisplayName(user);
        return displayName !== 'Unknown' ? `${displayName.split(' ')[0]}'s Call` : '';
      })(),
      startsAt: defaultStart,
      endsAt: new Date(defaultStart.getTime() + 60 * 60 * 1000), // Default 1 hours after start time
      participants: [],
      externalEmails: [],
      invitationMessageHtml: "<p>You've been invited to a call. Details below.</p>",
      invitationTitle: '',
      invitationOrganizerName: '',
      invitationOrganizerEmail: '',
      invitationOrgName: '',
    },
    mode: 'onChange',
  });

  // Watch form values for dependent logic
  const title = watch('title');
  const startsAt = watch('startsAt');
  const endsAt = watch('endsAt');
  const participants = watch('participants');
  const externalEmails = watch('externalEmails') ?? [];
  const invitationMessageHtml = watch('invitationMessageHtml') ?? '';

  // Every unique address from the thread; user removes chips they don't want.
  const suggestedExternalEmails = useMemo<string[]>(() => {
    if (!enableExternalInvitees || !ticketEmails || ticketEmails.length === 0) return [];

    const emails = ticketEmails as Array<{
      type?: string | null;
      from?: string | null;
      to?: string[] | null;
      cc?: string[] | null;
    }>;

    const extract = (s: string): string => {
      const trimmed = s.trim();
      const angle = /<([^>]+)>\s*$/.exec(trimmed);
      return (angle ? angle[1]! : trimmed).trim().toLowerCase();
    };
    const isValidEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

    const ownerAddresses = new Set<string>();
    const selfEmail = user?.email?.trim().toLowerCase();
    if (selfEmail && isValidEmail(selfEmail)) ownerAddresses.add(selfEmail);
    if (channelOwnEmail) ownerAddresses.add(channelOwnEmail);
    for (const e of emails) {
      if ((e.type === 'REPLY' || e.type === 'REPLY_ALL') && e.from) {
        const f = extract(e.from);
        if (isValidEmail(f)) ownerAddresses.add(f);
      }
    }

    const addresses = emails
      .flatMap(e => [e.from, ...(e.to ?? []), ...(e.cc ?? [])])
      .filter((raw): raw is string => !!raw)
      .map(extract)
      .filter(isValidEmail)
      .filter(addr => !ownerAddresses.has(addr));

    return Array.from(new Set(addresses));
  }, [enableExternalInvitees, ticketEmails, channelOwnEmail, user?.email]);

  // Show "Post call updates" checkbox only when:
  //   - at least one participant is added
  //   - no channel is selected in the participants field (channel already serves as the target)
  const hasParticipantChannel = participants.some(v => v.startsWith('channel:'));
  const showPostCallUpdates =
    (participants.length > 0 || postCallUpdates) && !hasParticipantChannel;

  const participantLabel = useMemo(() => {
    if (participants.some(v => v.startsWith('channel:'))) return 'Selected Channel';
    return 'Internal Users';
  }, [participants]);

  // Search query state (not in form)
  const [searchQuery, setSearchQuery] = React.useState('');
  const userGroups = useUserGroupSearch(searchQuery, 10);
  const [notFoundUsers, setNotFoundUsers] = React.useState<string[]>([]);

  // Recurring call state
  const [isRecurring, setIsRecurring] = React.useState(
    () => isEditMode && !!initialCall?.recurringSeriesId,
  );
  const [repeatValue, setRepeatValue] = useState<number | ''>(1);
  const [monthlyType, setMonthlyType] = useState<'monthly_day' | 'monthly_nth_weekday'>(
    'monthly_day',
  );
  const [recurrenceFrequency, setRecurrenceFrequency] = React.useState<'DAY' | 'WEEK' | 'MONTH'>(
    'WEEK',
  );
  const [recurrenceDays, setRecurrenceDays] = React.useState<string[]>([]);
  const [seriesEndsOn, setSeriesEndsOn] = React.useState<Date | null>(null);
  const [seriesEndsType, setSeriesEndsType] = React.useState<'never' | 'on' | 'after'>('never');
  const [occurrenceCount, setOccurrenceCount] = React.useState<number | ''>(13);
  // Dedicated time strings for recurring mode — avoids any Date-mutation bugs
  const [recurringStartTime, setRecurringStartTime] = React.useState<string>(() =>
    toHHMM(defaultStart),
  );
  const [recurringEndTime, setRecurringEndTime] = React.useState<string>(() =>
    toHHMM(new Date(defaultStart.getTime() + 60 * 60 * 1000)),
  );
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  // ── Helper: parse an RRULE string into UI state ─────────────────────────
  const applyRRule = useCallback(
    (rruleStr: string) => {
      try {
        // RRule.fromString needs RRULE: prefix stripped
        const clean = rruleStr.replace(/^RRULE:/i, '');
        const rule = RRule.fromString(clean);
        const opts = rule.options;

        // Frequency
        const freqMap: Record<number, 'DAY' | 'WEEK' | 'MONTH'> = {
          [RRule.DAILY]: 'DAY',
          [RRule.WEEKLY]: 'WEEK',
          [RRule.MONTHLY]: 'MONTH',
        };
        const freq = freqMap[opts.freq];
        if (freq) setRecurrenceFrequency(freq);

        // Interval
        setRepeatValue(opts.interval ?? 1);

        // BYDAY — for WEEKLY these are plain weekday codes; for MONTHLY nth-weekday uses bysetpos
        if (opts.freq === RRule.WEEKLY && opts.byweekday?.length) {
          const codeMap: Record<number, string> = {
            0: 'MO',
            1: 'TU',
            2: 'WE',
            3: 'TH',
            4: 'FR',
            5: 'SA',
            6: 'SU',
          };
          setRecurrenceDays(
            (opts.byweekday as Array<number | { weekday: number }>).map(w =>
              typeof w === 'number' ? (codeMap[w] ?? 'MO') : (codeMap[w.weekday] ?? 'MO'),
            ),
          );
        } else {
          setRecurrenceDays([]);
        }

        // Monthly type: bymonthday = specific day, bysetpos/byweekday = nth weekday
        // Check if any byweekday entry has an 'n' property indicating nth occurrence
        if (opts.freq === RRule.MONTHLY) {
          const weekdays = opts.byweekday as
            | Array<{ weekday?: number; n?: number } | number>
            | undefined;
          const hasNthWeekday = weekdays?.some(
            w => typeof w === 'object' && w !== null && w.n !== undefined,
          );
          const hasByMonthDay = opts.bymonthday?.length;
          if (hasNthWeekday) {
            setMonthlyType('monthly_nth_weekday');
          } else if (hasByMonthDay) {
            setMonthlyType('monthly_day');
          } else {
            // Default to monthly_day if neither pattern detected
            setMonthlyType('monthly_day');
          }
        }

        // End condition - only update if the RRULE actually specifies one
        if (opts.count) {
          setSeriesEndsType('after');
          setOccurrenceCount(opts.count);
        } else if (opts.until) {
          setSeriesEndsType('on');
          setSeriesEndsOn(new Date(opts.until));
        }
      } catch {
        // Silently ignore malformed rrule strings
      }
    },
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // ── On modal open: pre-fill form from initialCall ────────────────────────
  useEffect(() => {
    if (!isOpen) {
      setInitialized(false);
      return;
    }

    if (initialized) return;

    if (isEditMode && initialCall) {
      const callStart = new Date(initialCall.startsAt);
      const callEnd = new Date(initialCall.endsAt);

      // callUpdatesChannel tells us whether this is a post-to-channel call.
      // Null means the call is either channel-scoped (channelId is a real DEFAULT channel)
      // or a direct group call (channelId is an auto-created GROUP_DM).
      // Non-null means call updates are posted to that channel while participants are in a GROUP_DM.
      const callChannel = initialCall.channelId
        ? allVisibleChannels.find(c => c.id === initialCall.channelId)
        : null;
      const isExplicitChannel =
        callChannel &&
        callChannel.scopeType !== ChannelScopeType.DM &&
        callChannel.scopeType !== ChannelScopeType.GROUP_DM;
      const callUpdatesChannel = initialCall.callUpdatesChannel ?? null;

      const participantValues: string[] =
        isExplicitChannel && !callUpdatesChannel
          ? [`channel:${initialCall.channelId}`]
          : initialCall.participants
              .filter(p => p.userId !== user?.id)
              .map(p => `user:${p.userId}`);

      reset({
        title: initialCall.title,
        startsAt: callStart,
        endsAt: callEnd,
        participants: participantValues,
      });

      if (callUpdatesChannel) {
        setPostCallUpdates(true);
        setUpdateChannelId(callUpdatesChannel);
      } else {
        setPostCallUpdates(false);
        setUpdateChannelId(null);
      }

      setRecurringStartTime(toHHMM(callStart));
      setRecurringEndTime(toHHMM(callEnd));
      // Default to editing single instance (checkbox unchecked)
      setEditEntireSeries(false);
      // Set isRecurring based on whether this is a recurring series call
      setIsRecurring(!!initialCall.recurringSeriesId);
      validateTimes(callStart, callEnd);
      setInitialized(true);
    } else {
      const displayName = getUserDisplayName(user);
      const start = initialStartsAt ?? defaultStart;
      const end = initialEndsAt ?? new Date(start.getTime() + 60 * 60 * 1000);
      const prefilledParticipants = initialParticipants?.map(id => `user:${id}`) ?? [];
      if (displayName !== 'Unknown') {
        reset({
          title: initialTitle ?? `${displayName.split(' ')[0]}'s Call`,
          startsAt: start,
          endsAt: end,
          participants: prefilledParticipants,
        });
        setRecurringStartTime(toHHMM(start));
        setRecurringEndTime(toHHMM(end));
        validateTimes(start, end);
        setInitialized(true);
      }
    }
  }, [isOpen, user, initialized]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── When series data arrives: pre-fill recurrence UI ────────────────────
  useEffect(() => {
    if (!seriesData) return;

    setIsRecurring(true);

    // When editing the whole series, only update series-level metadata
    // (endsOn) — keep the user's current form values intact.
    if (editEntireSeries && seriesData.endsOn) {
      setSeriesEndsOn(new Date(seriesData.endsOn));
      setSeriesEndsType('on');
    }

    if (seriesData.recurrenceRule) {
      applyRRule(seriesData.recurrenceRule);
    }
  }, [seriesData, editEntireSeries]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Reset edit-series state when checkbox is unchecked ───────────────────
  useEffect(() => {
    if (editEntireSeries || !isEditMode || !initialCall) return;
    // Restore single-occurrence form values
    const callStart = new Date(initialCall.startsAt);
    const callEnd = new Date(initialCall.endsAt);
    setValue('startsAt', callStart);
    setValue('endsAt', callEnd);
    setRecurringStartTime(toHHMM(callStart));
    setRecurringEndTime(toHHMM(callEnd));
    // Don't reset series end state here - keep the original series settings
    // so the dropdown label shows the correct recurrence pattern
  }, [editEntireSeries]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset post-call-updates state when the checkbox becomes hidden
  // (user removes all participants, or adds a channel to participants)
  useEffect(() => {
    if (!showPostCallUpdates && postCallUpdates) {
      setPostCallUpdates(false);
      setUpdateChannelId(null);
      setChannelSearchQuery('');
    }
  }, [showPostCallUpdates]); // eslint-disable-line react-hooks/exhaustive-deps

  // Initialize default day when custom panel opens for WEEK frequency
  useEffect(() => {
    if (showCustomPanel && recurrenceFrequency === 'WEEK' && recurrenceDays.length === 0) {
      const dayIndex = startsAt.getDay();
      if (dayIndex >= 0 && dayIndex < DAY_KEYS.length) {
        const todayKey = DAY_KEYS[dayIndex];
        if (todayKey) {
          setRecurrenceDays([todayKey]);
        }
      }
    }
  }, [showCustomPanel, recurrenceFrequency, recurrenceDays.length, startsAt]);

  const buildUserOption = (u: (typeof allUsers)[number]) => ({
    ...u,
    label: getUserDisplayName(u),
    subtitle: u.name,
    value: `user:${u.id}`,
    icon: (
      <Avatar
        userId={u.id}
        size={'sm'}
        showActiveStatus={false}
        className='rounded-md size-[18px] flex items-center justify-center bg-background'
      />
    ),
    children: (
      <div className='flex items-center gap-2'>
        <Avatar
          userId={u.id}
          size={'sm'}
          showActiveStatus={false}
          className='rounded-md size-[18px] flex items-center justify-center bg-background'
        />
        <div className='flex-1 w-full flex items-center gap-1.5'>
          <span className={`text-sm ${isUserDeactivated(u) ? 'text-muted-foreground' : ''}`}>
            {getUserDisplayName(u).split(' ')[0]}
          </span>
          {!isUserDeactivated(u) && (
            <span className='w-[5px] h-[5px] bg-green-600 rounded-full'></span>
          )}
          <span
            className={`text-sm ${isUserDeactivated(u) ? 'text-muted-foreground' : 'text-gray-500'}`}
          >
            {getUserDisplayName(u)}
          </span>
          {isUserDeactivated(u) && (
            <span className='inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground shrink-0'>
              Deactivated
            </span>
          )}
        </div>
      </div>
    ),
    type: 'user' as const,
  });

  // Build participant options
  const inviteUserOrChannelOptions = useMemo(() => {
    // When opened from a thread, only show channel members (no channels)
    if (channelParticipantUserIds) {
      const channelUserOptions = allUsers
        .filter(u => u.id !== user?.id && channelParticipantUserIds.has(u.id))
        .map(buildUserOption);

      // In edit mode, inject pre-filled participants from the call in case they're missing
      if (isEditMode && initialCall?.participants) {
        initialCall.participants
          .filter(p => p.userId !== user?.id)
          .forEach(p => {
            const alreadyIncluded = channelUserOptions.some(u => u.value === `user:${p.userId}`);
            if (!alreadyIncluded) {
              const fullUser = allUsers.find(u => u.id === p.userId);
              if (fullUser) channelUserOptions.push(buildUserOption(fullUser));
            }
          });
      }

      return channelUserOptions.sort((a, b) => a.label.localeCompare(b.label));
    }

    const userOptions = allUsers.filter(u => u.id !== user?.id).map(buildUserOption);

    const channelOptions = channels.map(channel => ({
      ...channel,
      label: channel.name,
      value: `channel:${channel.id}`,
      icon:
        channel.visibility === ChannelVisibility.PRIVATE ? (
          <Lock className='size-3.5 text-gray-600 mx-0.5' strokeWidth={2.3} />
        ) : (
          <Hash className='size-3.5 text-gray-600 mx-0.5' strokeWidth={2.3} />
        ),
      type: 'channel' as const,
    }));

    const userGroupOptions = userGroups.map(group => ({
      ...group,
      label: group.name,
      value: `user_group:${group.id}`,
      icon: <Users className='size-3.5 text-muted-foreground mx-0.5' strokeWidth={2.3} />,
      subtitle: group.alias || group.description,
      type: 'user_group' as const,
    }));

    // In edit mode, the call's existing channel may be a DM (filtered out of `channels`).
    // Inject it into options so it remains searchable/selectable.
    if (isEditMode && initialCall?.channelId) {
      const alreadyIncluded = channelOptions.some(
        c => c.value === `channel:${initialCall.channelId}`,
      );
      if (!alreadyIncluded) {
        const existingChannel = allVisibleChannels.find(c => c.id === initialCall.channelId);
        if (existingChannel) {
          channelOptions.push({
            ...existingChannel,
            label: existingChannel.name,
            value: `channel:${existingChannel.id}`,
            icon:
              existingChannel.visibility === ChannelVisibility.PRIVATE ? (
                <Lock className='size-3.5 text-gray-600 mx-0.5' strokeWidth={2.3} />
              ) : (
                <Hash className='size-3.5 text-gray-600 mx-0.5' strokeWidth={2.3} />
              ),
            type: 'channel' as const,
          });
        }
      }
    }

    // Pre-filled participants may not appear in the current search results
    // (useUserSearch is limited). Inject them so their pills always render.
    if (isEditMode && initialCall?.participants) {
      initialCall.participants
        .filter(p => p.userId !== user?.id)
        .forEach(p => {
          const alreadyIncluded = userOptions.some(u => u.value === `user:${p.userId}`);
          if (!alreadyIncluded) {
            const fullUser = allUsers.find(u => u.id === p.userId);
            if (fullUser) userOptions.push(buildUserOption(fullUser));
          }
        });
    }

    // Inject initialParticipants (create mode pre-fill from "Meet With" panel)
    if (!isEditMode && initialParticipants) {
      initialParticipants.forEach(id => {
        const alreadyIncluded = userOptions.some(u => u.value === `user:${id}`);
        if (!alreadyIncluded) {
          const fullUser = allUsers.find(u => u.id === id);
          if (fullUser) userOptions.push(buildUserOption(fullUser));
        }
      });
    }

    return [...userOptions, ...channelOptions, ...userGroupOptions].sort((a, b) =>
      a.label.localeCompare(b.label),
    );
  }, [
    allUsers,
    channels,
    user?.id,
    isEditMode,
    initialCall,
    initialParticipants,
    allVisibleChannels,
    channelParticipantUserIds,
    userGroups,
    fullUserList,
  ]);

  const parseTimeAndUpdateDate = useCallback(
    (timeString?: string, currentDate?: Date | null): Date | null => {
      if (!currentDate || !timeString) return currentDate ?? null;

      const newDate = new Date(currentDate);
      const timeParts = timeString.match(/(\d+):(\d+)\s*(AM|PM)/i);

      if (!timeParts) return newDate;

      let hours = parseInt(timeParts[1] || '12', 10);
      const minutes = parseInt(timeParts[2] || '00', 10);
      const meridiem = (timeParts[3] || 'AM').toUpperCase();

      if (meridiem === 'PM' && hours !== 12) hours += 12;
      if (meridiem === 'AM' && hours === 12) hours = 0;

      newDate.setHours(hours, minutes, 0, 0);
      return newDate;
    },
    [],
  );

  const buildRrule = useCallback((): string => {
    // Map frontend frequencies to RRULE standard frequencies
    const freqMap: Record<'DAY' | 'WEEK' | 'MONTH', string> = {
      DAY: 'DAILY',
      WEEK: 'WEEKLY',
      MONTH: 'MONTHLY',
    };

    const rruleFreq = freqMap[recurrenceFrequency];
    let rule = `FREQ=${rruleFreq}`;

    // Add interval (repeat value) if greater than 1
    if (typeof repeatValue === 'number' && repeatValue > 1) {
      rule += `;INTERVAL=${repeatValue}`;
    }

    if (recurrenceFrequency === 'WEEK' && recurrenceDays.length > 0) {
      rule += `;BYDAY=${recurrenceDays.join(',')}`;
    }
    if (recurrenceFrequency === 'MONTH') {
      if (monthlyType === 'monthly_day') {
        rule += `;BYMONTHDAY=${startsAt.getDate()}`; // Monthly on specific day of month (e.g., 15th)
      } else if (monthlyType === 'monthly_nth_weekday') {
        const { occurrence, weekday } = getWeekdayOccurrence(startsAt); // Monthly on nth weekday (e.g., second Friday)

        // RRULE format: BYDAY=+2FR (second Friday)
        const weekdayCode = weekday.substring(0, 2).toUpperCase();
        rule += `;BYDAY=${occurrence}${weekdayCode}`;
      }
    }

    // Add COUNT for 'after' end type
    if (seriesEndsType === 'after') {
      rule += `;COUNT=${occurrenceCount}`;
    }

    return rule;
  }, [
    recurrenceFrequency,
    recurrenceDays,
    monthlyType,
    startsAt,
    repeatValue,
    seriesEndsType,
    occurrenceCount,
  ]);

  const toggleRecurrenceDay = useCallback((day: string): void => {
    setRecurrenceDays(prev => (prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]));
  }, []);

  // Generate a human-readable label for the recurrence dropdown button
  const getRecurrenceLabel = useCallback((): string => {
    if (!isRecurring) return 'Does not repeat';

    let baseLabel = '';

    // Daily
    if (recurrenceFrequency === 'DAY') {
      baseLabel = repeatValue === 1 ? 'Daily' : `Every ${repeatValue} days`;
    }
    // Weekly
    else if (recurrenceFrequency === 'WEEK') {
      // Check for weekday pattern (Mon-Fri)
      const weekdaySet = new Set(['MO', 'TU', 'WE', 'TH', 'FR']);
      const hasWeekdays =
        recurrenceDays.length === 5 && recurrenceDays.every(d => weekdaySet.has(d));
      if (hasWeekdays && repeatValue === 1) {
        baseLabel = 'Every Weekday (Mon – Fri)';
      }
      // Check for single day
      else if (recurrenceDays.length === 1 && repeatValue === 1) {
        const dayKey = recurrenceDays[0];
        if (!dayKey) {
          baseLabel = 'Weekly on selected day';
        } else {
          const fullDayName: Record<string, string> = {
            SU: 'Sunday',
            MO: 'Monday',
            TU: 'Tuesday',
            WE: 'Wednesday',
            TH: 'Thursday',
            FR: 'Friday',
            SA: 'Saturday',
          };
          baseLabel = `Weekly on ${fullDayName[dayKey] ?? 'selected day'}`;
        }
      }
      // Check for multiple specific days
      else if (recurrenceDays.length > 0 && repeatValue === 1) {
        const dayNameMap: Record<string, string> = {
          SU: 'Sun',
          MO: 'Mon',
          TU: 'Tue',
          WE: 'Wed',
          TH: 'Thu',
          FR: 'Fri',
          SA: 'Sat',
        };
        const dayNames = recurrenceDays.map(d => dayNameMap[d] || d);
        if (dayNames.length <= 3) {
          baseLabel = `Weekly on ${dayNames.join(', ')}`;
        } else {
          baseLabel = `Weekly on ${dayNames.length} days`;
        }
      }
      // Generic weekly
      else if (repeatValue === 1) {
        baseLabel = 'Weekly';
      } else {
        baseLabel = `Every ${repeatValue} weeks`;
      }
    }
    // Monthly
    else if (recurrenceFrequency === 'MONTH') {
      if (monthlyType === 'monthly_day') {
        const dayOfMonth = startsAt.getDate();
        if (repeatValue === 1) {
          baseLabel = `Monthly on day ${dayOfMonth}`;
        } else {
          baseLabel = `Every ${repeatValue} months on day ${dayOfMonth}`;
        }
      } else {
        const { occurrence, weekday } = getWeekdayOccurrence(startsAt);
        const ordinalWord = ORDINAL_WORDS[occurrence - 1] || `${occurrence}th`;
        if (repeatValue === 1) {
          baseLabel = `Monthly on ${ordinalWord} ${weekday}`;
        } else {
          baseLabel = `Every ${repeatValue} months on ${ordinalWord} ${weekday}`;
        }
      }
    } else {
      baseLabel = 'Custom';
    }

    // Append end condition for "on" or "after" types
    if (seriesEndsType === 'on' && seriesEndsOn) {
      const day = seriesEndsOn.getDate();
      const month = seriesEndsOn.toLocaleString('en-US', { month: 'long' });
      return `${baseLabel}, ends on ${day} ${month}`;
    } else if (seriesEndsType === 'after' && occurrenceCount) {
      return `${baseLabel}, ends after ${occurrenceCount} ${occurrenceCount === 1 ? 'occurrence' : 'occurrences'}`;
    }

    return baseLabel;
  }, [
    isRecurring,
    recurrenceFrequency,
    repeatValue,
    recurrenceDays,
    monthlyType,
    startsAt,
    seriesEndsType,
    seriesEndsOn,
    occurrenceCount,
  ]);

  // Validate start and end times
  const validateTimes = useCallback(
    (newStartsAt?: Date, newEndsAt?: Date) => {
      const currentStartsAt = newStartsAt ?? watch('startsAt');
      const currentEndsAt = newEndsAt ?? watch('endsAt');
      const { startsAtError, endsAtError } = validateCallDateTimes(currentStartsAt, currentEndsAt);

      if (startsAtError) {
        setError('startsAt', { type: 'manual', message: startsAtError });
      } else {
        clearErrors('startsAt');
      }

      if (endsAtError) {
        setError('endsAt', { type: 'manual', message: endsAtError });
      } else {
        clearErrors('endsAt');
      }
    },
    [watch, setError, clearErrors],
  );

  const handleStartTimeChange = useCallback(
    (timeString: string): void => {
      const newStartsAt = parseTimeAndUpdateDate(timeString, startsAt);
      if (newStartsAt) {
        setValue('startsAt', newStartsAt, { shouldValidate: true });
        setRecurringStartTime(toHHMM(newStartsAt));

        // Auto-adjust end time to be 1 hour after start time if end time is before start time
        let effectiveEndsAt = endsAt;
        if (endsAt && newStartsAt >= endsAt) {
          const newEndsAt = new Date(newStartsAt.getTime() + 60 * 60 * 1000);
          setValue('endsAt', newEndsAt, { shouldValidate: true });
          effectiveEndsAt = newEndsAt;
          setRecurringEndTime(toHHMM(newEndsAt));
        }

        validateTimes(newStartsAt, effectiveEndsAt);
      }
    },
    [startsAt, endsAt, setValue, parseTimeAndUpdateDate, validateTimes],
  );

  const handleEndTimeChange = useCallback(
    (time: string): void => {
      const newEndsAt = parseTimeAndUpdateDate(time, endsAt);
      if (newEndsAt) {
        setValue('endsAt', newEndsAt, { shouldValidate: true });
        setRecurringEndTime(toHHMM(newEndsAt));
        validateTimes(startsAt, newEndsAt);
      }
    },
    [startsAt, endsAt, setValue, parseTimeAndUpdateDate, validateTimes],
  );

  /** Recurring-mode-only handlers: update the string state directly, no Date mutation needed. */
  const handleRecurringStartTimeChange = useCallback(
    (timeString: string): void => {
      // Parse the 12h AM/PM string from the TimePicker into HH:mm
      const parsed = parseTimeAndUpdateDate(timeString, startsAt);
      if (parsed) {
        setRecurringStartTime(toHHMM(parsed));
        setValue('startsAt', parsed, { shouldValidate: true });
      }
    },
    [startsAt, parseTimeAndUpdateDate, setValue],
  );

  const handleRecurringEndTimeChange = useCallback(
    (timeString: string): void => {
      const parsed = parseTimeAndUpdateDate(timeString, endsAt ?? startsAt);
      if (parsed) {
        setRecurringEndTime(toHHMM(parsed));
        setValue('endsAt', parsed, { shouldValidate: true });
      }
    },
    [endsAt, startsAt, parseTimeAndUpdateDate, setValue],
  );

  const onSubmit = async (data: ScheduleCallFormData): Promise<void> => {
    if (!user?.id) {
      toast.error('User not found', { description: 'User not authenticated' });
      return;
    }

    try {
      // ── Time validation ───────────────────────────────────────────────────
      // react-hook-form clears manual setError calls when handleSubmit re-validates,
      // so we re-check the constraint here to prevent saving invalid data.
      if (isRecurring) {
        const recurringTimeError = validateRecurringCallTimes(recurringStartTime, recurringEndTime);
        if (recurringTimeError) {
          setError('endsAt', { type: 'manual', message: recurringTimeError });
          return;
        }
      } else {
        const { startsAtError, endsAtError } = validateCallDateTimes(data.startsAt, data.endsAt);
        if (startsAtError) {
          setError('startsAt', { type: 'manual', message: startsAtError });
          return;
        }
        if (endsAtError) {
          setError('endsAt', { type: 'manual', message: endsAtError });
          return;
        }
      }

      if (postCallUpdates && !updateChannelId) {
        toast.error('Select a channel', {
          description: 'Please select a channel to post call updates.',
          duration: 3000,
        });
        return;
      }

      // ── Step advance: externals present and still on Step 1 ──────────────
      // Invitation preview + Send happens on Step 2.
      if (
        enableExternalInvitees &&
        !isEditMode &&
        !isRecurring &&
        (data.externalEmails ?? []).length > 0 &&
        step === 'participants'
      ) {
        goToStep('invitation');
        return;
      }

      // Step 2 has no participants field, so RHF's silent error never shows.
      if (data.participants.length === 0) {
        toast.error('Add at least one participant', {
          description: 'A scheduled call needs at least one teammate from this channel.',
          duration: 3000,
        });
        return;
      }

      const userIds: string[] = [];
      let channelId: string | undefined;
      data.participants.forEach(value => {
        if (value.startsWith('user:')) userIds.push(value.replace('user:', ''));
        else if (value.startsWith('channel:')) channelId = value.replace('channel:', '');
      });

      // ── EDIT MODE ──────────────────────────────────────────────────────────
      if (isEditMode && initialCall) {
        if (editEntireSeries && initialCall.recurringSeriesId) {
          // Validate weekly requires at least one day
          if (recurrenceFrequency === 'WEEK' && recurrenceDays.length === 0) {
            toast.error('Select at least one day', {
              description: 'Weekly recurrence requires at least one day.',
              duration: 3000,
            });
            return;
          }
          const resolvedChannelId =
            postCallUpdates && updateChannelId ? updateChannelId : channelId;
          await callService.updateRecurringSeries(initialCall.recurringSeriesId, {
            title: data.title,
            ...(resolvedChannelId && { channelId: resolvedChannelId }),
            ...(userIds.length > 0 && { targetUserIds: userIds }),
            recurrenceRule: buildRrule(),
            timezone,
            startTime: recurringStartTime,
            endTime: recurringEndTime,
            startsOn: data.startsAt.getTime(),
            ...(seriesEndsType === 'on' &&
              seriesEndsOn !== null && { endsOn: seriesEndsOn.getTime() }),
          });
          toast.success('Recurring Series Updated', {
            description: `Changes applied to all occurrences of ${data.title}`,
            duration: 3000,
          });
        } else {
          // Edit single occurrence
          const resolvedChannelId =
            postCallUpdates && updateChannelId ? updateChannelId : channelId;
          await callService.updateScheduledCall(initialCall.externalId, {
            title: data.title,
            startsAt: new Date(data.startsAt).getTime(),
            endsAt: new Date(data.endsAt).getTime(),
            ...(userIds.length > 0 && { targetUserIds: userIds }),
            ...(resolvedChannelId && { channelId: resolvedChannelId }),
          });
          toast.success('Call Updated', {
            description: 'This occurrence has been updated.',
            duration: 3000,
          });
        }
        onSuccess?.();
        handleClose();
        return;
      }

      // ── CREATE MODE ────────────────────────────────────────────────────────
      if (isRecurring) {
        if (recurrenceFrequency === 'WEEK' && recurrenceDays.length === 0) {
          toast.error('Select at least one day', {
            description: 'Weekly recurrence requires at least one day of the week.',
            duration: 3000,
          });
          return;
        }
        const recurringRequest: Parameters<typeof callService.createRecurringSeries>[0] = {
          title: data.title,
          ...(postCallUpdates && updateChannelId
            ? {
                channelId: updateChannelId,
                ...(userIds.length > 0 && { targetUserIds: userIds }),
              }
            : {
                ...(channelId !== undefined && { channelId }),
                ...(userIds.length > 0 && { targetUserIds: userIds }),
              }),
          timezone,
          recurrenceRule: buildRrule(),
          startTime: recurringStartTime,
          endTime: recurringEndTime,
          startsOn: data.startsAt.getTime(),
        };
        if (seriesEndsType === 'on' && seriesEndsOn !== null) {
          recurringRequest.endsOn = seriesEndsOn.getTime();
        }
        await callService.createRecurringSeries(recurringRequest);
        toast.success('Recurring Series Created', {
          description: `${data.title} will repeat ${recurrenceFrequency.toLowerCase()}`,
          duration: 3000,
        });
      } else {
        const requestData: ScheduleCallRequest = {
          title: data.title,
          startsAt: data.startsAt.getTime(),
          endsAt: data.endsAt.getTime(),
        };
        if (threadConversationId) {
          // Thread-linked: always use the thread's channel and pass conversationId
          if (threadChannelId) requestData.channelId = threadChannelId;
          requestData.conversationId = threadConversationId;
          if (userIds.length > 0) requestData.targetUserIds = userIds;
        } else if (postCallUpdates && updateChannelId) {
          requestData.channelId = updateChannelId;
          if (userIds.length > 0) requestData.targetUserIds = userIds;
        } else {
          if (channelId) requestData.channelId = channelId;
          if (userIds.length > 0) requestData.targetUserIds = userIds;
        }
        const effExternals = data.externalEmails ?? [];
        if (enableExternalInvitees && effExternals.length > 0) {
          // Server re-sanitizes; doing it here too keeps a tampered payload
          // from ever shipping unsafe HTML over the wire.
          const safeBody = DOMPurify.sanitize((data.invitationMessageHtml || '').trim());
          requestData.externalInvitees = effExternals;
          requestData.invitation = {
            bodyHtml: safeBody || '<p></p>',
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            ...(data.invitationTitle?.trim() && { title: data.invitationTitle.trim() }),
            ...(data.invitationOrganizerName?.trim() && {
              organizerName: data.invitationOrganizerName.trim(),
            }),
            ...(data.invitationOrganizerEmail?.trim() && {
              organizerEmail: data.invitationOrganizerEmail.trim(),
            }),
            ...(data.invitationOrgName?.trim() && { orgName: data.invitationOrgName.trim() }),
          };
        }
        await callService.scheduleCall(requestData);
        toast.success('Call Scheduled', {
          description:
            effExternals.length > 0
              ? `Call scheduled. Invitation sent to ${effExternals.length} external recipient(s).`
              : 'Call scheduled successfully',
          duration: 3000,
        });
      }

      onSuccess?.();
      handleClose();
    } catch (err) {
      console.error('[ScheduleCallModal] submit failed:', err);
      toast.error('Error scheduling call', {
        description: 'Failed to schedule call',
        duration: 5000,
      });
    }
  };

  const handleBulkUserEntry = useCallback(
    (query: string): boolean => {
      if (participants.some(v => v.startsWith('channel:'))) {
        return false;
      }

      if (!looksLikeBulkEntry(query)) {
        return false;
      }

      const parsed = parseParticipants(query);
      if (parsed.length === 0) {
        return false;
      }

      const { matched, notFound } = matchParticipants(parsed, allUsers, user?.id);

      if (matched.length === 0) {
        return false;
      }

      const nextSelected = new Set(participants);
      for (const { userId } of matched) {
        nextSelected.add(`user:${userId}`);
      }

      setValue('participants', Array.from(nextSelected));
      setNotFoundUsers(notFound.map(p => p.raw));
      setSearchQuery('');
      return true;
    },
    [participants, allUsers, user?.id, setValue],
  );

  const expandGroupSelections = useCallback(
    async (values: string[]): Promise<string[]> => {
      const expanded = new Set<string>();
      for (const value of values) {
        if (value.startsWith('user_group:')) {
          const groupId = value.replace('user_group:', '');
          const mappings = await zero.run(queries.getUserGroupMembers({ userGroupId: groupId }), {
            type: 'complete',
          });
          const memberIds = mappings
            .map((m: { userId: string }) => m.userId)
            .filter((id: string) => id !== user?.id);
          for (const id of memberIds) {
            expanded.add(`user:${id}`);
          }
        } else {
          expanded.add(value);
        }
      }
      return Array.from(expanded);
    },
    [user?.id, zero],
  );

  // Reset form and close modal
  const handleClose = useCallback((): void => {
    const displayName = getUserDisplayName(user);
    reset({
      title: displayName !== 'Unknown' ? `${displayName.split(' ')[0]}'s Call` : '',
      startsAt: defaultStart,
      endsAt: new Date(defaultStart.getTime() + 60 * 60 * 1000),
      participants: [],
      externalEmails: [],
      invitationMessageHtml: "<p>You've been invited to a call. Details below.</p>",
      invitationTitle: '',
      invitationOrganizerName: '',
      invitationOrganizerEmail: '',
      invitationOrgName: '',
    });
    setStep('participants');
    setSearchQuery('');
    setNotFoundUsers([]);
    setIsRecurring(false);
    setRecurrenceFrequency('WEEK');
    setRecurrenceDays([]);
    setSeriesEndsOn(null);
    setSeriesEndsType('never');
    setRecurringStartTime(toHHMM(defaultStart));
    setRecurringEndTime(toHHMM(new Date(defaultStart.getTime() + 60 * 60 * 1000)));
    setMonthlyType('monthly_day');
    setRepeatValue(1);
    setOccurrenceCount(13);
    setShowCustomPanel(false);
    setEditEntireSeries(false);
    setPostCallUpdates(false);
    setUpdateChannelId(null);
    setChannelSearchQuery('');
    setChannelPickerOpen(false);
    onClose();
  }, [reset, onClose, user]); // eslint-disable-line react-hooks/exhaustive-deps

  const isDesigningInvitation = enableExternalInvitees && step === 'invitation';
  const dialogSizing = isDesigningInvitation
    ? 'w-[min(1280px,96vw)] !max-w-[96vw] h-[min(820px,92vh)]'
    : 'max-w-[584px]';
  const dialogPositioning = isDesigningInvitation
    ? 'top-1/2 !-translate-y-1/2'
    : 'top-1/3 !-translate-y-1/3';

  // Resolved invitation fields — user overrides fall back to call/user defaults.
  const resolvedInvitationTitle =
    (watch('invitationTitle') ?? '').trim() || title || 'Untitled call';
  const resolvedOrganizerName =
    (watch('invitationOrganizerName') ?? '').trim() || getUserDisplayName(user);
  const resolvedOrganizerEmail =
    (watch('invitationOrganizerEmail') ?? '').trim() || (user?.email ?? '');
  const resolvedOrgName = (watch('invitationOrgName') ?? '').trim();

  // Single source of truth for the submit button: drives `disabled`, the
  // hover-tooltip contents, and the label.
  const missingRequirements: string[] = [];
  if (!title.trim()) missingRequirements.push('Add a title');
  if (participants.length === 0) missingRequirements.push('Add at least one participant');
  if (errors.startsAt) missingRequirements.push('Pick a valid start time');
  if (errors.endsAt) missingRequirements.push('Pick a valid end time');
  if (isRecurring && recurrenceFrequency === 'WEEK' && recurrenceDays.length === 0) {
    missingRequirements.push('Pick at least one weekday');
  }
  if (postCallUpdates && !updateChannelId) {
    missingRequirements.push('Pick a channel for post-call updates');
  }
  const submitDisabled = isSubmitting || missingRequirements.length > 0;
  const submitLabel = isSubmitting
    ? isEditMode
      ? 'Saving...'
      : isRecurring
        ? 'Creating...'
        : 'Scheduling...'
    : enableExternalInvitees && !isEditMode && !isRecurring && externalEmails.length > 0
      ? 'Next: Customize invitation'
      : isEditMode
        ? 'Save Changes'
        : isRecurring
          ? 'Create Series'
          : 'Schedule Call';

  return (
    <Dialog
      open={isOpen}
      onOpenChange={open => !open && handleClose()}
      className={cn(
        dialogSizing,
        'rounded-xl flex flex-col transition-[max-width,width,height] duration-300 ease-out',
        dialogPositioning,
      )}
    >
      <AnimatePresence mode='popLayout' initial={false} custom={slideDir}>
        {isDesigningInvitation ? (
          <motion.div
            key='step-invitation'
            custom={slideDir}
            initial={{ x: slideDir * 32, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -slideDir * 32, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className='flex flex-col w-full min-h-0 overflow-hidden'
            // Dialog wraps children in a plain <div> which breaks `h-full`
            // cascading, so anchor the step height to the viewport directly.
            style={{ height: 'min(820px, 92vh)' }}
          >
            <div className='px-5 py-3.5 border-b border-border flex items-start justify-between gap-4 shrink-0'>
              <div>
                <h2 className='text-[15px] font-semibold text-foreground leading-5'>
                  Design the invitation
                </h2>
                <p className='text-sidebar-secondary-foreground text-[13px] font-medium leading-5'>
                  Curate the message and edit header details — the invitation goes out as a reply on
                  this ticket&apos;s email thread.
                </p>
              </div>
            </div>
            <InvitationPreviewStep
              recipients={externalEmails}
              messageHtml={invitationMessageHtml}
              onMessageChange={html => setValue('invitationMessageHtml', html)}
              editableTitle={watch('invitationTitle') ?? ''}
              onEditableTitleChange={(v: string) => setValue('invitationTitle', v)}
              editableOrganizerName={watch('invitationOrganizerName') ?? ''}
              onEditableOrganizerNameChange={(v: string) => setValue('invitationOrganizerName', v)}
              editableOrganizerEmail={watch('invitationOrganizerEmail') ?? ''}
              onEditableOrganizerEmailChange={(v: string) =>
                setValue('invitationOrganizerEmail', v)
              }
              editableOrgName={watch('invitationOrgName') ?? ''}
              onEditableOrgNameChange={(v: string) => setValue('invitationOrgName', v)}
              data={{
                title: resolvedInvitationTitle,
                startsAt,
                endsAt,
                // Display in the user's local timezone so Step 1 and Step 2 show
                // the same clock time (they pick times in local tz on Step 1).
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                organizerName: resolvedOrganizerName,
                organizerEmail: resolvedOrganizerEmail,
                orgName: resolvedOrgName,
                joinUrlPlaceholder: `${typeof window !== 'undefined' ? window.location.origin : 'https://example.com'}/call/preview`,
              }}
              onBack={() => goToStep('participants')}
              onSend={() => {
                void handleSubmit(onSubmit)();
              }}
              isSubmitting={isSubmitting}
            />
          </motion.div>
        ) : (
          <motion.form
            key='step-participants'
            custom={slideDir}
            initial={{ x: slideDir * 32, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -slideDir * 32, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className='flex flex-col w-full'
            onSubmit={e => void handleSubmit(onSubmit)(e)}
          >
            {/* Header */}
            <div className='flex items-start justify-between px-5 py-3.5 border-b border-border '>
              <span>
                <h2 className='text-[15px] font-semibold text-foreground leading-5'>
                  {isEditMode ? 'Edit Call Details' : 'Schedule a Call'}
                </h2>
                <p className='text-sidebar-secondary-foreground text-[13px] font-medium leading-5'>
                  {isEditMode
                    ? 'Edit time or participants for this call'
                    : 'Schedule call with people, groups or channel'}
                </p>
              </span>
              <Button
                variant='outline'
                size='icon'
                tabIndex={-1}
                type='button'
                className='size-7 rounded-lg'
                onClick={handleClose}
              >
                <X className='size-4' />
              </Button>
            </div>
            <div className='flex flex-col gap-8 pt-4 px-5'>
              {/* Tiltte Input */}
              <div>
                <Controller
                  name='title'
                  control={control}
                  render={({ field }) => (
                    <Input
                      {...field}
                      id='call-title'
                      type='text'
                      placeholder='Enter call title'
                      tabIndex={0}
                      className={cn(
                        '!text-[22px] truncate',
                        'px-0 border-none focus-visible:ring-0 rounded-none',
                        'font-semibold text-foreground placeholder:text-xl placeholder:text-muted-foreground',
                        errors.title && 'border-red-500',
                      )}
                    />
                  )}
                  rules={{
                    required: 'Title is required',
                    maxLength: {
                      value: 80,
                      message: 'Title must be less than 80 characters',
                    },
                    validate: value => value.trim().length > 0 || 'Title cannot be empty',
                  }}
                />
                {errors.title && (
                  <p className='text-red-500 text-xs mt-1'>{errors.title.message}</p>
                )}
              </div>
              <div className='flex flex-col gap-3'>
                {isRecurring ? (
                  /* ── Recurring mode: date on its own row, times side-by-side below ── */
                  <>
                    {/* Series start date */}
                    <div className='space-y-3'>
                      <label
                        htmlFor='series-starts-on'
                        className='text-[13px] text-sidebar-secondary-foreground font-medium leading-5'
                      >
                        Series starts on
                      </label>
                      <Controller
                        name='startsAt'
                        control={control}
                        render={({ field }) => (
                          <DatePicker
                            id='series-starts-on'
                            selectedDate={startsAt}
                            onSelect={date => {
                              if (date) {
                                const previousStart = field.value ?? startsAt;
                                const merged = mergeDateWithTime(date, previousStart);
                                const shiftedEnd = endsAt
                                  ? new Date(
                                      merged.getTime() +
                                        Math.max(
                                          endsAt.getTime() - previousStart.getTime(),
                                          60 * 60 * 1000,
                                        ),
                                    )
                                  : endsAt;
                                field.onChange(merged);
                                setRecurringStartTime(toHHMM(merged));
                                if (shiftedEnd) {
                                  setValue('endsAt', shiftedEnd, { shouldValidate: true });
                                  setRecurringEndTime(toHHMM(shiftedEnd));
                                }
                                validateTimes(merged, shiftedEnd);
                              }
                            }}
                            placeholder='Select start date'
                            minDate={new Date(new Date().setHours(0, 0, 0, 0))}
                            inputClassName={cn(
                              'text-sm leading-5 bg-transparent !px-3 rounded-lg !h-9 gap-2.5 w-full',
                              errors.startsAt && 'border-red-500',
                            )}
                            showClearButton={false}
                          />
                        )}
                      />
                      {errors.startsAt && (
                        <p className='text-red-500 text-xs'>{errors.startsAt.message}</p>
                      )}
                    </div>
                    {/* Call time: start → end on one row */}
                    <div className='space-y-3'>
                      <label
                        htmlFor='call-time-start'
                        className='text-[13px] text-sidebar-secondary-foreground font-medium leading-5'
                      >
                        Call time
                      </label>
                      <div className='flex items-center gap-2'>
                        <Controller
                          name='startsAt'
                          control={control}
                          render={({ field }) => (
                            <TimePicker
                              id='call-time-start'
                              value={
                                field.value
                                  ? field.value.toLocaleTimeString('en-US', {
                                      hour: '2-digit',
                                      minute: '2-digit',
                                    })
                                  : ''
                              }
                              onChange={handleRecurringStartTimeChange}
                              onClose={validateTimes}
                              placeholder='Start time'
                              disabled={false}
                            />
                          )}
                        />
                        <span className='text-gray-400 text-sm shrink-0'>→</span>
                        <Controller
                          name='endsAt'
                          control={control}
                          render={({ field }) => (
                            <TimePicker
                              value={
                                field.value
                                  ? field.value.toLocaleTimeString('en-US', {
                                      hour: '2-digit',
                                      minute: '2-digit',
                                    })
                                  : ''
                              }
                              onChange={handleRecurringEndTimeChange}
                              onClose={validateTimes}
                              placeholder='End time'
                              disabled={false}
                            />
                          )}
                        />
                      </div>
                      {errors.endsAt && (
                        <p className='text-red-500 text-xs'>{errors.endsAt.message}</p>
                      )}
                    </div>
                  </>
                ) : (
                  /* ── One-time mode: original two-row layout ── */
                  <>
                    <div className='space-y-3'>
                      <label
                        htmlFor='start-time'
                        className='text-[13px] text-sidebar-secondary-foreground font-medium leading-5'
                      >
                        Start Date and time
                      </label>
                      <div className='flex items-center justify-between gap-3'>
                        <Controller
                          name='startsAt'
                          control={control}
                          render={({ field }) => (
                            <DatePicker
                              selectedDate={startsAt}
                              onSelect={date => {
                                if (date) {
                                  const merged = mergeDateWithTime(date, field.value ?? startsAt);
                                  field.onChange(merged);
                                  setRecurringStartTime(toHHMM(merged));
                                  validateTimes(merged, endsAt);
                                }
                              }}
                              placeholder='Select start date'
                              minDate={new Date(new Date().setHours(0, 0, 0, 0))}
                              inputClassName={cn(
                                'text-sm leading-5 bg-transparent !px-3 rounded-lg !h-9 gap-2.5 w-full',
                                errors.startsAt && 'border-red-500',
                              )}
                              showClearButton={false}
                            />
                          )}
                        />
                        <Controller
                          name='startsAt'
                          control={control}
                          render={({ field }) => (
                            <TimePicker
                              value={
                                field.value
                                  ? field.value.toLocaleTimeString('en-US', {
                                      hour: '2-digit',
                                      minute: '2-digit',
                                    })
                                  : ''
                              }
                              onChange={handleStartTimeChange}
                              onClose={validateTimes}
                              placeholder='Select start time'
                              disabled={false}
                            />
                          )}
                        />
                      </div>
                      {errors.startsAt && (
                        <p className='text-red-500 text-xs'>{errors.startsAt.message}</p>
                      )}
                    </div>

                    <div className='space-y-3'>
                      <label
                        htmlFor='end-time'
                        className='text-[13px] text-sidebar-secondary-foreground font-medium leading-5'
                      >
                        End Date and time
                      </label>
                      <div className='flex items-center justify-between gap-3'>
                        <Controller
                          name='endsAt'
                          control={control}
                          render={({ field }) => (
                            <DatePicker
                              selectedDate={field.value}
                              onSelect={date => {
                                if (date) {
                                  const merged = mergeDateWithTime(date, field.value);
                                  field.onChange(merged);
                                  setRecurringEndTime(toHHMM(merged));
                                  validateTimes(startsAt, merged);
                                }
                              }}
                              placeholder='Select end date'
                              minDate={
                                startsAt
                                  ? new Date(new Date(startsAt).setHours(0, 0, 0, 0))
                                  : new Date(new Date().setHours(0, 0, 0, 0))
                              }
                              inputClassName={cn(
                                'text-sm leading-5 bg-transparent !px-3 rounded-lg !h-9 gap-2.5 w-full',
                                errors.endsAt && 'border-red-500',
                              )}
                              showClearButton={false}
                            />
                          )}
                        />
                        <Controller
                          name='endsAt'
                          control={control}
                          render={({ field }) => (
                            <TimePicker
                              value={
                                field.value
                                  ? field.value.toLocaleTimeString('en-US', {
                                      hour: '2-digit',
                                      minute: '2-digit',
                                    })
                                  : ''
                              }
                              onChange={handleEndTimeChange}
                              onClose={validateTimes}
                              placeholder='Select end time'
                              disabled={false}
                            />
                          )}
                        />
                      </div>
                      {errors.endsAt && (
                        <p className='text-red-500 text-xs'>{errors.endsAt.message}</p>
                      )}
                    </div>
                  </>
                )}
                {/* Repeat Toggle + Recurrence Options */}
                {!(isEditMode && !initialCall?.recurringSeriesId) && !threadConversationId && (
                  <div className='flex flex-col gap-3'>
                    <div className='flex items-center'>
                      <DropdownMenu
                        onOpenChange={open => {
                          if (!open) setShowCustomPanel(false); // reset when dropdown closes
                        }}
                      >
                        <DropdownMenuTrigger asChild>
                          <Button className='py-2 px-3 flex gap-2.5 rounded-lg bg-transparent hover:bg-secondary/80 border border-border text-foreground'>
                            <span className='text-sm font-normal leading-6'>
                              {getRecurrenceLabel()}
                            </span>
                            <ChevronDown className='size-4' strokeWidth={2.3} />
                          </Button>
                        </DropdownMenuTrigger>

                        <DropdownMenuContent
                          align='start'
                          sideOffset={6}
                          className='rounded-xl overflow-hidden p-0 [&[data-state=open]]:animate-none [&[data-state=closed]]:animate-none'
                          asChild
                        >
                          <motion.div
                            layout='size'
                            initial={{ opacity: 0, scale: 0.95, y: -8 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95, y: -8 }}
                            transition={{ duration: 0.15, ease: [0.4, 0, 0.2, 1] }}
                            className='overflow-hidden'
                            style={{ originX: 0, originY: 0 }}
                          >
                            <AnimatePresence initial={false} mode='popLayout'>
                              {!showCustomPanel ? (
                                /* ── Default list view ── */
                                <motion.div
                                  key='list'
                                  layout='size'
                                  initial={false}
                                  animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
                                  exit={{ opacity: 0, x: 0, filter: 'blur(8px)' }}
                                  transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
                                  className='p-2 flex flex-col min-w-[220px]'
                                >
                                  <DropdownMenuItem
                                    className='text-sm rounded-lg p-2'
                                    onClick={() => setIsRecurring(false)}
                                  >
                                    Does Not Repeat
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    className='text-sm rounded-lg p-2'
                                    onClick={() => {
                                      setIsRecurring(true);
                                      setRecurrenceFrequency('DAY');
                                      setRecurrenceDays([]);
                                    }}
                                  >
                                    Daily
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    className='text-sm rounded-lg p-2'
                                    onClick={() => {
                                      setIsRecurring(true);
                                      setRecurrenceFrequency('WEEK');
                                      setRecurrenceDays(['MO', 'TU', 'WE', 'TH', 'FR']);
                                    }}
                                  >
                                    Every Weekday (Mon – Fri)
                                  </DropdownMenuItem>
                                  {(() => {
                                    const { weekday, ordinalWord } = getWeekdayOccurrence(startsAt);
                                    return (
                                      <DropdownMenuItem
                                        className='text-sm rounded-lg p-2'
                                        onClick={() => {
                                          setIsRecurring(true);
                                          setRecurrenceFrequency('MONTH');
                                          setMonthlyType('monthly_nth_weekday');
                                          setRecurrenceDays([]);
                                        }}
                                      >
                                        Monthly on {ordinalWord} {weekday}
                                      </DropdownMenuItem>
                                    );
                                  })()}
                                  <DropdownMenuItem
                                    className='text-sm rounded-lg p-2'
                                    onClick={e => {
                                      e.preventDefault(); // keep dropdown open
                                      // Save current state before entering custom panel
                                      setPreviousRecurrenceState({
                                        isRecurring,
                                        recurrenceFrequency,
                                        recurrenceDays,
                                        repeatValue,
                                        monthlyType,
                                        seriesEndsType,
                                        seriesEndsOn,
                                        occurrenceCount,
                                      });
                                      setIsRecurring(true);
                                      setShowCustomPanel(true);
                                    }}
                                  >
                                    Custom…
                                  </DropdownMenuItem>
                                </motion.div>
                              ) : (
                                /* ── Custom panel view ── */
                                <motion.div
                                  key='custom'
                                  layout
                                  initial={{ opacity: 0, x: 0, filter: 'blur(8px)' }}
                                  animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
                                  exit={{ opacity: 0, x: 0, filter: 'blur(8px)' }}
                                  transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
                                  className='p-4 flex flex-col gap-3 min-w-[320px]'
                                >
                                  <p className='text-secondary-foreground/60 text-[13px] font-medium'>
                                    Repeat every
                                  </p>
                                  <div className='relative'>
                                    <Input
                                      type='number'
                                      inputMode='numeric'
                                      value={repeatValue}
                                      onChange={e => {
                                        const val = parseInt(e.target.value, 10);
                                        if (e.target.value === '') {
                                          setRepeatValue('');
                                        } else if (!isNaN(val) && val >= 1) {
                                          setRepeatValue(val);
                                        }
                                      }}
                                      onBlur={() => {
                                        if (repeatValue === '' || repeatValue < 1) {
                                          setRepeatValue(1);
                                        }
                                      }}
                                      className='rounded-lg border py-2 px-3 pr-8 focus-visible:ring-0
                                  [&::-webkit-outer-spin-button]:appearance-none
                                  [&::-webkit-inner-spin-button]:appearance-none
                                  [&::-webkit-inner-spin-button]:m-0
                                  [appearance:textfield]'
                                    />
                                    <span className='flex flex-col absolute top-1.5 right-3'>
                                      <ChevronUp
                                        onClick={() =>
                                          setRepeatValue(prev =>
                                            typeof prev === 'number' ? prev + 1 : 1,
                                          )
                                        }
                                        className='size-3 text-secondary-foreground/40 hover:text-secondary-foreground/60 cursor-pointer'
                                        strokeWidth={3}
                                      />
                                      <ChevronDown
                                        onClick={() =>
                                          setRepeatValue(prev =>
                                            Math.max(1, typeof prev === 'number' ? prev - 1 : 0),
                                          )
                                        }
                                        className='size-3 text-secondary-foreground/40 hover:text-secondary-foreground/60 cursor-pointer'
                                        strokeWidth={3}
                                      />
                                    </span>
                                  </div>
                                  {/* Frequency pills */}
                                  <div className='flex gap-2 justify-between -mt-1'>
                                    {(['DAY', 'WEEK', 'MONTH'] as const).map(freq => (
                                      <button
                                        key={freq}
                                        type='button'
                                        onClick={() => {
                                          setRecurrenceFrequency(freq);
                                          if (freq === 'WEEK') {
                                            // Set default day based on startsAt date when switching to WEEK
                                            setRecurrenceDays(prev => {
                                              const dayIndex = startsAt.getDay();
                                              if (dayIndex >= 0 && dayIndex < DAY_KEYS.length) {
                                                const todayKey = DAY_KEYS[dayIndex];
                                                if (todayKey) {
                                                  setRecurrenceDays([todayKey]);
                                                }
                                              }
                                              return prev;
                                            });
                                          } else if (freq === 'DAY') {
                                            // Clear days when switching to DAY frequency
                                            setRecurrenceDays([]);
                                          }
                                        }}
                                        data-track-category='calls'
                                        data-track-name={`set-recurrence-frequency-${freq.toLowerCase()}`}
                                        className={cn(
                                          'w-full h-7 rounded-full text-[13px] font-medium transition-colors',
                                          recurrenceFrequency === freq
                                            ? 'bg-sidebar-badge-accent text-white'
                                            : 'text-foreground bg-secondary',
                                        )}
                                      >
                                        {freq.charAt(0) + freq.slice(1).toLowerCase()}
                                      </button>
                                    ))}
                                  </div>

                                  {/* Day-of-week pills — weekly only */}
                                  <AnimatePresence initial={false} mode='wait'>
                                    {recurrenceFrequency === 'WEEK' && (
                                      <motion.div
                                        initial={{ opacity: 0, height: 0 }}
                                        animate={{ opacity: 1, height: 'auto' }}
                                        exit={{ opacity: 0, height: 0 }}
                                        transition={{ duration: 0.2, ease: 'easeInOut' }}
                                        className='flex flex-col gap-1.5 overflow-hidden'
                                      >
                                        <p className='text-secondary-foreground/60 text-[13px] font-medium'>
                                          Repeat on
                                        </p>
                                        <div className='flex gap-2.5'>
                                          {DAY_OPTIONS.map(({ key, label }) => (
                                            <button
                                              key={key}
                                              type='button'
                                              onClick={() => toggleRecurrenceDay(key)}
                                              data-track-category='calls'
                                              data-track-name={`toggle-recurrence-day-${key.toLowerCase()}`}
                                              className={cn(
                                                'size-[22px] rounded-full text-[12px] transition-colors',
                                                recurrenceDays.includes(key)
                                                  ? 'bg-sidebar-badge-accent text-white'
                                                  : 'bg-secondary/90',
                                              )}
                                            >
                                              {label}
                                            </button>
                                          ))}
                                        </div>
                                        {recurrenceDays.length === 0 && (
                                          <p className='text-red-500 text-xs'>
                                            Select at least one day
                                          </p>
                                        )}
                                      </motion.div>
                                    )}
                                    {recurrenceFrequency === 'MONTH' && (
                                      <motion.div
                                        initial={{ opacity: 0, height: 0 }}
                                        animate={{ opacity: 1, height: 'auto' }}
                                        exit={{ opacity: 0, height: 0 }}
                                        transition={{ duration: 0.2, ease: 'easeInOut' }}
                                        className='flex flex-col gap-1.5 overflow-hidden'
                                      >
                                        <p className='text-secondary-foreground/60 text-[13px] font-medium'>
                                          Repeat on
                                        </p>
                                        <RadioGroup
                                          className='!gap-1.5 text-[13px]'
                                          value={monthlyType}
                                          onChange={val =>
                                            setMonthlyType(
                                              val as 'monthly_day' | 'monthly_nth_weekday',
                                            )
                                          }
                                        >
                                          <div className='flex flex-col flex-1 items-start gap-2'>
                                            {(() => {
                                              const dayOfMonth = startsAt.getDate();
                                              const { occurrence, weekday, isLast, ordinalWord } =
                                                getWeekdayOccurrence(startsAt);
                                              return (
                                                <>
                                                  <Radio value='monthly_day'>
                                                    Monthly on day {dayOfMonth}
                                                    {dayOfMonth > 28 && (
                                                      <span className='block text-amber-600 text-xs mt-0.5'>
                                                        (not all months have {dayOfMonth} days)
                                                      </span>
                                                    )}
                                                  </Radio>
                                                  <Radio value='monthly_nth_weekday'>
                                                    Monthly on {ordinalWord} {weekday.toLowerCase()}
                                                    {isLast && occurrence >= 4 && (
                                                      <span className='block text-amber-600 text-xs mt-0.5'>
                                                        (only months with {occurrence} {weekday}s)
                                                      </span>
                                                    )}
                                                  </Radio>
                                                </>
                                              );
                                            })()}
                                          </div>
                                        </RadioGroup>
                                      </motion.div>
                                    )}
                                  </AnimatePresence>

                                  {/* Series end date */}
                                  <div className='flex flex-col gap-3'>
                                    <p className='text-secondary-foreground/60 text-[13px] font-medium'>
                                      Ends
                                    </p>
                                    <RadioGroup
                                      className='!gap-1.5'
                                      value={seriesEndsType}
                                      onChange={(val: string) =>
                                        setSeriesEndsType(val as 'never' | 'on' | 'after')
                                      }
                                    >
                                      <Radio value='never'>Never</Radio>
                                      <div className='flex flex-1 items-center justify-between'>
                                        <Radio value='on'>On</Radio>
                                        <DatePicker
                                          selectedDate={seriesEndsOn ?? null}
                                          onSelect={date => {
                                            setSeriesEndsOn(date ?? null);
                                            if (date) setSeriesEndsType('on');
                                          }}
                                          placeholder='Pick end date'
                                          minDate={startsAt ?? new Date()}
                                          inputClassName={cn(
                                            'text-sm leading-5 bg-transparent rounded-lg h-8 gap-2.5 min-w-44',
                                            seriesEndsType !== 'on' &&
                                              'opacity-40 pointer-events-none',
                                          )}
                                          showClearButton={
                                            !!seriesEndsOn && seriesEndsType === 'on'
                                          }
                                        />
                                      </div>
                                      <div className='flex items-center justify-between'>
                                        <Radio value='after' className='text-[13px] leading-5'>
                                          After
                                        </Radio>
                                        <div className='relative overflow-hidden'>
                                          <Input
                                            type='text'
                                            inputMode='numeric'
                                            pattern='[0-9]*'
                                            maxLength={3}
                                            value={occurrenceCount}
                                            disabled={seriesEndsType !== 'after'}
                                            onChange={e => {
                                              const val = parseInt(e.target.value, 10);
                                              if (e.target.value === '') {
                                                setOccurrenceCount('');
                                              } else if (!isNaN(val)) {
                                                setOccurrenceCount(Math.min(Math.max(val, 1), 365));
                                              }
                                            }}
                                            onBlur={() => {
                                              if (occurrenceCount === '' || occurrenceCount < 1) {
                                                setOccurrenceCount(1);
                                              }
                                            }}
                                            className={cn(
                                              'rounded-lg border py-2 pl-3 pr-8 focus-visible:ring-0 [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-inner-spin-button]:m-0 [appearance:textfield] text-[13px] w-44',
                                              seriesEndsType !== 'after' &&
                                                'opacity-40 cursor-not-allowed',
                                            )}
                                          />
                                          <span
                                            aria-hidden
                                            className='invisible absolute left-3 top-1/2 -translate-y-1/2 whitespace-pre text-sm font-normal pointer-events-none'
                                          >
                                            {occurrenceCount}
                                          </span>

                                          <span
                                            aria-hidden
                                            style={{
                                              left: `calc(0.75rem + ${String(occurrenceCount).length}ch)`,
                                            }}
                                            className={cn(
                                              'absolute top-1/2 -translate-y-1/2 text-sm text-foreground pointer-events-none select-none whitespace-nowrap',
                                              seriesEndsType !== 'after' && 'opacity-40',
                                            )}
                                          >
                                            &nbsp;
                                            {occurrenceCount === 1 ? 'occurrence' : 'occurrences'}
                                          </span>
                                          <span className='h-full  absolute right-0 rounded-r-lg w-8 ' />
                                          <span className='flex flex-col absolute top-1.5 right-3 '>
                                            <ChevronUp
                                              onClick={() =>
                                                seriesEndsType === 'after' &&
                                                setOccurrenceCount(prev =>
                                                  Math.min((prev === '' ? 0 : prev) + 1, 365),
                                                )
                                              }
                                              className={cn(
                                                'size-3 text-secondary-foreground/40 cursor-pointer',
                                                seriesEndsType !== 'after' &&
                                                  'opacity-40 cursor-not-allowed',
                                              )}
                                              strokeWidth={3}
                                            />
                                            <ChevronDown
                                              onClick={() =>
                                                seriesEndsType === 'after' &&
                                                setOccurrenceCount(prev =>
                                                  Math.max(1, (prev === '' ? 0 : prev) - 1),
                                                )
                                              }
                                              className={cn(
                                                'size-3 text-secondary-foreground/40 cursor-pointer',
                                                seriesEndsType !== 'after' &&
                                                  'opacity-40 cursor-not-allowed',
                                              )}
                                              strokeWidth={3}
                                            />
                                          </span>
                                        </div>
                                      </div>
                                    </RadioGroup>
                                  </div>
                                  {/* Action buttons */}
                                  <div className='flex items-center justify-between gap-2 w-full py-1.5'>
                                    <Button
                                      variant='outline'
                                      onClick={() => {
                                        setShowCustomPanel(false);
                                        // Restore previous state if available
                                        if (previousRecurrenceState) {
                                          setIsRecurring(previousRecurrenceState.isRecurring);
                                          setRecurrenceFrequency(
                                            previousRecurrenceState.recurrenceFrequency,
                                          );
                                          setRecurrenceDays(previousRecurrenceState.recurrenceDays);
                                          setRepeatValue(previousRecurrenceState.repeatValue);
                                          setMonthlyType(previousRecurrenceState.monthlyType);
                                          setSeriesEndsType(previousRecurrenceState.seriesEndsType);
                                          setSeriesEndsOn(previousRecurrenceState.seriesEndsOn);
                                          setOccurrenceCount(
                                            previousRecurrenceState.occurrenceCount,
                                          );
                                        }
                                      }}
                                      className='rounded-lg text-sm leading-5 bg-transparent h-8 gap-2.5'
                                    >
                                      Cancel
                                    </Button>
                                    <Button
                                      onClick={() => {
                                        // Validate weekly recurrence has at least one day selected
                                        if (
                                          recurrenceFrequency === 'WEEK' &&
                                          recurrenceDays.length === 0
                                        ) {
                                          toast.error('Select at least one day', {
                                            description:
                                              'Weekly recurrence requires at least one day of the week.',
                                            duration: 3000,
                                          });
                                          return;
                                        }
                                        setShowCustomPanel(false);
                                      }}
                                      className='rounded-lg text-sm leading-5 bg-sidebar-badge-accent h-8 gap-2.5'
                                    >
                                      Done
                                    </Button>
                                  </div>
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </motion.div>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                )}
              </div>

              {/* Internal Users — channel members (Xyne users). */}
              <div className='space-y-2'>
                <p className='text-muted-foreground text-[13px] leading-5'>{participantLabel}</p>
                <Controller
                  name='participants'
                  control={control}
                  render={({ field }) => (
                    <SearchParticipants
                      options={inviteUserOrChannelOptions}
                      selectedValues={field.value}
                      onMultiSelect={async (values: string[]) => {
                        const expanded = await expandGroupSelections(values);
                        field.onChange(expanded);
                      }}
                      searchQuery={searchQuery}
                      setSearchQuery={(q: string) => {
                        setSearchQuery(q);
                        if (notFoundUsers.length > 0) setNotFoundUsers([]);
                      }}
                      onEnterQuerySubmit={handleBulkUserEntry}
                      helperText={
                        notFoundUsers.length > 0
                          ? `${notFoundUsers.length} user${notFoundUsers.length === 1 ? '' : 's'} not found`
                          : undefined
                      }
                    />
                  )}
                />
                {errors.participants && (
                  <p className='text-red-500 text-xs'>{errors.participants.message}</p>
                )}
              </div>

              {/* External Users — people outside Xyne, invited by email. */}
              {enableExternalInvitees && threadConversationId && (
                <div className='space-y-2 -mb-3'>
                  <div className='flex items-baseline justify-between'>
                    <p className='text-muted-foreground text-[13px] leading-5'>External Users</p>
                    <p className='text-[11px] text-muted-foreground/80'>
                      Invited by email · join via link
                    </p>
                  </div>
                  <Controller
                    name='externalEmails'
                    control={control}
                    render={({ field }) => (
                      <ExternalInviteesInput
                        value={field.value}
                        onChange={field.onChange}
                        suggestedEmails={suggestedExternalEmails}
                        prefillKey={threadConversationId ?? 'none'}
                      />
                    )}
                  />
                </div>
              )}

              {/* Edit entire series checkbox — only for recurring calls in edit mode */}
              {isEditMode && initialCall?.recurringSeriesId && (
                <Checkbox
                  checked={editEntireSeries}
                  onChange={setEditEntireSeries}
                  label='Apply to all calls in this series'
                />
              )}

              {/* Post call updates to channel — only when participants are added and no channel is selected */}
              {showPostCallUpdates && (
                <div className='flex items-center gap-3'>
                  <div className='flex items-center gap-1.5'>
                    <Checkbox
                      checked={postCallUpdates}
                      onChange={checked => {
                        setPostCallUpdates(checked);
                        if (!checked) {
                          setUpdateChannelId(null);
                          setChannelSearchQuery('');
                        }
                      }}
                      label='Post call updates to channel'
                    />
                    <Tooltip
                      content='Only selected participants will receive call notifications, and the summaries will be posted to the chosen channel.'
                      side='top'
                      sideOffset={6}
                      className='max-w-60'
                    >
                      <button
                        type='button'
                        className='text-muted-foreground hover:text-foreground transition-colors'
                      >
                        <Info className='size-3.5' strokeWidth={2} />
                      </button>
                    </Tooltip>
                  </div>
                  {postCallUpdates && (
                    <div className='min-w-48 flex-1 relative'>
                      <div
                        className={cn(
                          'flex items-center gap-2 rounded-lg border h-8 px-3',
                          !updateChannelId ? 'border-red-500' : 'border-input',
                        )}
                      >
                        {updateChannelId && !channelPickerOpen && selectedChannelItem?.leftSlot}
                        <input
                          ref={channelInputRef}
                          value={
                            channelPickerOpen
                              ? channelSearchQuery
                              : (selectedChannelItem?.label ?? '')
                          }
                          onChange={e => setChannelSearchQuery(e.target.value)}
                          onFocus={() => {
                            setChannelSearchQuery('');
                            setChannelPickerOpen(true);
                          }}
                          onBlur={() => setChannelPickerOpen(false)}
                          placeholder='Select channel'
                          data-track-category='calls'
                          data-track-name='channel-picker-search'
                          className='flex-1 min-w-0 text-sm text-foreground bg-transparent outline-none placeholder:text-muted-foreground'
                        />
                        {updateChannelId && (
                          <button
                            type='button'
                            onMouseDown={e => {
                              e.preventDefault();
                              setUpdateChannelId(null);
                              setChannelSearchQuery('');
                              setChannelPickerOpen(true);
                              channelInputRef.current?.focus();
                            }}
                            className='text-muted-foreground hover:text-foreground transition-colors flex-shrink-0'
                          >
                            <X className='size-3.5' />
                          </button>
                        )}
                      </div>
                      {channelPickerOpen && (
                        <div className='absolute top-full mt-1 left-0 right-0 z-50 bg-popover border border-border rounded-md shadow-lg max-h-48 overflow-y-auto py-1'>
                          {channelComboboxItems.length === 0 ? (
                            <p className='text-sm text-muted-foreground px-3 py-2'>
                              No channels found
                            </p>
                          ) : (
                            channelComboboxItems.map(item => (
                              <button
                                key={item.value}
                                type='button'
                                onMouseDown={e => {
                                  e.preventDefault(); // prevent input blur before selection
                                  setUpdateChannelId(item.value);
                                  setChannelSearchQuery('');
                                  setChannelPickerOpen(false);
                                }}
                                data-track-category='calls'
                                data-track-name='select-post-call-channel'
                                className='w-full flex items-center gap-2 mx-1 px-2 py-1.5 text-sm text-popover-foreground cursor-pointer hover:bg-accent rounded-md'
                              >
                                {item.leftSlot}
                                {item.label}
                              </button>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              <SubmitFooter
                missingRequirements={missingRequirements}
                disabled={submitDisabled}
                isSubmitting={isSubmitting}
                label={submitLabel}
                onCancel={handleClose}
              />
            </div>
          </motion.form>
        )}
      </AnimatePresence>
    </Dialog>
  );
};

const SubmitFooter: React.FC<{
  missingRequirements: string[];
  disabled: boolean;
  isSubmitting: boolean;
  label: string;
  onCancel: () => void;
}> = ({ missingRequirements, disabled, isSubmitting, label, onCancel }) => {
  // The <span> lets the Tooltip pick up pointer events even when the
  // wrapped Button is disabled.
  const submitButton = (
    <span className='inline-flex'>
      <Button
        size='sm'
        type='submit'
        disabled={disabled}
        className='rounded-lg text-[13px] px-4 h-9 text-primary-foreground bg-primary hover:bg-primary hover:opacity-80 disabled:opacity-50 disabled:cursor-not-allowed'
      >
        {label}
      </Button>
    </span>
  );

  return (
    <div className='flex items-center justify-between pb-5'>
      <Button
        variant='outline'
        size='sm'
        className='rounded-lg text-[13px] px-4 h-9'
        onClick={onCancel}
        disabled={isSubmitting}
        type='button'
      >
        Cancel
      </Button>
      {missingRequirements.length === 0 ? (
        submitButton
      ) : (
        <Tooltip
          content={
            <div className='text-left'>
              <p className='font-medium mb-1'>Still needed to schedule:</p>
              <ul className='list-disc pl-4 space-y-0.5'>
                {missingRequirements.map(m => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </div>
          }
          side='top'
          delayDuration={150}
        >
          {submitButton}
        </Tooltip>
      )}
    </div>
  );
};
