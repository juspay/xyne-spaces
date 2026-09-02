import React, { useMemo, useCallback, useState, useRef } from 'react';
import { Button } from '../../ui/Button';
import Input from '../../ui/Input';
import { ChannelScopeType, ChannelVisibility, isDeskChannelType } from '@xyne/shared';
import { useQuery } from '@tanstack/react-query';
import { channelService } from '../../../services/Chat/channelService';
import { useSelf, useActiveUsers, useUsers } from '../../../hooks/useUsers';
import { useZero } from '../../../hooks/useZero';
import { isUserDeactivated } from '../../../utils/userDisplayName';
import { useAllVisibleChannels, useChannel } from '../../../hooks/useChannels';
import { useUserGroupSearch } from '@xyne/shared/hooks';
import { callService, type ScheduleCallRequest } from '../../../services/Call/callService';
import DOMPurify from 'dompurify';
import { queries } from '../../../zero/queries';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { cn } from '../../../utils/classNames';
import Dialog from '../../ui/Dialog';
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
import { rankParticipantOptions } from '../../../utils/participantSearch';
import Avatar from '../../ui/Avatar/Avatar';
import { ParticipantOptionContent } from '../ParticipantOptionContent';
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
import { Combobox } from '../../ui/Combobox/Combobox';
import { ExternalInviteesInput } from './ExternalInviteesInput';
import { InvitationPreviewStep } from './InvitationPreviewStep';
import type {
  MonthlyType,
  ScheduleCallFormData,
  ScheduleCallModalProps,
  SeriesEndsType,
} from './types';
import {
  applyHHMMToDate,
  getDefaultScheduledStartTime,
  getWeekdayOccurrence,
  isValidDate,
  parseTimeAndUpdateDate,
  toHHMM,
} from './dateTime';
import { DAY_KEYS, DAY_OPTIONS } from './recurrence';
import { useRecurringCallForm } from './hooks/useRecurringCallForm';
import { useExternalInviteSuggestions } from './hooks/useExternalInviteSuggestions';
import { usePostCallUpdates } from './hooks/usePostCallUpdates';
import { useScheduleCallInitialization } from './hooks/useScheduleCallInitialization';
import { useChannelMemberExclusions } from './hooks/useChannelMemberExclusions';
import {
  validateCallDateTimes,
  validateRecurringCallTimes,
  mergeDateWithTime,
} from '../../../utils/callTimeValidation';
import { logger, Event } from '../../../utils/logger';

export type { EditCallData } from './types';

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
  externalInviteDelivery = 'standalone',
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
    { enabled: isOpen && !!threadConversationId },
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

  // For recurring calls in edit mode — checkbox to edit the whole series
  const [editEntireSeries, setEditEntireSeries] = useState(false);

  // Selective participants: tracks which participant IDs were in the original call (edit mode)
  // and whether the exclusion set has been initialized from the channel member list.
  const selectiveEditParticipantIdsRef = useRef<Set<string> | null>(null);
  const selectiveExclusionsInitializedRef = useRef<boolean>(false);
  // groupId → member user IDs, cached when a group is expanded on select. A picked
  // group leaves no `user_group:` value behind (it becomes `user:` pills), so this is
  // the only way to know a group is already represented and hide it from the list.
  const expandedGroupMembersRef = useRef<Map<string, string[]>>(new Map());

  // Fetch recurring call series data via Zero — only when the modal is open and
  // in edit mode for a recurring call, so the query doesn't run when the popup is closed.
  // This is metadata-only; applying to the series keeps whatever is currently in the form.
  const [seriesData] = useCachedQuery(
    queries.recurringSeriesById({ seriesId: initialCall?.recurringSeriesId ?? '' }),
    { enabled: isOpen && isEditMode && !!initialCall?.recurringSeriesId },
  );

  // Filter for DEFAULT public channels only (not DMs, not EMAIL/Desk channels)
  const channels = useMemo(() => {
    return allVisibleChannels.filter(
      channel => channel.scopeType === ChannelScopeType.DEFAULT && !isDeskChannelType(channel.type),
    );
  }, [allVisibleChannels]);

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

  // Derive selected channel ID from participant picker (for selective-participants Case 4)
  const selectedChannelId = useMemo(() => {
    const v = participants.find(p => p.startsWith('channel:'));
    return v ? v.replace('channel:', '') : null;
  }, [participants]);

  // Fetch members of the selected channel (with user details) via REST so the unfurled checkbox
  // list can be shown. A one-shot API call is lighter than a reactive Zero subscription here, and
  // it returns every member's user inline — no client-side join against the active-users list.
  const { data: selectedChannelParticipants } = useQuery({
    queryKey: ['channel-members', selectedChannelId],
    queryFn: () => channelService.getChannelMembers(selectedChannelId!),
    enabled: isOpen && !!selectedChannelId,
    staleTime: 30_000,
  });

  // Every unique address from the thread; user removes chips they don't want.
  const suggestedExternalEmails = useExternalInviteSuggestions({
    ticketEmails,
    channelOwnEmail,
    userEmail: user?.email,
  });

  const {
    channelComboboxItems,
    channelInputRef,
    channelPickerOpen,
    channelSearchQuery,
    postCallUpdates,
    resetPostCallUpdates,
    selectedChannelItem,
    setChannelPickerOpen,
    setChannelSearchQuery,
    setPostCallUpdates,
    setUpdateChannelId,
    showPostCallUpdates,
    updateChannelError,
    updateChannelId,
  } = usePostCallUpdates({
    channels,
    participantCount: participants.length,
  });

  const participantLabel = useMemo(() => {
    if (participants.some(v => v.startsWith('channel:'))) return 'Selected Channel';
    return 'Internal Users';
  }, [participants]);

  // Search query state (not in form)
  const [searchQuery, setSearchQuery] = React.useState('');
  const userGroups = useUserGroupSearch(searchQuery, 10);
  const [notFoundUsers, setNotFoundUsers] = React.useState<string[]>([]);

  const {
    applyRRule,
    buildRrule,
    isRecurring,
    monthlyType,
    occurrenceCount,
    previousRecurrenceState,
    recurrenceDays,
    recurrenceFrequency,
    recurrenceLabel,
    recurringEndTime,
    recurringStartTime,
    repeatValue,
    resetRecurringState,
    seriesEndsOn,
    seriesEndsType,
    setIsRecurring,
    setMonthlyType,
    setOccurrenceCount,
    setPreviousRecurrenceState,
    setRecurrenceDays,
    setRecurrenceFrequency,
    setRecurringEndTime,
    setRecurringStartTime,
    setRecurringTimesFromDates,
    setRepeatValue,
    setSeriesEndsOn,
    setSeriesEndsType,
    setShowCustomPanel,
    showCustomPanel,
    toggleRecurrenceDay,
  } = useRecurringCallForm({
    defaultStart,
    startsAt,
    isInitiallyRecurring: isEditMode && !!initialCall?.recurringSeriesId,
  });
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

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

  useScheduleCallInitialization({
    allVisibleChannels,
    applyRRule,
    defaultStart,
    editEntireSeries,
    initialCall,
    initialEndsAt,
    initialParticipants,
    initialStartsAt,
    initialTitle,
    isEditMode,
    isOpen,
    reset,
    selectiveEditParticipantIdsRef,
    selectiveExclusionsInitializedRef,
    seriesData,
    setEditEntireSeries,
    setIsRecurring,
    setPostCallUpdates,
    setRecurringTimesFromDates,
    setSeriesEndsOn,
    setSeriesEndsType,
    setUpdateChannelId,
    setValue,
    user,
    validateTimes,
  });

  const buildUserOption = (
    u: Pick<(typeof allUsers)[number], 'id' | 'name'> &
      Partial<Pick<(typeof allUsers)[number], 'email' | 'displayName' | 'status'>>,
  ) => ({
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
      <ParticipantOptionContent
        icon={
          <Avatar
            userId={u.id}
            size='sm'
            showActiveStatus={false}
            className='rounded-md size-[18px] flex items-center justify-center bg-background'
          />
        }
        label={getUserDisplayName(u)}
        subtitle={u.email}
        isDeactivated={isUserDeactivated(u)}
      />
    ),
    type: 'user' as const,
  });

  // Build ParticipantOptions for the unfurled channel-member checkbox list.
  // Members come from the API as { id, name }, so no allUsers cross-reference is needed.
  const channelMembersOptions = useMemo(() => {
    if (!selectedChannelId || !selectedChannelParticipants) return null;
    return selectedChannelParticipants.filter(m => m.id !== user?.id).map(buildUserOption);
  }, [selectedChannelId, selectedChannelParticipants, user?.id]);

  const {
    allChannelMembersExcluded,
    excludedChannelMembers,
    selectedChannelMembers,
    toggleExcludedChannelMember,
  } = useChannelMemberExclusions({
    channelMembersOptions,
    editEntireSeries,
    isEditMode,
    selectedChannelId,
    selectiveEditParticipantIdsRef,
    selectiveExclusionsInitializedRef,
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
          .filter(p => !p.isExternal && p.userId !== user?.id)
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
      children: (
        <ParticipantOptionContent
          icon={<Users className='size-3.5 text-muted-foreground mx-0.5' strokeWidth={2.3} />}
          label={group.name}
          subtitle={group.alias || group.description}
        />
      ),
      type: 'user_group' as const,
    }));

    // In edit mode, the call's existing channel may be filtered out of `channels`
    // (e.g. a Desk channel). Inject it into options so it remains searchable/selectable.
    // DM/GROUP_DM-backed calls are excluded: they prefill individual participants from
    // call_participants rather than a channel pill (see useScheduleCallInitialization),
    // and their `name` is raw user IDs, so injecting one puts a UUID in the picker.
    if (isEditMode && initialCall?.channelId) {
      const alreadyIncluded = channelOptions.some(
        c => c.value === `channel:${initialCall.channelId}`,
      );
      if (!alreadyIncluded) {
        const existingChannel = allVisibleChannels.find(c => c.id === initialCall.channelId);
        if (
          existingChannel &&
          existingChannel.scopeType !== ChannelScopeType.DM &&
          existingChannel.scopeType !== ChannelScopeType.GROUP_DM
        ) {
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
        .filter(p => !p.isExternal && p.userId !== user?.id)
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

  // Drop groups whose every member is already picked. Re-reading the ref is safe here:
  // expansion always writes it before updating `participants`, which re-runs this memo.
  // Removing any one member drops the group back into the list.
  // A non-organizer participant may only add/remove people (and only on a DM/GROUP_DM
  // call, which is what gates the entry point). Mirrors the backend rule in
  // scheduleCallController.updateScheduledCall, which rejects any other field from them.
  const participantsOnly =
    isEditMode &&
    !!initialCall?.organizerUserId &&
    !!user?.id &&
    initialCall.organizerUserId !== user.id;

  // Restricted editors may drop the people they invited themselves, so only the organizer
  // and everyone invited by someone else is pinned. Mirrors the backend's pinned set in
  // scheduleCallController.authorizeScheduledCallEdit.
  const lockedParticipantValues = useMemo(
    () =>
      participantsOnly && initialCall
        ? new Set(
            initialCall.participants
              .filter(
                p =>
                  !p.isExternal &&
                  p.userId !== user?.id &&
                  (p.userId === initialCall.organizerUserId || p.invitedBy !== user?.id),
              )
              .map(p => `user:${p.userId}`),
          )
        : undefined,
    [participantsOnly, initialCall, user?.id],
  );

  const rankedParticipantOptions = useMemo(() => {
    const selectedUserIds = new Set(
      participants.filter(v => v.startsWith('user:')).map(v => v.replace('user:', '')),
    );
    const remaining = inviteUserOrChannelOptions.filter(option => {
      if (!option.value.startsWith('user_group:')) return true;
      const members = expandedGroupMembersRef.current.get(option.value.replace('user_group:', ''));
      if (!members?.length) return true;
      return !members.every(id => selectedUserIds.has(id));
    });
    return rankParticipantOptions(remaining, searchQuery);
  }, [inviteUserOrChannelOptions, searchQuery, participants]);

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
      // A restricted editor sends no times and their inputs are hidden, so an error here
      // would be an invisible dead end — a call whose start has already passed, or a series
      // that crosses midnight, would block them forever.
      if (!participantsOnly) {
        if (isRecurring) {
          const recurringTimeError = validateRecurringCallTimes(
            recurringStartTime,
            recurringEndTime,
          );
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
      }

      if (updateChannelError) {
        return;
      }

      // ── Step advance: externals present and still on Step 1 ──────────────
      // Invitation preview + Send happens on Step 2.
      if (!isEditMode && (data.externalEmails ?? []).length > 0 && step === 'participants') {
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

      let userIds: string[] = [];
      let channelId: string | undefined;
      data.participants.forEach(value => {
        if (value.startsWith('user:')) userIds.push(value.replace('user:', ''));
        else if (value.startsWith('channel:')) channelId = value.replace('channel:', '');
      });
      const effExternals = data.externalEmails ?? [];
      const buildExternalInvitation = (): NonNullable<ScheduleCallRequest['invitation']> => {
        // Server re-sanitizes; doing it here too keeps a tampered payload
        // from ever shipping unsafe HTML over the wire.
        const safeBody = DOMPurify.sanitize((data.invitationMessageHtml || '').trim());
        return {
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
      };

      // hasChannelExclusions: true when user picked a channel but unchecked some members.
      // Used only as a local guard — never sent to the API.
      let hasChannelExclusions = false;
      if (channelId && excludedChannelMembers.size > 0 && selectedChannelMembers) {
        userIds = selectedChannelMembers
          .filter((m: { userId: string }) => !excludedChannelMembers.has(m.userId))
          .map((m: { userId: string }) => m.userId);
        hasChannelExclusions = true;
      }

      // Guard: a selective-participants call with nobody selected is invalid.
      // The backend cannot distinguish "organizer only" from "whole channel" without targetUserIds.
      if (hasChannelExclusions && userIds.length === 0) {
        return;
      }

      // ── EDIT MODE ──────────────────────────────────────────────────────────
      if (isEditMode && initialCall) {
        if (editEntireSeries && initialCall.recurringSeriesId) {
          // Validate weekly requires at least one day. A participant editor never sends the
          // recurrence rule, so the check doesn't apply to them.
          if (!participantsOnly && recurrenceFrequency === 'WEEK' && recurrenceDays.length === 0) {
            toast.error('Select at least one day', {
              description: 'Weekly recurrence requires at least one day.',
              duration: 3000,
            });
            return;
          }
          const resolvedChannelId = channelId; // selective calls stay on their channel
          // A participant editor may send nothing but the invite list — the backend rejects
          // the request outright otherwise.
          await callService.updateRecurringSeries(
            initialCall.recurringSeriesId,
            participantsOnly
              ? { targetUserIds: userIds }
              : {
                  title: data.title,
                  // postCallUpdates mode: send callUpdatesChannel (backend checks membership)
                  // Selective call: send channelId (no callUpdatesChannel),
                  ...(postCallUpdates && updateChannelId
                    ? { callUpdatesChannel: updateChannelId }
                    : {}),
                  ...(resolvedChannelId ? { channelId: resolvedChannelId } : {}),
                  ...(userIds.length > 0 && { targetUserIds: userIds }),
                  recurrenceRule: buildRrule(),
                  timezone,
                  startTime: recurringStartTime,
                  endTime: recurringEndTime,
                  startsOn: data.startsAt.getTime(),
                  externalInvitees: effExternals,
                  ...(seriesEndsType === 'on' &&
                    seriesEndsOn !== null && { endsOn: seriesEndsOn.getTime() }),
                },
          );
          toast.success('Recurring Series Updated', {
            description: `Changes applied to all occurrences of ${data.title}`,
            duration: 3000,
          });
        } else {
          // Edit single occurrence. A participant editor may send nothing but the
          // invite list — the backend rejects the request outright otherwise.
          await callService.updateScheduledCall(
            initialCall.externalId,
            participantsOnly
              ? { targetUserIds: userIds }
              : {
                  title: data.title,
                  startsAt: new Date(data.startsAt).getTime(),
                  endsAt: new Date(data.endsAt).getTime(),
                  ...(postCallUpdates && updateChannelId
                    ? { callUpdatesChannel: updateChannelId }
                    : {}),
                  ...(channelId ? { channelId } : {}),
                  ...(userIds.length > 0 && { targetUserIds: userIds }),
                  externalInvitees: effExternals,
                },
          );
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
          // channelId and callUpdatesChannel are orthogonal: a channel-scoped call can also
          // broadcast updates to a different channel. Send whatever applies; the backend stores both.
          ...(channelId !== undefined && { channelId }),
          ...(postCallUpdates && updateChannelId && { callUpdatesChannel: updateChannelId }),
          ...(userIds.length > 0 && { targetUserIds: userIds }),
          timezone,
          recurrenceRule: buildRrule(),
          startTime: recurringStartTime,
          endTime: recurringEndTime,
          startsOn: data.startsAt.getTime(),
        };
        if (seriesEndsType === 'on' && seriesEndsOn !== null) {
          recurringRequest.endsOn = seriesEndsOn.getTime();
        }
        if (effExternals.length > 0) {
          recurringRequest.externalInvitees = effExternals;
          recurringRequest.invitation = buildExternalInvitation();
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
        } else {
          // channelId and callUpdatesChannel are orthogonal: a channel-scoped call can also
          // broadcast updates to a different channel. Send whatever applies.
          if (channelId) requestData.channelId = channelId;
          if (postCallUpdates && updateChannelId) requestData.callUpdatesChannel = updateChannelId;
          if (userIds.length > 0) requestData.targetUserIds = userIds;
        }
        if (effExternals.length > 0) {
          requestData.externalInvitees = effExternals;
          requestData.externalInviteDelivery = externalInviteDelivery;
          requestData.invitation = buildExternalInvitation();
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
      logger.error(Event.API_CALL_FAILED, {
        callId: initialCall?.externalId ?? null,
        context: 'ScheduleCallModal.submit',
        mode,
        recurringSeriesId: initialCall?.recurringSeriesId ?? null,
        error: err instanceof Error ? err.message : String(err),
      });
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
          expandedGroupMembersRef.current.set(groupId, memberIds);
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
    resetRecurringState(defaultStart);
    setEditEntireSeries(false);
    resetPostCallUpdates();
    onClose();
  }, [reset, onClose, user]); // eslint-disable-line react-hooks/exhaustive-deps

  const isDesigningInvitation = step === 'invitation';
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
  const canUseExternalInvitees = true;
  const scheduleStartIsValid = isValidDate(startsAt);
  const scheduleEndIsValid = isRecurring
    ? recurringStartTime.length > 0 && recurringEndTime.length > 0
    : isValidDate(endsAt);
  const fallbackInvitationStart = scheduleStartIsValid ? startsAt : getDefaultScheduledStartTime();
  const invitationPreviewStartsAt = isRecurring
    ? applyHHMMToDate(fallbackInvitationStart, recurringStartTime)
    : fallbackInvitationStart;
  const rawInvitationPreviewEndsAt = isRecurring
    ? applyHHMMToDate(fallbackInvitationStart, recurringEndTime)
    : isValidDate(endsAt)
      ? endsAt
      : new Date(invitationPreviewStartsAt.getTime() + 60 * 60 * 1000);
  const invitationPreviewEndsAt =
    rawInvitationPreviewEndsAt > invitationPreviewStartsAt
      ? rawInvitationPreviewEndsAt
      : new Date(invitationPreviewStartsAt.getTime() + 60 * 60 * 1000);

  // Single source of truth for the submit button: drives `disabled`, the
  // hover-tooltip contents, and the label.
  // A restricted editor submits the invite list and nothing else, and every other field is
  // hidden or disabled for them — so gating Save on those fields would strand them behind a
  // requirement they cannot see or fix.
  const missingRequirements: string[] = [];
  if (participants.length === 0) missingRequirements.push('Add at least one participant');
  if (!participantsOnly) {
    if (!title.trim()) missingRequirements.push('Add a title');
    if (!scheduleStartIsValid || errors.startsAt) {
      missingRequirements.push('Pick a valid start time');
    }
    if (!scheduleEndIsValid || errors.endsAt) missingRequirements.push('Pick a valid end time');
    if (isRecurring && recurrenceFrequency === 'WEEK' && recurrenceDays.length === 0) {
      missingRequirements.push('Pick at least one weekday');
    }
    if (postCallUpdates && !updateChannelId) {
      missingRequirements.push('Pick a channel for post-call updates');
    }
  }
  if (allChannelMembersExcluded) {
    missingRequirements.push('Include at least one channel participant');
  }
  const submitDisabled = isSubmitting || missingRequirements.length > 0;
  const submitLabel = isSubmitting
    ? isEditMode
      ? 'Saving...'
      : isRecurring
        ? 'Creating...'
        : 'Scheduling...'
    : !isEditMode && canUseExternalInvitees && externalEmails.length > 0
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
                  Curate the message and edit header details before the invitation is sent.
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
                startsAt: invitationPreviewStartsAt,
                endsAt: invitationPreviewEndsAt,
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
                data-track-category='CALLS'
                data-track-name='CLOSE_SCHEDULE_CALL_MODAL'
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
                      disabled={participantsOnly}
                      tabIndex={0}
                      className={cn(
                        '!text-[22px] truncate',
                        'px-0 border-none focus-visible:ring-0 rounded-none',
                        'font-semibold text-foreground placeholder:text-xl placeholder:text-muted-foreground',
                        errors.title && 'border-red-500',
                      )}
                    />
                  )}
                  // No rules for a restricted editor: the field is disabled and the title is
                  // never sent, so an existing empty or over-long title must not block Save.
                  rules={
                    participantsOnly
                      ? {}
                      : {
                          required: 'Title is required',
                          maxLength: {
                            value: 80,
                            message: 'Title must be less than 80 characters',
                          },
                          validate: value => value.trim().length > 0 || 'Title cannot be empty',
                        }
                  }
                />
                {errors.title && (
                  <p className='text-red-500 text-xs mt-1'>{errors.title.message}</p>
                )}
              </div>
              <div className={cn('flex flex-col gap-3', participantsOnly && 'hidden')}>
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
                          <Button
                            data-track-category='CALLS'
                            data-track-name='OPEN_RECURRENCE_MENU'
                            className='py-2 px-3 flex gap-2.5 rounded-lg bg-transparent hover:bg-secondary/80 border border-border text-foreground'
                          >
                            <span className='text-sm font-normal leading-6'>{recurrenceLabel}</span>
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
                                    data-track-category='CALLS'
                                    data-track-name='SET_NOT_RECURRING'
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
                                    data-track-category='CALLS'
                                    data-track-name='SET_RECURRING_DAILY'
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
                                    data-track-category='CALLS'
                                    data-track-name='SET_RECURRING_WEEKLY'
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
                                        data-track-category='CALLS'
                                        data-track-name='SET_RECURRING_MONTHLY'
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
                                    data-track-category='CALLS'
                                    data-track-name='OPEN_CUSTOM_RECURRENCE'
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
                                        data-track-category='CALLS'
                                        data-track-name='INCREMENT_REPEAT_INTERVAL'
                                        className='size-3 text-secondary-foreground/40 hover:text-secondary-foreground/60 cursor-pointer'
                                        strokeWidth={3}
                                      />
                                      <ChevronDown
                                        onClick={() =>
                                          setRepeatValue(prev =>
                                            Math.max(1, typeof prev === 'number' ? prev - 1 : 0),
                                          )
                                        }
                                        data-track-category='CALLS'
                                        data-track-name='DECREMENT_REPEAT_INTERVAL'
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
                                        data-track-category='CALLS'
                                        data-track-name={`set-recurrence-frequency-${freq.toLowerCase()}`}
                                        className={cn(
                                          'w-full h-7 rounded-full text-[13px] font-medium transition-colors',
                                          recurrenceFrequency === freq
                                            ? 'bg-primary text-white'
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
                                              data-track-category='CALLS'
                                              data-track-name={`toggle-recurrence-day-${key.toLowerCase()}`}
                                              className={cn(
                                                'size-[22px] rounded-full text-[12px] transition-colors',
                                                recurrenceDays.includes(key)
                                                  ? 'bg-primary text-white'
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
                                          onChange={val => setMonthlyType(val as MonthlyType)}
                                        >
                                          <div className='flex flex-col flex-1 items-start gap-2'>
                                            {(() => {
                                              const dayOfMonth = startsAt.getDate();
                                              const { occurrence, weekday, isLast, ordinalWord } =
                                                getWeekdayOccurrence(startsAt);
                                              return (
                                                <>
                                                  <Radio
                                                    value='monthly_day'
                                                    data-track-category='CALLS'
                                                    data-track-name='MONTHLY_TYPE_DAY_OF_MONTH'
                                                  >
                                                    Monthly on day {dayOfMonth}
                                                    {dayOfMonth > 28 && (
                                                      <span className='block text-amber-600 text-xs mt-0.5'>
                                                        (not all months have {dayOfMonth} days)
                                                      </span>
                                                    )}
                                                  </Radio>
                                                  <Radio
                                                    value='monthly_nth_weekday'
                                                    data-track-category='CALLS'
                                                    data-track-name='MONTHLY_TYPE_DAY_OF_WEEK'
                                                  >
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
                                        setSeriesEndsType(val as SeriesEndsType)
                                      }
                                    >
                                      <Radio
                                        value='never'
                                        data-track-category='CALLS'
                                        data-track-name='SERIES_ENDS_NEVER'
                                      >
                                        Never
                                      </Radio>
                                      <div className='flex flex-1 items-center justify-between'>
                                        <Radio
                                          value='on'
                                          data-track-category='CALLS'
                                          data-track-name='SERIES_ENDS_ON_DATE'
                                        >
                                          On
                                        </Radio>
                                        <DatePicker
                                          selectedDate={seriesEndsOn ?? null}
                                          onSelect={date => {
                                            setSeriesEndsOn(date ?? null);
                                            if (date) setSeriesEndsType('on');
                                          }}
                                          placeholder='Pick end date'
                                          minDate={startsAt ?? new Date()}
                                          // The recurrence panel is a DropdownMenuContent at
                                          // z-[60]; without this the calendar popover (z-50)
                                          // renders behind it. Raise it above the panel.
                                          contentClassName='z-[70]'
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
                                        <Radio
                                          value='after'
                                          data-track-category='CALLS'
                                          data-track-name='SERIES_ENDS_AFTER_COUNT'
                                          className='text-[13px] leading-5'
                                        >
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
                                              data-track-category='CALLS'
                                              data-track-name='INCREMENT_OCCURRENCE_COUNT'
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
                                              data-track-category='CALLS'
                                              data-track-name='DECREMENT_OCCURRENCE_COUNT'
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
                                      data-track-category='CALLS'
                                      data-track-name='CANCEL_CUSTOM_RECURRENCE'
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
                                      data-track-category='CALLS'
                                      data-track-name='APPLY_CUSTOM_RECURRENCE'
                                      className='rounded-lg text-sm leading-5 bg-primary h-8 gap-2.5'
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
                      options={rankedParticipantOptions}
                      disableClientFiltering
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
                      {...(channelMembersOptions ? { channelMembersOptions } : {})}
                      excludedChannelMembers={excludedChannelMembers}
                      {...(lockedParticipantValues
                        ? { lockedValues: lockedParticipantValues }
                        : {})}
                      hoistSelectedChannelMembers={isEditMode}
                      toggleExcludedChannelMember={toggleExcludedChannelMember}
                    />
                  )}
                />
                {allChannelMembersExcluded && (
                  <p className='text-red-500 text-xs mt-1'>
                    Include at least one participant — all channel members are currently excluded.
                  </p>
                )}
                {errors.participants && (
                  <p className='text-red-500 text-xs'>{errors.participants.message}</p>
                )}
              </div>

              {canUseExternalInvitees && !participantsOnly && (
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

              {/* Edit entire series checkbox — only for recurring calls in edit mode. Restricted
                  editors get it too: without it their invite changes would land on this one
                  occurrence and silently vanish from the rest of the series. */}
              {isEditMode && initialCall?.recurringSeriesId && (
                <Checkbox
                  checked={editEntireSeries}
                  onChange={setEditEntireSeries}
                  data-track-category='CALLS'
                  data-track-name='APPLY_TO_SERIES_TOGGLE'
                  label={
                    participantsOnly
                      ? 'Apply these people to all calls in this series'
                      : 'Apply to all calls in this series'
                  }
                />
              )}

              {/* Post call updates to channel — shown whenever participants are added; the broadcast
                  channel is independent of the call's own channel. */}
              {showPostCallUpdates && !participantsOnly && (
                <div className='space-y-4'>
                  <div className='flex items-center gap-1.5 w-full'>
                    <Checkbox
                      checked={postCallUpdates}
                      onChange={checked => {
                        setPostCallUpdates(checked);
                        if (!checked) {
                          setUpdateChannelId(null);
                          setChannelSearchQuery('');
                        }
                      }}
                      data-track-category='CALLS'
                      data-track-name='POST_UPDATES_TO_CHANNEL_TOGGLE'
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
                    <div className='w-full space-y-1'>
                      <div className='flex w-full items-center gap-2'>
                        {selectedChannelItem && (
                          <div className='flex max-w-[45%] min-w-0 shrink-0 items-center gap-1 rounded-lg border border-border bg-card px-2 h-8 text-sm'>
                            <span className='shrink-0'>{selectedChannelItem.leftSlot}</span>
                            <span className='flex-1 truncate text-foreground'>
                              {selectedChannelItem.label}
                            </span>
                            <button
                              type='button'
                              onClick={() => {
                                setUpdateChannelId(null);
                                setChannelSearchQuery('');
                                setChannelPickerOpen(true);
                                requestAnimationFrame(() => channelInputRef.current?.focus());
                              }}
                              className='ml-0.5 shrink-0 rounded p-0.5 text-foreground hover:bg-muted'
                              aria-label={`Remove ${selectedChannelItem.label}`}
                              data-track-category='CALLS'
                              data-track-name='remove-post-call-channel'
                            >
                              <X className='size-3' />
                            </button>
                          </div>
                        )}
                        <div className='min-w-0 flex-1'>
                          <Combobox
                            ref={channelInputRef}
                            items={channelComboboxItems}
                            value={selectedChannelItem}
                            queryString={channelSearchQuery}
                            placeholder={
                              selectedChannelItem ? 'Search to change channel' : 'Select channel'
                            }
                            onInputValueChange={setChannelSearchQuery}
                            onValueChange={value => {
                              setUpdateChannelId(value);
                              setChannelSearchQuery('');
                              setChannelPickerOpen(false);
                            }}
                            open={channelPickerOpen}
                            onOpenChange={setChannelPickerOpen}
                            onBlur={() => setChannelPickerOpen(false)}
                            autoHighlight
                          />
                        </div>
                      </div>
                      {updateChannelError && (
                        <p className='text-red-500 text-xs mt-1'>
                          Select a channel to post call updates.
                        </p>
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
        data-track-category='CALLS'
        data-track-name='SUBMIT_SCHEDULE_CALL'
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
        data-track-category='CALLS'
        data-track-name='CANCEL_SCHEDULE_CALL'
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
