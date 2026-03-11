import React, { useMemo, useCallback, useEffect } from 'react';
import { Button } from '../../ui/Button';
import Input from '../../ui/Input';
import { ChannelScopeType, UserStatus, ChannelVisibility } from '@xyne/shared';
import { useSelf } from '../../../hooks/useUsers';
import { useAllVisibleChannels } from '../../../hooks/useChannels';
import { callService } from '../../../services/Call/callService';
import { cn } from '../../../utils/classNames';
import Dialog from '../../ui/Dialog';
import { Hash, Lock, X } from 'lucide-react';
import { DatePicker } from '../../ui/DatePicker/DatePicker';
import { TimePicker } from '../../ui/TimePicker/TimePicker';
import { SearchParticipants } from '../../../routes/CallHistoryScreen/SearchParticipants';
import { useUserSearch } from '../../../hooks/useUsers';
import Avatar from '../../ui/Avatar/Avatar';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';

interface ScheduleCallModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface ScheduleCallFormData {
  title: string;
  startsAt: Date;
  endsAt: Date;
  participants: string[];
}

export const ScheduleCallModal: React.FC<ScheduleCallModalProps> = ({ isOpen, onClose }) => {
  const user = useSelf();
  const allVisibleChannels = useAllVisibleChannels();

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

  // Filter for DEFAULT public channels only (not DMs)
  const channels = useMemo(() => {
    return allVisibleChannels.filter(channel => channel.scopeType === ChannelScopeType.DEFAULT);
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
      title: user?.name ? `${user.name.split(' ')[0]}'s Call` : '',
      startsAt: defaultStart,
      endsAt: new Date(defaultStart.getTime() + 60 * 60 * 1000), // Default 1 hours after start time
      participants: [],
    },
    mode: 'onChange',
  });

  // Watch form values for dependent logic
  const title = watch('title');
  const startsAt = watch('startsAt');
  const endsAt = watch('endsAt');
  const participants = watch('participants');

  // Search query state (not in form)
  const [searchQuery, setSearchQuery] = React.useState('');
  const users = useUserSearch(searchQuery, 15);

  useEffect(() => {
    if (user?.name) {
      const firstName = user.name.split(' ')[0];
      reset({
        title: `${firstName}'s Call`,
        startsAt: defaultStart,
        endsAt: new Date(defaultStart.getTime() + 60 * 60 * 1000),
        participants: [],
      });
    }
  }, [user?.name, reset]);

  // Build participant options
  const inviteUserOrChannelOptions = useMemo(() => {
    const userOptions =
      users
        .filter(u => u.id !== user?.id) // filter the current user from the list
        .map(user => ({
          ...user,
          label: user.name ?? user.email,
          value: `user:${user.id}`,
          icon: (
            <Avatar
              userId={user.id}
              size={'sm'}
              showActiveStatus={false}
              className='rounded-md size-[18px] flex items-center justify-center bg-white'
            />
          ),
          children: (
            <div className='flex items-center gap-2'>
              <Avatar
                userId={user.id}
                size={'sm'}
                showActiveStatus={false}
                className='rounded-md size-[18px] flex items-center justify-center bg-white'
              />
              <div className='flex-1 w-full flex items-center gap-1.5'>
                <span className='text-sm'>{user.name.split(' ')[0]}</span>
                {user.status === UserStatus.ACTIVE ? (
                  <span className='w-[5px] h-[5px] bg-green-600 rounded-full'></span>
                ) : (
                  <span className='w-[5px] h-[5px] border border-gray-500 rounded-full'></span>
                )}
                <span className='text-sm text-gray-500'>{user.name}</span>
              </div>
            </div>
          ),
          type: 'user' as const,
        })) || [];

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

    return [...userOptions, ...channelOptions].sort((a, b) => a.label.localeCompare(b.label));
  }, [users, channels, user?.id]);

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

  // Validate start and end times
  const validateTimes = useCallback(() => {
    const currentStartsAt = watch('startsAt');
    const currentEndsAt = watch('endsAt');
    const now = new Date();

    // Validate start time
    if (currentStartsAt && currentStartsAt <= now) {
      setError('startsAt', {
        type: 'manual',
        message: 'Start time must be in the future',
      });
    } else {
      clearErrors('startsAt');
    }

    // Validate end time
    if (currentStartsAt && currentEndsAt && currentEndsAt <= currentStartsAt) {
      setError('endsAt', {
        type: 'manual',
        message: 'End time must be after start time',
      });
    } else {
      clearErrors('endsAt');
    }
  }, [watch, setError, clearErrors]);

  const handleStartTimeChange = useCallback(
    (timeString: string): void => {
      const newStartsAt = parseTimeAndUpdateDate(timeString, startsAt);
      if (newStartsAt) {
        setValue('startsAt', newStartsAt, { shouldValidate: true });

        // Auto-adjust end time to be 1 hour after start time if end time is before start time
        if (endsAt && newStartsAt >= endsAt) {
          const newEndsAt = new Date(newStartsAt.getTime() + 60 * 60 * 1000);
          setValue('endsAt', newEndsAt, { shouldValidate: true });
        }

        setTimeout(() => validateTimes(), 0);
      }
    },
    [startsAt, endsAt, setValue, parseTimeAndUpdateDate, validateTimes],
  );

  const handleEndTimeChange = useCallback(
    (time: string): void => {
      const newEndsAt = parseTimeAndUpdateDate(time, endsAt);
      if (newEndsAt) {
        setValue('endsAt', newEndsAt, { shouldValidate: true });

        setTimeout(() => validateTimes(), 0);
      }
    },
    [endsAt, setValue, parseTimeAndUpdateDate, validateTimes],
  );

  const onSubmit = async (data: ScheduleCallFormData): Promise<void> => {
    if (!user?.id) {
      toast.error('User not found', {
        description: 'User not authenticated',
      });
      return;
    }

    try {
      const userIds: string[] = [];
      let channelId: string | undefined;

      data.participants.forEach(value => {
        if (value.startsWith('user:')) {
          userIds.push(value.replace('user:', ''));
        } else if (value.startsWith('channel:')) {
          channelId = value.replace('channel:', '');
        }
      });

      const requestData: {
        title: string;
        startsAt: number;
        endsAt: number;
        channelId?: string;
        targetUserIds?: string[];
      } = {
        title: data.title,
        startsAt: data.startsAt.getTime(),
        endsAt: data.endsAt.getTime(),
      };

      if (channelId) {
        requestData.channelId = channelId;
      }

      if (userIds.length > 0) {
        requestData.targetUserIds = userIds;
      }

      await callService.scheduleCall(requestData);

      toast.success('Call Scheduled', {
        description: 'Call scheduled successfully',
        duration: 3000,
      });

      handleClose();
    } catch {
      toast.error('Error scheduling call', {
        description: 'Failed to schedule call',
        duration: 3000,
      });
    }
  };

  // Reset form and close modal
  const handleClose = useCallback((): void => {
    reset({
      title: user?.name ? `${user.name.split(' ')[0]}'s Call` : '',
      startsAt: defaultStart,
      endsAt: new Date(defaultStart.getTime() + 60 * 60 * 1000),
      participants: [],
    });
    setSearchQuery('');
    onClose();
  }, [reset, onClose, user?.name]);

  return (
    <Dialog
      open={isOpen}
      onOpenChange={open => !open && handleClose()}
      className='max-w-[584px] rounded-xl overflow-hidden'
    >
      <form className='flex flex-col w-full' onSubmit={e => void handleSubmit(onSubmit)(e)}>
        {/* Header */}
        <div className='flex items-start justify-between px-5 py-3.5 border-b border-border '>
          <span>
            <h2 className='text-[15px] font-semibold text-foreground leading-5'>Schedule a Call</h2>
            <p className='text-sidebar-secondary-foreground text-[13px] font-medium leading-5'>
              Schedule call with people, groups or channel
            </p>
          </span>
          <Button
            variant='outline'
            size='icon'
            tabIndex={-1}
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
                required: 'Title is reqiured',
                maxLength: {
                  value: 80,
                  message: 'Title must be less than 80 characters',
                },
                validate: value => value.trim().length > 0 || 'Title cannot be empty',
              }}
            />
            {errors.title && <p className='text-red-500 text-xs mt-1'>{errors.title.message}</p>}
          </div>
          <div className='flex flex-col gap-3'>
            {/* Start Date and time */}
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
                      onSelect={date => field.onChange(date)}
                      placeholder='Select start date'
                      minDate={new Date(new Date().setHours(0, 0, 0, 0))}
                      inputClassName={cn(
                        'text-sm leading-5 bg-transparent !px-3 rounded-lg h-9 gap-2.5 w-full',
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
              {errors.startsAt && <p className='text-red-500 text-xs'>{errors.startsAt.message}</p>}
            </div>

            {/* End Date and time */}
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
                      onSelect={date => field.onChange(date)}
                      placeholder='Select start date'
                      minDate={startsAt ?? new Date(new Date().setHours(0, 0, 0, 0))}
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
                      placeholder='Select start time'
                      disabled={false}
                    />
                  )}
                />
              </div>
              {errors.endsAt && <p className='text-red-500 text-xs'>{errors.endsAt.message}</p>}
            </div>
          </div>

          {/* Participants Input */}
          <div className='space-y-2 -mb-3'>
            <p className='text-muted-foreground text-[13px] leading-5'>Participants</p>
            <Controller
              name='participants'
              control={control}
              render={({ field }) => (
                <SearchParticipants
                  options={inviteUserOrChannelOptions}
                  selectedValues={field.value}
                  onMultiSelect={field.onChange}
                  searchQuery={searchQuery}
                  setSearchQuery={setSearchQuery}
                />
              )}
              rules={{
                validate: value => value.length > 0 || 'At least one participant is required',
              }}
            />
            {errors.participants && (
              <p className='text-red-500 text-xs'>{errors.participants.message}</p>
            )}
          </div>

          {/* Submit and Cancel Buttons */}
          <div className='flex items-center justify-between pb-5'>
            <Button
              variant='outline'
              size='sm'
              className='rounded-lg text-[13px] px-4 h-9'
              onClick={handleClose}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              size='sm'
              type='submit'
              disabled={
                isSubmitting ||
                participants.length === 0 ||
                !title.trim() ||
                !!errors.startsAt ||
                !!errors.endsAt
              }
              className='rounded-lg text-[13px] px-4 h-9 text-white bg-primary hover:bg-primary hover:opacity-80 disabled:opacity-50 disabled:cursor-not-allowed'
            >
              {isSubmitting ? 'Scheduling...' : 'Schedule Call'}
            </Button>
          </div>
        </div>
      </form>
    </Dialog>
  );
};
