import { useEffect, useState, type MutableRefObject } from 'react';
import { ChannelScopeType } from '@xyne/shared';
import type { UseFormReset, UseFormSetValue } from 'react-hook-form';
import { getUserDisplayName } from '../../../../utils/userDisplayName';
import type { EditCallData, ScheduleCallFormData, SeriesEndsType } from '../types';

interface VisibleChannel {
  id: string;
  scopeType: ChannelScopeType;
}

interface SeriesData {
  endsOn?: string | number | Date | null;
  recurrenceRule?: string | null;
}

type DisplayUser = Parameters<typeof getUserDisplayName>[0];

interface UseScheduleCallInitializationParams {
  allVisibleChannels: readonly VisibleChannel[];
  applyRRule: (rrule: string) => void;
  defaultStart: Date;
  editEntireSeries: boolean;
  initialCall: EditCallData | null | undefined;
  initialEndsAt: Date | null | undefined;
  initialParticipants: string[] | null | undefined;
  initialStartsAt: Date | null | undefined;
  initialTitle: string | undefined;
  isEditMode: boolean;
  isOpen: boolean;
  reset: UseFormReset<ScheduleCallFormData>;
  selectiveEditParticipantIdsRef: MutableRefObject<Set<string> | null>;
  selectiveExclusionsInitializedRef: MutableRefObject<boolean>;
  seriesData: SeriesData | null | undefined;
  setEditEntireSeries: (next: boolean) => void;
  setIsRecurring: (next: boolean) => void;
  setPostCallUpdates: (next: boolean) => void;
  setRecurringTimesFromDates: (start: Date, end: Date) => void;
  setSeriesEndsOn: (next: Date | null) => void;
  setSeriesEndsType: (next: SeriesEndsType) => void;
  setUpdateChannelId: (next: string | null) => void;
  setValue: UseFormSetValue<ScheduleCallFormData>;
  user: DisplayUser;
  validateTimes: (newStartsAt?: Date, newEndsAt?: Date) => void;
}

function isExplicitChannel(channel: VisibleChannel | null | undefined): boolean {
  return (
    !!channel &&
    channel.scopeType !== ChannelScopeType.DM &&
    channel.scopeType !== ChannelScopeType.GROUP_DM
  );
}

function getCallExternalEmails(initialCall: EditCallData): string[] {
  return initialCall.participants
    .filter(p => p.isExternal && p.email)
    .map(p => p.email!)
    .sort((a, b) => a.localeCompare(b));
}

function getCallParticipantValues(params: {
  initialCall: EditCallData;
  isExplicitChannel: boolean;
  userId: string | undefined;
}): string[] {
  const { initialCall, isExplicitChannel: hasExplicitChannel, userId } = params;
  return hasExplicitChannel
    ? [`channel:${initialCall.channelId}`]
    : initialCall.participants
        .filter(p => !p.isExternal && p.userId !== userId)
        .map(p => `user:${p.userId}`);
}

function seedSelectiveRefs(params: {
  initialCall: EditCallData;
  isExplicitChannel: boolean;
  selectiveEditParticipantIdsRef: MutableRefObject<Set<string> | null>;
  selectiveExclusionsInitializedRef: MutableRefObject<boolean>;
}): void {
  const {
    initialCall,
    isExplicitChannel: hasExplicitChannel,
    selectiveEditParticipantIdsRef,
    selectiveExclusionsInitializedRef,
  } = params;

  if (hasExplicitChannel) {
    selectiveEditParticipantIdsRef.current = new Set(
      initialCall.participants.filter(p => !p.isExternal).map(p => p.userId),
    );
    selectiveExclusionsInitializedRef.current = false;
  } else {
    selectiveEditParticipantIdsRef.current = null;
    selectiveExclusionsInitializedRef.current = true;
  }
}

export function useScheduleCallInitialization({
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
}: UseScheduleCallInitializationParams): void {
  const [initialized, setInitialized] = useState(false);
  const userId = user?.id;

  useEffect(() => {
    if (!isOpen) {
      setInitialized(false);
      return;
    }

    if (initialized) return;

    if (isEditMode && initialCall) {
      const callStart = new Date(initialCall.startsAt);
      const callEnd = new Date(initialCall.endsAt);
      const callChannel = initialCall.channelId
        ? allVisibleChannels.find(c => c.id === initialCall.channelId)
        : null;
      const hasExplicitChannel = isExplicitChannel(callChannel);
      const callUpdatesChannel = initialCall.callUpdatesChannel ?? null;

      seedSelectiveRefs({
        initialCall,
        isExplicitChannel: hasExplicitChannel,
        selectiveEditParticipantIdsRef,
        selectiveExclusionsInitializedRef,
      });

      reset({
        title: initialCall.title,
        startsAt: callStart,
        endsAt: callEnd,
        participants: getCallParticipantValues({
          initialCall,
          isExplicitChannel: hasExplicitChannel,
          userId,
        }),
        externalEmails: getCallExternalEmails(initialCall),
      });

      if (callUpdatesChannel) {
        setPostCallUpdates(true);
        setUpdateChannelId(callUpdatesChannel);
      } else {
        setPostCallUpdates(false);
        setUpdateChannelId(null);
      }

      setRecurringTimesFromDates(callStart, callEnd);
      setEditEntireSeries(false);
      setIsRecurring(!!initialCall.recurringSeriesId);
      validateTimes(callStart, callEnd);
      setInitialized(true);
      return;
    }

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
        externalEmails: [],
      });
      setRecurringTimesFromDates(start, end);
      validateTimes(start, end);
      setInitialized(true);
    }
  }, [
    allVisibleChannels,
    defaultStart,
    initialCall,
    initialEndsAt,
    initialParticipants,
    initialStartsAt,
    initialTitle,
    initialized,
    isEditMode,
    isOpen,
    reset,
    selectiveEditParticipantIdsRef,
    selectiveExclusionsInitializedRef,
    setEditEntireSeries,
    setIsRecurring,
    setPostCallUpdates,
    setRecurringTimesFromDates,
    setUpdateChannelId,
    user,
    userId,
    validateTimes,
  ]);

  useEffect(() => {
    if (!seriesData) return;

    setIsRecurring(true);

    if (editEntireSeries && seriesData.endsOn) {
      setSeriesEndsOn(new Date(seriesData.endsOn));
      setSeriesEndsType('on');
    }

    if (seriesData.recurrenceRule) {
      applyRRule(seriesData.recurrenceRule);
    }
  }, [
    applyRRule,
    editEntireSeries,
    seriesData,
    setIsRecurring,
    setSeriesEndsOn,
    setSeriesEndsType,
  ]);

  useEffect(() => {
    if (editEntireSeries || !isEditMode || !initialCall) return;

    const callStart = new Date(initialCall.startsAt);
    const callEnd = new Date(initialCall.endsAt);
    const callChannel = initialCall.channelId
      ? allVisibleChannels.find(c => c.id === initialCall.channelId)
      : null;
    const hasExplicitChannel = isExplicitChannel(callChannel);

    seedSelectiveRefs({
      initialCall,
      isExplicitChannel: hasExplicitChannel,
      selectiveEditParticipantIdsRef,
      selectiveExclusionsInitializedRef,
    });

    setValue('startsAt', callStart);
    setValue('endsAt', callEnd);
    setValue(
      'participants',
      getCallParticipantValues({
        initialCall,
        isExplicitChannel: hasExplicitChannel,
        userId,
      }),
    );
    setValue('externalEmails', getCallExternalEmails(initialCall));
    setRecurringTimesFromDates(callStart, callEnd);
  }, [
    allVisibleChannels,
    editEntireSeries,
    initialCall,
    isEditMode,
    selectiveEditParticipantIdsRef,
    selectiveExclusionsInitializedRef,
    setRecurringTimesFromDates,
    setValue,
    userId,
  ]);
}
