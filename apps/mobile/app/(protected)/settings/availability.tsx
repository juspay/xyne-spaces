import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Fragment, useCallback, useMemo, useState, type ReactElement } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from '@/src/components/ui/safe-area-view';
import { Stack, useRouter } from 'expo-router';
import { Calendar, Check, Clock, PauseCircle, PlayCircle } from 'lucide-react-native';
import { HeaderBackButton } from '@/src/components/ui/header-icon-button';
import { useCSSVariable } from 'uniwind';
import { v4 as uuidv4 } from 'uuid';

import { haptics } from '@/src/utils/haptics';
import { useAuth } from '@/src/contexts/AuthContext';
import { useQuery } from '@/src/hooks/useQuery';
import { useUser } from '@/src/hooks/useUsers';
import { useZero } from '@/src/hooks/useZero';
import {
  assignmentAvailabilityErrorMessage,
  toggleAssignmentAvailability,
} from '@/src/services/assignmentAvailabilityService';
import { mutators } from '@/src/zero/mutators';
import { queries } from '@/src/zero/queries';
import { showMessageToast } from '@/src/utils/toast';

import { CustomField } from './components/custom-field';
import {
  formatDate,
  formatDateTime,
  formatTime,
  initialCustomTime,
  mergeDatePart,
  mergeTimePart,
  PAUSE_OPTIONS,
  pauseUntilForOption,
  resolveAssignmentUnavailableUntil,
  type PauseOptionId,
  type PickerMode,
} from './utils';

export default function AssignmentAvailabilityScreen(): ReactElement {
  const router = useRouter();
  const zero = useZero();
  const { user: authUser } = useAuth();
  const userId = authUser?.user_id ?? '';
  const user = useUser(userId);
  const [usersWithPresence] = useQuery(queries.getUsers());
  const [assignmentStates, assignmentStatesDetails] = useQuery(
    queries.getUserAssignmentStatesByUserId({ userId }),
  );
  const [selectedOption, setSelectedOption] = useState<PauseOptionId>('today');
  const [customDateTime, setCustomDateTime] = useState<Date>(() => initialCustomTime());
  const [pickerMode, setPickerMode] = useState<PickerMode>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const bg = useCSSVariable('--color-settings-bg') as string;
  const sectionBg = useCSSVariable('--color-settings-section-bg') as string;
  const divider = useCSSVariable('--color-settings-row-divider') as string;
  const labelColor = useCSSVariable('--color-settings-label') as string;
  const descriptionColor = useCSSVariable('--color-settings-description') as string;
  const blue = useCSSVariable('--color-settings-icon-blue') as string;

  const userWithPresence = useMemo(
    () => usersWithPresence.find(candidate => candidate.id === userId),
    [usersWithPresence, userId],
  );
  const unavailableUntil = resolveAssignmentUnavailableUntil(
    user?.assignmentUnavailableUntil,
    userWithPresence?.assignmentUnavailableUntil,
    userWithPresence?.presenceStatus?.assignmentUnavailableUntil,
  );
  const isPaused = Boolean(unavailableUntil && unavailableUntil > Date.now());
  const hasAssignmentStates = assignmentStates.length > 0;
  const isActiveInAtLeastOneGroup = useMemo(
    () => assignmentStates.some(state => state.onCall || state.isActiveForAssignment),
    [assignmentStates],
  );
  const showPauseControls = isPaused || isActiveInAtLeastOneGroup;
  const isLoading = assignmentStatesDetails.type === 'unknown';
  const pickerValue = customDateTime.getTime() > Date.now() ? customDateTime : initialCustomTime();

  const updateAssignmentUnavailableUntil = useCallback(
    (nextUnavailableUntil: number | null): void => {
      zero.mutate(
        mutators.userPresence.upsert({
          assignmentUnavailableUntil: nextUnavailableUntil,
          timestamp: Date.now(),
          presenceId: uuidv4(),
        }),
      );
    },
    [zero],
  );

  const handlePickerChange = useCallback(
    (event: DateTimePickerEvent, selectedDate?: Date): void => {
      if (Platform.OS === 'android') {
        setPickerMode(null);
      }
      if (event.type !== 'set' || !selectedDate || !pickerMode) return;

      setCustomDateTime(current =>
        pickerMode === 'date'
          ? mergeDatePart(current, selectedDate)
          : mergeTimePart(current, selectedDate),
      );
    },
    [pickerMode],
  );

  const pauseAssignment = useCallback(async (): Promise<void> => {
    const unavailableUntilMs = pauseUntilForOption(selectedOption, customDateTime);
    if (unavailableUntilMs <= Date.now()) {
      void haptics.warning();
      Alert.alert('Choose a future time', 'Choose a future return time.');
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await toggleAssignmentAvailability({
        isUnavailable: true,
        unavailableUntil: unavailableUntilMs,
      });
      updateAssignmentUnavailableUntil(response.unavailableUntil ?? unavailableUntilMs);
      showMessageToast('Ticket assignment paused', 'success');
    } catch (error) {
      void haptics.error();
      Alert.alert('Availability update failed', assignmentAvailabilityErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  }, [customDateTime, selectedOption, updateAssignmentUnavailableUntil]);

  const resumeAssignment = useCallback(async (): Promise<void> => {
    setIsSubmitting(true);
    try {
      await toggleAssignmentAvailability({ isUnavailable: false });
      updateAssignmentUnavailableUntil(null);
      showMessageToast('Ticket assignment resumed', 'success');
    } catch (error) {
      void haptics.error();
      Alert.alert('Availability update failed', assignmentAvailabilityErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  }, [updateAssignmentUnavailableUntil]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: bg }} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false, contentStyle: { backgroundColor: bg } }} />
      <View
        className='min-h-14 flex-row items-center gap-2 border-b px-2'
        style={{ borderColor: divider }}
      >
        <HeaderBackButton liquidGlass onPress={() => router.back()} iconColor={labelColor} />
        <Text className='flex-1 text-[20px] font-semibold' style={{ color: labelColor }}>
          Availability
        </Text>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 28, paddingTop: 20 }}
      >
        <View className='rounded-2xl p-4' style={{ backgroundColor: sectionBg }}>
          <View className='flex-row items-start gap-3'>
            <View className='h-10 w-10 items-center justify-center rounded-full bg-settings-icon-blue/15'>
              {isPaused ? (
                <PauseCircle size={22} color={blue} />
              ) : (
                <PlayCircle size={22} color={blue} />
              )}
            </View>
            <View className='min-w-0 flex-1'>
              <Text className='text-[18px] font-semibold' style={{ color: labelColor }}>
                {isPaused ? 'Paused from ticket assignment' : 'Ticket assignment'}
              </Text>
              <Text className='mt-1 text-[14px] leading-5' style={{ color: descriptionColor }}>
                {isPaused && unavailableUntil
                  ? `Until ${formatDateTime(unavailableUntil)}`
                  : 'Control whether assignment groups can auto-assign tickets to you.'}
              </Text>
            </View>
          </View>
        </View>

        {isLoading ? (
          <View className='mt-8 items-center justify-center py-8'>
            <ActivityIndicator />
          </View>
        ) : !showPauseControls ? (
          <View className='mt-4 rounded-2xl p-4' style={{ backgroundColor: sectionBg }}>
            <Text className='text-[16px] font-medium' style={{ color: labelColor }}>
              You are not part of any assignment groups.
            </Text>
            {hasAssignmentStates ? (
              <Text className='mt-1 text-[13px] leading-5' style={{ color: descriptionColor }}>
                Your assignment states are currently inactive.
              </Text>
            ) : null}
          </View>
        ) : isPaused ? (
          <Pressable
            disabled={isSubmitting}
            onPress={() => {
              void resumeAssignment();
            }}
            accessibilityRole='button'
            accessibilityLabel='Resume ticket assignment'
            className='mt-5 h-12 items-center justify-center rounded-xl bg-action-primary active:opacity-80 disabled:opacity-60'
          >
            {isSubmitting ? (
              <ActivityIndicator color='#fff' />
            ) : (
              <Text className='text-[16px] font-semibold text-white'>Resume assignment</Text>
            )}
          </Pressable>
        ) : (
          <>
            <Text className='px-1 pb-2 pt-6 text-[13px] font-semibold uppercase tracking-wide text-settings-description'>
              Pause until
            </Text>
            <View className='overflow-hidden rounded-2xl' style={{ backgroundColor: sectionBg }}>
              {PAUSE_OPTIONS.map((option, index) => {
                const selected = selectedOption === option.id;
                return (
                  <Fragment key={option.id}>
                    <Pressable
                      onPress={() => {
                        setSelectedOption(option.id);
                        if (option.id !== 'custom') setPickerMode(null);
                      }}
                      accessibilityRole='radio'
                      accessibilityState={{ checked: selected }}
                      accessibilityLabel={option.label}
                      android_ripple={{ color: divider }}
                      style={({ pressed }) => ({ opacity: pressed ? 0.58 : 1 })}
                    >
                      <View className='min-h-[64px] flex-row items-center gap-3 px-4 py-3'>
                        <View className='h-9 w-9 items-center justify-center rounded-full bg-background/60'>
                          {option.id === 'custom' ? (
                            <Calendar size={18} color={labelColor} />
                          ) : (
                            <Clock size={18} color={labelColor} />
                          )}
                        </View>
                        <View className='min-w-0 flex-1'>
                          <Text className='text-[17px]' style={{ color: labelColor }}>
                            {option.label}
                          </Text>
                          <Text className='mt-0.5 text-[13px]' style={{ color: descriptionColor }}>
                            {option.description}
                          </Text>
                        </View>
                        {selected ? <Check size={22} color={blue} strokeWidth={2.7} /> : null}
                      </View>
                    </Pressable>
                    {index < PAUSE_OPTIONS.length - 1 ? (
                      <View className='ml-[64px] h-px' style={{ backgroundColor: divider }} />
                    ) : null}
                  </Fragment>
                );
              })}
            </View>

            {selectedOption === 'custom' ? (
              <View className='mt-4'>
                <View
                  className='overflow-hidden rounded-2xl'
                  style={{ backgroundColor: sectionBg }}
                >
                  <CustomField
                    icon={<Calendar size={18} color={labelColor} />}
                    label='Date'
                    value={formatDate(customDateTime)}
                    isActive={pickerMode === 'date'}
                    onPress={() => setPickerMode(current => (current === 'date' ? null : 'date'))}
                  />
                  <CustomField
                    icon={<Clock size={18} color={labelColor} />}
                    label='Time'
                    value={formatTime(customDateTime)}
                    isActive={pickerMode === 'time'}
                    onPress={() => setPickerMode(current => (current === 'time' ? null : 'time'))}
                  />
                </View>

                {pickerMode ? (
                  <View
                    className='mt-3 overflow-hidden rounded-2xl'
                    style={{ backgroundColor: sectionBg }}
                  >
                    <DateTimePicker
                      value={pickerValue}
                      mode={pickerMode}
                      display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                      {...(pickerMode === 'date' ? { minimumDate: new Date() } : {})}
                      onChange={handlePickerChange}
                      {...(blue ? { accentColor: blue } : {})}
                    />
                    {Platform.OS === 'ios' ? (
                      <Pressable
                        accessibilityRole='button'
                        accessibilityLabel='Done selecting availability time'
                        onPress={() => setPickerMode(null)}
                        className='items-center border-t border-foreground/10 py-3 active:opacity-70'
                      >
                        <View className='flex-row items-center gap-1.5'>
                          <Check size={16} color={labelColor} strokeWidth={2.5} />
                          <Text className='text-[15px] font-medium' style={{ color: labelColor }}>
                            Done
                          </Text>
                        </View>
                      </Pressable>
                    ) : null}
                  </View>
                ) : null}
              </View>
            ) : null}

            <Pressable
              disabled={isSubmitting}
              onPress={() => {
                void pauseAssignment();
              }}
              accessibilityRole='button'
              accessibilityLabel='Pause ticket assignment'
              className='mt-5 h-12 items-center justify-center rounded-xl bg-action-primary active:opacity-80 disabled:opacity-60'
            >
              {isSubmitting ? (
                <ActivityIndicator color='#fff' />
              ) : (
                <Text className='text-[16px] font-semibold text-white'>Pause assignment</Text>
              )}
            </Pressable>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
