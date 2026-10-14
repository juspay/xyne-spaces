import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { Keyboard, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  KeyboardAwareScrollView,
  type KeyboardAwareScrollViewRef,
} from 'react-native-keyboard-controller';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { Hash, Repeat } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';

import {
  ListRow,
  ListRowDivider,
  SectionCard,
  SectionFootnote,
} from '@/src/components/ui/settings-list';
import { Switch } from '@/src/components/ui/switch';
import { useBubbleAccent } from '@/src/theme/useBubbleAccent';
import { formatDate, formatTime } from '@/src/utils/timeSelection';

import { BottomAction } from '../components/BottomAction';
import { CollapsingHeader } from '../components/CollapsingHeader';
import { DateTimeRow } from '../components/DateTimeRow';
import { ExternalGuestsCard } from '../components/ExternalGuestsCard';
import { ChannelMembersSheet } from '../components/ChannelMembersSheet';
import { InternalUsersCard } from '../components/InternalUsersCard';
import { ChannelSheet } from '../components/ChannelSheet';
import { PeopleSheet } from '../components/PeopleSheet';
import { useScheduleCallForm } from '../hooks/useScheduleCallForm';
import { closeEditSession, getEditSession } from '../editSession';
import { closePickerSession, openPickerSession } from '../pickerSession';

const UNDERLINE_TIMING = { duration: 200 };

interface ScheduleCallScreenProps {
  onClose: () => void;
}

/** "Tue, 6 Oct · 4:00 – 5:00 pm", or both dates when the call crosses midnight. */
const timeRangeSummary = (start: Date, end: Date): string =>
  start.toDateString() === end.toDateString()
    ? `${formatDate(start)} · ${formatTime(start)} – ${formatTime(end)}`
    : `${formatDate(start)} ${formatTime(start)} – ${formatDate(end)} ${formatTime(end)}`;

export default function ScheduleCallScreen({ onClose }: ScheduleCallScreenProps): ReactElement {
  const router = useRouter();
  const [editCall] = useState(getEditSession);
  const isEditMode = editCall !== null;
  const form = useScheduleCallForm(editCall);
  const { postUpdates, selectRepeat, participants, setParticipants, guests, setGuests } = form;
  const placeholderColor = useCSSVariable('--color-settings-description') as string;

  // Written on the UI thread by the scroll handler; the header and the big title read it in their
  // animated styles, so scrolling causes no React re-render.
  const { accentBg } = useBubbleAccent();
  const titleFocus = useSharedValue(0);
  const titleUnderlineStyle = useAnimatedStyle(() => ({ opacity: titleFocus.get() }));
  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler(event => {
    scrollY.set(event.contentOffset.y);
  });
  const bigTitleStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.get(), [0, 70], [1, 0], Extrapolation.CLAMP),
  }));

  const channelRowHeight = useSharedValue(0);
  const channelRowOpen = useSharedValue(0);
  const channelRowStyle = useAnimatedStyle(() => ({
    height: channelRowHeight.get() * channelRowOpen.get(),
    opacity: channelRowOpen.get(),
  }));
  const postCallUpdatesOn = form.postUpdates.postCallUpdates;
  useEffect(() => {
    channelRowOpen.set(withTiming(postCallUpdatesOn ? 1 : 0, { duration: 260 }));
  }, [channelRowOpen, postCallUpdatesOn]);

  // After a guest is added, bring the whole External card (the field and every guest in the list)
  // to the top of the visible area, instead of leaving just the newest row in view.
  const scrollRef = useRef<KeyboardAwareScrollViewRef>(null);
  const externalCardY = useRef(0);
  const showGuestList = useCallback((): void => {
    setTimeout(() => {
      scrollRef.current?.scrollTo({ y: Math.max(externalCardY.current - 12, 0), animated: true });
    }, 0);
  }, []);

  // The picker screens read their starting value from this slot (see pickerSession.ts).
  useEffect(
    () => (): void => {
      closePickerSession();
      closeEditSession();
    },
    [],
  );

  const handleClose = useCallback((): void => {
    Keyboard.dismiss();
    onClose();
  }, [onClose]);

  const { submit } = form;
  const handleSubmit = useCallback(async (): Promise<void> => {
    Keyboard.dismiss();
    if (await submit()) onClose();
  }, [submit, onClose]);

  const openRepeatPicker = useCallback((): void => {
    openPickerSession({
      value: {
        selectedId: form.repeatOptionId,
        monthlyLabel: form.monthlyRepeatLabel,
        allowNone: !isEditMode,
      },
      onChange: selectRepeat,
    });
    router.push('/(protected)/schedule-call/repeat');
  }, [form.monthlyRepeatLabel, form.repeatOptionId, isEditMode, router, selectRepeat]);

  // A sheet exists only while it is open or closing: it mounts on open and unmounts once its close
  // animation ends, so a closed sheet holds no data subscriptions and nothing re-renders it. The
  // updater keeps a quick reopen from being unmounted by the previous close finishing.
  const [peopleSheet, setPeopleSheet] = useState<'unmounted' | 'open' | 'closed'>('unmounted');
  const openPeoplePicker = useCallback((): void => {
    Keyboard.dismiss();
    setPeopleSheet('open');
  }, []);
  const onPeopleOpenChange = useCallback((open: boolean): void => {
    setPeopleSheet(open ? 'open' : 'closed');
  }, []);
  const onPeopleClosed = useCallback((): void => {
    setPeopleSheet(state => (state === 'closed' ? 'unmounted' : state));
  }, []);

  const [membersSheet, setMembersSheet] = useState<'unmounted' | 'open' | 'closed'>('unmounted');
  const openMembersPicker = useCallback((): void => {
    Keyboard.dismiss();
    setMembersSheet('open');
  }, []);
  const onMembersOpenChange = useCallback((open: boolean): void => {
    setMembersSheet(open ? 'open' : 'closed');
  }, []);
  const onMembersClosed = useCallback((): void => {
    setMembersSheet(state => (state === 'closed' ? 'unmounted' : state));
  }, []);

  const { selectedChannel, selectChannel, setPostCallUpdates } = postUpdates;
  const [channelSheet, setChannelSheet] = useState<'unmounted' | 'open' | 'closed'>('unmounted');
  const openChannelPicker = useCallback((): void => {
    Keyboard.dismiss();
    setChannelSheet('open');
  }, []);
  const onChannelOpenChange = useCallback((open: boolean): void => {
    setChannelSheet(open ? 'open' : 'closed');
  }, []);
  const onChannelClosed = useCallback((): void => {
    setChannelSheet(state => (state === 'closed' ? 'unmounted' : state));
  }, []);

  /** Turning the toggle on opens the channel sheet when none is picked yet. */
  const togglePostUpdates = useCallback(
    (next: boolean): void => {
      setPostCallUpdates(next);
      if (next && !selectedChannel) openChannelPicker();
    },
    [openChannelPicker, selectedChannel, setPostCallUpdates],
  );

  return (
    <View className='flex-1 bg-settings-bg'>
      <CollapsingHeader
        scrollY={scrollY}
        title={form.title.trim() || (isEditMode ? 'Edit call' : 'Schedule a call')}
        subtitle={timeRangeSummary(form.startsAt, form.endsAt)}
        onBack={handleClose}
      />

      <KeyboardAwareScrollView
        ref={scrollRef}
        onScroll={onScroll}
        // Keeps the focused field well clear of the keyboard, so the guest row that appears under the
        // email field (and the new title error line) stays visible.
        bottomOffset={96}
        keyboardShouldPersistTaps='handled'
        keyboardDismissMode='on-drag'
        showsVerticalScrollIndicator={false}
        contentContainerClassName='px-4 pb-44'
      >
        <Animated.View className='p-1' style={bigTitleStyle}>
          <Text className='text-sm text-secondary-foreground'>
            {isEditMode ? 'Edit call details' : 'Schedule a call'}
          </Text>
          <TextInput
            value={form.title}
            onChangeText={form.setTitle}
            placeholder='Call title'
            placeholderTextColor={placeholderColor}
            accessibilityLabel='Call title'
            editable={!form.participantsOnly}
            returnKeyType='next'
            autoCorrect={true}
            spellCheck={true}
            autoComplete='off'
            importantForAutofill='no'
            cursorColor={accentBg}
            selectionColor={accentBg}
            onFocus={() => titleFocus.set(withTiming(1, UNDERLINE_TIMING))}
            onBlur={() => titleFocus.set(withTiming(0, UNDERLINE_TIMING))}
            className='px-0 py-0 text-[32px] font-bold text-foreground'
          />
          <Animated.View
            className=' h-0.5 rounded-full'
            style={[{ backgroundColor: accentBg }, titleUnderlineStyle]}
          />
          {form.titleError ? (
            <Text className='text-xs text-status-danger'>{form.titleError}</Text>
          ) : null}
        </Animated.View>

        {form.participantsOnly ? null : (
          <SectionCard className='mt-3'>
            <DateTimeRow
              label='Starts'
              value={form.startsAt}
              onDateChange={form.setStartDate}
              onTimeChange={form.setStartTime}
              error={form.startsAtError}
            />
            <ListRowDivider inset={0} />
            <DateTimeRow
              label='Ends'
              hint={form.durationLabel}
              value={form.endsAt}
              onDateChange={form.setEndDate}
              onTimeChange={form.setEndTime}
              error={form.endsAtError}
            />
            {isEditMode ? null : (
              <>
                <ListRowDivider inset={0} />
                <ListRow
                  icon={Repeat}
                  label='Repeat'
                  value={form.repeatLabel}
                  showChevron
                  onPress={openRepeatPicker}
                />
              </>
            )}
          </SectionCard>
        )}

        <InternalUsersCard
          participants={participants}
          onChange={setParticipants}
          onOpenPicker={openPeoplePicker}
          onOpenMembers={openMembersPicker}
          lockedUserIds={form.lockedUserIds}
        />
        {form.participantsOnly ? null : (
          <View
            onLayout={event => {
              externalCardY.current = event.nativeEvent.layout.y;
            }}
          >
            <ExternalGuestsCard guests={guests} onChange={setGuests} onAdded={showGuestList} />
          </View>
        )}

        {form.participantsOnly ? null : (
          <>
            <SectionCard className='mt-3'>
              <ListRow
                icon={Hash}
                label='Post updates to channel'
                trailing={
                  <Switch
                    isSelected={postUpdates.postCallUpdates}
                    onSelectedChange={togglePostUpdates}
                    accessibilityLabel='Post updates to channel'
                  />
                }
                onPress={(): void => togglePostUpdates(!postUpdates.postCallUpdates)}
              />
              {/* Grows down from nothing; the row is measured at its natural height. */}
              <Animated.View
                className='overflow-hidden'
                pointerEvents={postUpdates.postCallUpdates ? 'auto' : 'none'}
                style={channelRowStyle}
              >
                <View
                  className='absolute inset-x-0 top-0'
                  onLayout={e => channelRowHeight.set(e.nativeEvent.layout.height)}
                >
                  <ListRowDivider />
                  <ListRow
                    icon={Hash}
                    label='Channel'
                    value={selectedChannel?.name ?? 'Select'}
                    showChevron
                    onPress={openChannelPicker}
                  />
                </View>
              </Animated.View>
            </SectionCard>
            <SectionFootnote>
              {postUpdates.updateChannelError
                ? 'Select a channel to post call updates.'
                : 'Off by default. Turn on to post call start, end and recording links to one channel.'}
            </SectionFootnote>
          </>
        )}
      </KeyboardAwareScrollView>

      <BottomAction
        label={isEditMode ? 'Save changes' : 'Schedule call'}
        enabled={form.canSubmit}
        isSubmitting={form.isSubmitting}
        blockers={form.blockers}
        onPress={() => void handleSubmit()}
      />

      {peopleSheet === 'unmounted' ? null : (
        <PeopleSheet
          isOpen={peopleSheet === 'open'}
          onOpenChange={onPeopleOpenChange}
          onClosed={onPeopleClosed}
          participants={participants}
          onApply={setParticipants}
          lockedUserIds={form.lockedUserIds}
        />
      )}
      {membersSheet === 'unmounted' || !participants.channel ? null : (
        <ChannelMembersSheet
          isOpen={membersSheet === 'open'}
          onOpenChange={onMembersOpenChange}
          onClosed={onMembersClosed}
          channel={participants.channel}
          onApply={form.setExcludedMembers}
        />
      )}
      {channelSheet === 'unmounted' ? null : (
        <ChannelSheet
          isOpen={channelSheet === 'open'}
          onOpenChange={onChannelOpenChange}
          onClosed={onChannelClosed}
          selected={selectedChannel}
          onSelect={selectChannel}
        />
      )}
    </View>
  );
}
