import { memo, useState, type ReactElement } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Cake, Calendar, Check, Edit2, X, type LucideIcon } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';
import { v4 as uuidv4 } from 'uuid';

import { cn } from '@/src/utils/cn';
import { haptics } from '@/src/utils/haptics';
import {
  ListRow,
  ListRowDivider,
  SectionCard,
  SectionLabel,
} from '@/src/components/ui/settings-list';
import { useZero } from '@/src/hooks/useZero';
import { mutators } from '@/src/zero/mutators';
import { useBubbleAccent } from '@/src/theme/useBubbleAccent';

import { useUserProfile } from './user-profile-context';
import { formatDate, formatRelativeYears } from './utils/formatters';

type DatesProps = {
  className?: string;
};

type DateRowProps = {
  icon: LucideIcon;
  label: string;
  value: string;
};

const DateRow = ({ icon, label, value }: DateRowProps): ReactElement => {
  const labelColor = useCSSVariable('--color-settings-label') as string;
  return (
    <ListRow icon={icon} label={label}>
      <Text className='text-sm' style={{ color: labelColor }}>
        {value}
      </Text>
    </ListRow>
  );
};

const toDateInputValue = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const dateFromInputValue = (value: string): Date | null => {
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return null;

  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return date;
};

const Dates = memo(({ className }: DatesProps): ReactElement | null => {
  const { accentText } = useBubbleAccent();
  const { profile, isOwnProfile } = useUserProfile();
  const zero = useZero();
  const mutedIconColor = useCSSVariable('--color-muted') as string;
  const primaryColor = useCSSVariable('--color-action-primary') as string;
  const [isEditingDob, setIsEditingDob] = useState(false);
  const [isDobPickerOpen, setIsDobPickerOpen] = useState(false);
  const [dobValue, setDobValue] = useState('');
  const [dobError, setDobError] = useState<string | null>(null);

  const hasJoined = Boolean(profile?.joinedOn);
  const hasDob = Boolean(profile?.dob);
  const parsedDobValue = dateFromInputValue(dobValue);

  if (!hasJoined && !hasDob && !isOwnProfile) return null;

  const startEditingDob = (): void => {
    setDobValue(profile?.dob ? toDateInputValue(new Date(profile.dob)) : '');
    setDobError(null);
    setIsEditingDob(true);
    setIsDobPickerOpen(true);
  };

  const cancelEditingDob = (): void => {
    setIsEditingDob(false);
    setIsDobPickerOpen(false);
    setDobValue('');
    setDobError(null);
  };

  const saveDob = async (): Promise<void> => {
    const trimmedValue = dobValue.trim();
    if (!trimmedValue) {
      setDobError('Please select a birth date');
      return;
    }

    const selectedDate = dateFromInputValue(trimmedValue);
    if (!selectedDate) {
      setDobError('Please select a valid birth date');
      return;
    }

    const today = new Date();
    let age = today.getFullYear() - selectedDate.getFullYear();
    const monthDifference = today.getMonth() - selectedDate.getMonth();
    if (
      monthDifference < 0 ||
      (monthDifference === 0 && today.getDate() < selectedDate.getDate())
    ) {
      age--;
    }

    if (selectedDate > today) {
      setDobError('Date of birth cannot be in the future');
      return;
    }
    if (age < 1 || age > 100) {
      setDobError('Please enter a valid date of birth (age 1-100)');
      return;
    }

    setDobError(null);
    try {
      const result = await zero.mutate(
        mutators.userProfile.upsert({
          dob: selectedDate.getTime(),
          timestamp: Date.now(),
          profileId: profile?.id ?? uuidv4(),
        }),
      ).server;
      if (result.type === 'error') throw new Error(result.error.message);
      cancelEditingDob();
    } catch {
      setDobError('Failed to save. Please try again.');
    }
  };

  const handleDobChange = (event: DateTimePickerEvent, selectedDate?: Date): void => {
    if (Platform.OS === 'android') setIsDobPickerOpen(false);
    if (event.type !== 'set' || !selectedDate) return;
    setDobValue(toDateInputValue(selectedDate));
    setDobError(null);
  };

  if (!hasJoined && !hasDob && !isOwnProfile) return null;

  return (
    <View className={cn(className)}>
      <SectionLabel>Dates</SectionLabel>
      <SectionCard>
        {hasJoined ? (
          <DateRow
            icon={Calendar}
            label='Start Date'
            value={`${formatDate(profile?.joinedOn)} ${formatRelativeYears(profile?.joinedOn)}`.trim()}
          />
        ) : null}

        {hasDob || isOwnProfile ? (
          <>
            {hasJoined ? <ListRowDivider /> : null}
            <ListRow icon={Cake} label='Birth Date'>
              <View>
                {isEditingDob && isOwnProfile ? (
                  <View className='mt-1'>
                    <View className='flex-row items-center gap-2'>
                      <Pressable
                        className='flex-1 flex-row items-center justify-between rounded-lg border border-settings-row-divider bg-settings-bg px-2.5 py-2'
                        onPress={() => {
                          void haptics.buttonTap();
                          setIsDobPickerOpen(true);
                        }}
                        accessibilityRole='button'
                        accessibilityLabel='Open birth date calendar'
                      >
                        <Text
                          className={
                            parsedDobValue ? 'text-sm text-foreground' : 'text-sm text-muted'
                          }
                        >
                          {parsedDobValue
                            ? formatDate(parsedDobValue.getTime())
                            : 'Select birth date'}
                        </Text>
                        <Calendar size={16} color={mutedIconColor} />
                      </Pressable>
                      <Pressable
                        onPress={() => {
                          void haptics.success();
                          void saveDob();
                        }}
                        className='p-2 active:opacity-60'
                        accessibilityRole='button'
                        accessibilityLabel='Save birth date'
                      >
                        <Check size={17} color={primaryColor} />
                      </Pressable>
                      <Pressable
                        onPress={() => {
                          void haptics.buttonTap();
                          cancelEditingDob();
                        }}
                        className='p-2 active:opacity-60'
                        accessibilityRole='button'
                        accessibilityLabel='Cancel editing'
                      >
                        <X size={17} color={mutedIconColor} />
                      </Pressable>
                    </View>

                    {isDobPickerOpen ? (
                      <DateTimePicker
                        value={parsedDobValue ?? new Date()}
                        mode='date'
                        display={Platform.OS === 'ios' ? 'spinner' : 'calendar'}
                        maximumDate={new Date()}
                        minimumDate={new Date(new Date().getFullYear() - 100, 0, 1)}
                        onChange={handleDobChange}
                        accentColor={primaryColor}
                      />
                    ) : null}
                    {dobError ? (
                      <Text className='mt-1 text-xs text-red-600'>{dobError}</Text>
                    ) : null}
                  </View>
                ) : hasDob ? (
                  <View className='mt-1 flex-row items-center gap-2'>
                    <Text className='flex-1 text-sm text-foreground'>
                      {formatDate(profile?.dob)}
                    </Text>
                    {isOwnProfile ? (
                      <Pressable
                        onPress={() => {
                          void haptics.buttonTap();
                          startEditingDob();
                        }}
                        className='p-1 active:opacity-60'
                        accessibilityRole='button'
                        accessibilityLabel='Edit birth date'
                      >
                        <Edit2 size={14} color={mutedIconColor} />
                      </Pressable>
                    ) : null}
                  </View>
                ) : (
                  <Pressable
                    onPress={() => {
                      void haptics.buttonTap();
                      startEditingDob();
                    }}
                    className='self-start py-1 active:opacity-60'
                    accessibilityRole='button'
                    accessibilityLabel='Add birth date'
                  >
                    <Text className='text-sm' style={{ color: accentText }}>
                      + Add Birth Date
                    </Text>
                  </Pressable>
                )}
              </View>
            </ListRow>
          </>
        ) : null}
      </SectionCard>
    </View>
  );
});
Dates.displayName = 'UserProfile.Dates';

export { Dates };
