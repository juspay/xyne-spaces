import { logger, Event as LogEvent } from '../../utils/logger';
import { ReactElement, useEffect, useMemo, useRef, useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { Dialog } from '../ui/Dialog/Dialog';
import { Button } from '../ui/Button/Button';
import Input from '../ui/Input/Input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/Select/Select';
import { SegmentedToggle } from '../ui/SegmentedToggle';
import { cn } from '../../utils/classNames';
import { ChannelScopeType, ChannelVisibility } from '@xyne/shared';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { queries } from '../../zero/queries';
import { useBrowsableChannels, useChannelSearch } from '../../hooks/useChannels';
import { toast } from 'sonner';
import { InputBox } from '../ui/InputBox';
import type { InputBoxHandle } from '../../hooks/useDragAndDropAreaRef';
import { useMentionSearch } from '../../hooks/useMentionSearch';
import type { ScheduledMessage } from '../../services/scheduledMessageService';
import {
  scheduledMessageApi,
  type CreateScheduledMessagePayload,
  type UpdateScheduledMessagePayload,
  type SchedulePayloadFields,
} from '../../services/scheduledMessageService';

interface ScheduledMessageModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scheduledMessage?: ScheduledMessage;
  onSaved?: () => void;
}

interface FormValues {
  channelId: string;
  title: string;
  messageContent: string;
  messageContentHtml: string;
  frequency: 'WEEKLY' | 'MONTHLY';
  dayMode: 'weekday' | 'custom';
  daysOfWeek: string[];
  monthlyMode: 'DAY_OF_MONTH' | 'NTH_WEEKDAY' | 'LAST_DAY';
  dayOfMonth: string; // "1".."28"
  weekOrdinal: string; // "1".."4" | "LAST"
  weekday: string; // "0".."6"
  scheduledTime: string;
  isActive: boolean;
}

// Encode the form's monthly selection into the persisted shape: daysOfWeek "-" plus
// a mode and a packed integer (DAY_OF_MONTH: 1..28 or -1=last day; NTH_WEEKDAY:
// ordinal*10 + weekday, ordinal 1..4 or 5=last). The UI's "Last day" maps to
// DAY_OF_MONTH = -1.
function buildMonthlyFields(v: FormValues): SchedulePayloadFields {
  if (v.monthlyMode === 'LAST_DAY') {
    return { daysOfWeek: '-', monthlyMode: 'DAY_OF_MONTH', monthlyValue: -1 };
  }
  if (v.monthlyMode === 'NTH_WEEKDAY') {
    const ordinal = v.weekOrdinal === 'LAST' ? 5 : Number(v.weekOrdinal);
    return {
      daysOfWeek: '-',
      monthlyMode: 'NTH_WEEKDAY',
      monthlyValue: ordinal * 10 + Number(v.weekday),
    };
  }
  return { daysOfWeek: '-', monthlyMode: 'DAY_OF_MONTH', monthlyValue: Number(v.dayOfMonth) };
}

const ScheduledMessageModal = ({
  open,
  onOpenChange,
  scheduledMessage,
  onSaved,
}: ScheduledMessageModalProps): ReactElement => {
  const channels = useBrowsableChannels();
  const isEditMode = !!scheduledMessage;
  const inputBoxRef = useRef<InputBoxHandle>(null);

  // Channel mention search for # mentions in message content
  const [channelMentionQuery, setChannelMentionQuery] = useState('');
  const channelMentionResults = useChannelSearch(channelMentionQuery, 10);

  // Fetch my admin participations (query already filters by ADMIN role)
  const [myAdminParticipations] = useCachedQuery(queries.myChannelParticipations({}), {
    enabled: open,
  });

  // Filter channels: show only admin channels when creating
  const adminChannels = useMemo(() => {
    if (isEditMode) return channels;
    if (!myAdminParticipations) return [];

    const adminChannelIds = new Set(myAdminParticipations.map(p => p.channelId));
    return channels?.filter(ch => adminChannelIds.has(ch.id));
  }, [channels, myAdminParticipations, isEditMode]);

  const canEdit = scheduledMessage?.canEdit ?? false;

  const {
    control,
    handleSubmit: handleFormSubmit,
    watch,
    reset,
    setValue,
    formState: { errors },
  } = useForm<FormValues>({
    defaultValues: {
      channelId: '',
      title: '',
      messageContent: '',
      messageContentHtml: '',
      frequency: 'WEEKLY',
      dayMode: 'weekday',
      daysOfWeek: ['1', '2', '3', '4', '5'],
      monthlyMode: 'DAY_OF_MONTH',
      dayOfMonth: '1',
      weekOrdinal: '1',
      weekday: '1',
      scheduledTime: '09:00',
      isActive: true,
    },
  });

  const dayMode = watch('dayMode');
  const frequency = watch('frequency');
  const monthlyMode = watch('monthlyMode');
  const currentChannelId = watch('channelId');

  // Mention search for @ mentions in message content
  const { results: mentionResults, searchMentions } = useMentionSearch(currentChannelId);

  const channelMentionItems = useMemo(() => {
    if (!channelMentionResults || channelMentionResults.length === 0) return [];

    return channelMentionResults
      .filter(channel => channel.scopeType === ChannelScopeType.DEFAULT)
      .map(channel => ({
        id: channel.id,
        name: channel.name,
        isPrivate: channel.visibility === ChannelVisibility.PRIVATE,
        ...(channel.description && { description: channel.description }),
        hasAccess: true,
      }));
  }, [channelMentionResults]);

  const handleChannelMentionSearch = (query: string): void => {
    setChannelMentionQuery(query);
  };

  // Initialize form data when opening
  useEffect(() => {
    if (open && scheduledMessage) {
      // Convert stored UTC time back to local for display
      const [utcHH, utcMM] = scheduledMessage.scheduledTime.split(':').map(Number);
      const utcDate = new Date();
      utcDate.setUTCHours(utcHH ?? 0, utcMM ?? 0, 0, 0);

      const localTime = [
        String(utcDate.getHours()).padStart(2, '0'),
        String(utcDate.getMinutes()).padStart(2, '0'),
      ].join(':');

      // Monthly rows store daysOfWeek as "-"; weekly rows hold the day list.
      const isMonthly = scheduledMessage.daysOfWeek === '-';
      const isWeekday = scheduledMessage.daysOfWeek === '1,2,3,4,5';
      const daysArray =
        !isMonthly && scheduledMessage.daysOfWeek.length > 0
          ? scheduledMessage.daysOfWeek.split(',')
          : ['1', '2', '3', '4', '5'];

      // Decode the packed monthlyValue back into the UI's mode + fields.
      const mv = scheduledMessage.monthlyValue ?? 1;
      let uiMonthlyMode: FormValues['monthlyMode'] = 'DAY_OF_MONTH';
      let uiDayOfMonth = '1';
      let uiWeekOrdinal = '1';
      let uiWeekday = '1';
      if (isMonthly && scheduledMessage.monthlyMode === 'DAY_OF_MONTH') {
        if (mv === -1) {
          uiMonthlyMode = 'LAST_DAY';
        } else {
          uiDayOfMonth = String(mv);
        }
      } else if (isMonthly && scheduledMessage.monthlyMode === 'NTH_WEEKDAY') {
        uiMonthlyMode = 'NTH_WEEKDAY';
        const ordinal = Math.floor(mv / 10);
        uiWeekOrdinal = ordinal === 5 ? 'LAST' : String(ordinal);
        uiWeekday = String(mv % 10);
      }

      reset({
        channelId: scheduledMessage.channelId,
        title: scheduledMessage.title,
        messageContent: scheduledMessage.messageContent,
        messageContentHtml: scheduledMessage.messageContent,
        frequency: isMonthly ? 'MONTHLY' : 'WEEKLY',
        dayMode: isWeekday ? 'weekday' : 'custom',
        daysOfWeek: daysArray,
        monthlyMode: uiMonthlyMode,
        dayOfMonth: uiDayOfMonth,
        weekOrdinal: uiWeekOrdinal,
        weekday: uiWeekday,
        scheduledTime: localTime,
        isActive: scheduledMessage.isActive,
      });
      // Set InputBox content for editing
      setTimeout(() => {
        inputBoxRef.current?.insertContent(scheduledMessage.messageContent);
      }, 0);
    } else if (open && !scheduledMessage) {
      reset({
        channelId: '',
        title: '',
        messageContent: '',
        messageContentHtml: '',
        frequency: 'WEEKLY',
        dayMode: 'weekday',
        daysOfWeek: ['1', '2', '3', '4', '5'],
        monthlyMode: 'DAY_OF_MONTH',
        dayOfMonth: '1',
        weekOrdinal: '1',
        weekday: '1',
        scheduledTime: '09:00',
        isActive: true,
      });
      inputBoxRef.current?.clearContent();
    }
  }, [open, scheduledMessage, reset]);

  const [isSubmitting, setIsSubmitting] = useState(false);

  const onSubmit = async (formValues: FormValues): Promise<void> => {
    setIsSubmitting(true);
    try {
      // Convert local time to UTC for storage
      const [localHH, localMM] = formValues.scheduledTime.split(':').map(Number);
      const localDate = new Date();
      localDate.setHours(localHH ?? 0, localMM ?? 0, 0, 0);

      const utcHours = localDate.getUTCHours();
      const utcMinutes = localDate.getUTCMinutes();

      const scheduledTime = [
        String(utcHours).padStart(2, '0'),
        String(utcMinutes).padStart(2, '0'),
      ].join(':');

      // Build the recurrence fields from the chosen frequency.
      const scheduleFields: SchedulePayloadFields =
        formValues.frequency === 'MONTHLY'
          ? buildMonthlyFields(formValues)
          : { daysOfWeek: formValues.daysOfWeek.sort((a, b) => Number(a) - Number(b)).join(',') };

      if (isEditMode && scheduledMessage) {
        const payload: UpdateScheduledMessagePayload = {
          title: formValues.title,
          messageContent: formValues.messageContentHtml,
          scheduledTime,
          isActive: formValues.isActive,
          ...scheduleFields,
        };
        await scheduledMessageApi.update(scheduledMessage.id, payload);
        toast.success('Scheduled message updated successfully');
      } else {
        const payload: CreateScheduledMessagePayload = {
          channelId: formValues.channelId,
          title: formValues.title,
          messageContent: formValues.messageContentHtml,
          scheduledTime,
          ...scheduleFields,
        };
        await scheduledMessageApi.create(payload);
        toast.success('Scheduled message created successfully');
      }
      onSaved?.();
      onOpenChange(false);
    } catch (error) {
      const message =
        (error as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        'Failed to save scheduled message';
      toast.error(message);
      logger.error(LogEvent.FRONTEND_ERROR, {
        type: 'migrated_console_error',
        message: String('Error saving scheduled message:'),
        error: error,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (): Promise<void> => {
    if (!scheduledMessage) return;
    try {
      await scheduledMessageApi.delete(scheduledMessage.id);
      toast.success('Scheduled message deleted successfully');
      onSaved?.();
      onOpenChange(false);
    } catch (error) {
      const message =
        (error as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        'Failed to delete scheduled message';
      toast.error(message);
      logger.error(LogEvent.FRONTEND_ERROR, {
        type: 'migrated_console_error',
        message: String('Error deleting scheduled message:'),
        error: error,
      });
    }
  };

  const dayOptions = [
    { value: '0', label: 'Sunday', short: 'Su' },
    { value: '1', label: 'Monday', short: 'Mo' },
    { value: '2', label: 'Tuesday', short: 'Tu' },
    { value: '3', label: 'Wednesday', short: 'We' },
    { value: '4', label: 'Thursday', short: 'Th' },
    { value: '5', label: 'Friday', short: 'Fr' },
    { value: '6', label: 'Saturday', short: 'Sa' },
  ];

  const ordinalOptions = [
    { value: '1', label: 'First' },
    { value: '2', label: 'Second' },
    { value: '3', label: 'Third' },
    { value: '4', label: 'Fourth' },
    { value: 'LAST', label: 'Last' },
  ];

  // 1..28 only — every month has these days, so a monthly job always fires.
  const dayOfMonthOptions = Array.from({ length: 28 }, (_, i) => String(i + 1));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <div className='p-6'>
        <h2 className='text-xl font-bold text-foreground mb-4'>
          {isEditMode ? 'Edit Scheduled Message' : 'Create Scheduled Message'}
        </h2>
        <form
          onSubmit={e => {
            e.preventDefault();
            void handleFormSubmit(onSubmit)(e);
          }}
          className='space-y-4'
        >
          {/* Channel Selector - only for create mode */}
          {!isEditMode && (
            <div>
              <label
                htmlFor='channel-select'
                className='block text-foreground text-sm font-medium mb-1'
              >
                Channel
              </label>
              <Controller
                name='channelId'
                control={control}
                rules={{ required: 'Channel is required' }}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id='channel-select' className='w-full'>
                      <SelectValue placeholder='Select a channel' />
                    </SelectTrigger>
                    <SelectContent>
                      {adminChannels?.map(ch => (
                        <SelectItem key={ch.id} value={ch.id}>
                          {ch.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              {errors.channelId && (
                <p className='text-red-500 text-xs mt-1'>{errors.channelId.message}</p>
              )}
              <p className='text-xs text-muted-foreground mt-1'>
                Note: Only channels where you are an admin are shown.
              </p>
            </div>
          )}

          {/* Title */}
          <div>
            <label htmlFor='title-input' className='block text-foreground text-sm font-medium mb-1'>
              Title
            </label>
            <Controller
              name='title'
              control={control}
              rules={{
                required: 'Title is required',
                minLength: { value: 1, message: 'Title must be at least 1 character' },
                maxLength: { value: 100, message: 'Title must be at most 100 characters' },
              }}
              render={({ field }) => (
                <Input
                  id='title-input'
                  {...field}
                  placeholder='e.g., Daily Standup Message'
                  disabled={!canEdit && isEditMode}
                />
              )}
            />
            {errors.title && <p className='text-red-500 text-xs mt-1'>{errors.title.message}</p>}
          </div>

          {/* Message Content */}
          <div>
            <label
              htmlFor='message-inputbox'
              className='block text-foreground text-sm font-medium mb-1'
            >
              Message
            </label>
            <Controller
              name='messageContentHtml'
              control={control}
              rules={{
                required: 'Message is required',
                validate: () => {
                  const textContent = watch('messageContent');
                  if (!textContent || textContent.trim().length === 0) {
                    return 'Message is required';
                  }
                  if (textContent.length > 4000) {
                    return 'Message must be at most 4000 characters';
                  }
                  return true;
                },
              }}
              render={() => (
                <InputBox
                  ref={inputBoxRef}
                  id='message-inputbox'
                  placeholder='The message that will be posted to the channel'
                  onSendMessage={() => {
                    void handleFormSubmit(onSubmit)();
                  }}
                  onContentChange={(html: string, text: string) => {
                    setValue('messageContentHtml', html);
                    setValue('messageContent', text);
                  }}
                  mentionItems={mentionResults}
                  onMentionSearch={searchMentions}
                  channelItems={channelMentionItems}
                  onChannelSearch={handleChannelMentionSearch}
                  features={{
                    richText: true,
                    mentions: true,
                    commands: false,
                    fileAttachments: false,
                    emojiPicker: true,
                  }}
                  showTypingIndicator={false}
                  disabled={!canEdit && isEditMode}
                  disableEnterToSend={true}
                  hideSendButton
                />
              )}
            />
            {errors.messageContentHtml && (
              <p className='text-red-500 text-xs mt-1'>{errors.messageContentHtml.message}</p>
            )}
          </div>

          {/* Frequency */}
          <div>
            <span className='block text-sm text-foreground font-medium mb-2'>Frequency</span>
            <Controller
              name='frequency'
              control={control}
              render={({ field }) => (
                <SegmentedToggle<FormValues['frequency']>
                  value={field.value}
                  onChange={field.onChange}
                  className={!canEdit && isEditMode ? 'pointer-events-none opacity-50' : ''}
                  options={[
                    { value: 'WEEKLY', label: 'Weekly' },
                    { value: 'MONTHLY', label: 'Monthly' },
                  ]}
                />
              )}
            />
          </div>

          {/* Weekly: Day Selection */}
          {frequency === 'WEEKLY' && (
            <div>
              <span className='block text-sm text-foreground font-medium mb-2'>Days</span>

              {/* Weekday vs Custom */}
              <Controller
                name='dayMode'
                control={control}
                render={({ field }) => (
                  <SegmentedToggle<FormValues['dayMode']>
                    value={field.value}
                    onChange={value => {
                      field.onChange(value);
                      if (value === 'weekday') {
                        setValue('daysOfWeek', ['1', '2', '3', '4', '5']);
                      } else {
                        // Switching to custom: clear the preset weekday selection so the
                        // user starts from a blank slate (but keep any custom picks).
                        const currentDays = watch('daysOfWeek');
                        if (
                          currentDays.length === 5 &&
                          currentDays.every(d => ['1', '2', '3', '4', '5'].includes(d))
                        ) {
                          setValue('daysOfWeek', []);
                        }
                      }
                    }}
                    className={
                      !canEdit && isEditMode ? 'mb-3 pointer-events-none opacity-50' : 'mb-3'
                    }
                    options={[
                      { value: 'weekday', label: 'Weekdays', title: 'Monday – Friday' },
                      { value: 'custom', label: 'Custom days', title: 'Pick specific days' },
                    ]}
                  />
                )}
              />

              {/* Custom day pills - only show for custom mode */}
              {dayMode === 'custom' && (
                <Controller
                  name='daysOfWeek'
                  control={control}
                  rules={{
                    validate: value =>
                      dayMode === 'custom' && value.length === 0 ? 'Select at least one day' : true,
                  }}
                  render={({ field }) => (
                    <div
                      className={cn(
                        'flex flex-wrap gap-1.5',
                        !canEdit && isEditMode && 'pointer-events-none opacity-50',
                      )}
                    >
                      {dayOptions.map(day => {
                        const isActive = field.value.includes(day.value);
                        return (
                          <button
                            key={day.value}
                            type='button'
                            title={day.label}
                            aria-pressed={isActive}
                            onClick={() => {
                              const newValue = isActive
                                ? field.value.filter(v => v !== day.value)
                                : [...field.value, day.value];
                              field.onChange(newValue);
                            }}
                            data-track-category='scheduled-message'
                            data-track-name={`toggle-day-${day.value}`}
                            className={cn(
                              'flex h-9 w-9 items-center justify-center rounded-full border text-sm font-medium transition-colors',
                              isActive
                                ? 'border-transparent bg-action-primary text-action-primary-foreground'
                                : 'border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground',
                            )}
                          >
                            {day.short}
                          </button>
                        );
                      })}
                    </div>
                  )}
                />
              )}
              {errors.daysOfWeek && (
                <p className='text-red-500 text-xs mt-1'>{errors.daysOfWeek.message}</p>
              )}
            </div>
          )}

          {/* Monthly: Mode Selection */}
          {frequency === 'MONTHLY' && (
            <div>
              <span className='block text-sm text-foreground font-medium mb-2'>On</span>

              <Controller
                name='monthlyMode'
                control={control}
                render={({ field }) => (
                  <SegmentedToggle<FormValues['monthlyMode']>
                    value={field.value}
                    onChange={field.onChange}
                    className={
                      !canEdit && isEditMode ? 'mb-3 pointer-events-none opacity-50' : 'mb-3'
                    }
                    options={[
                      {
                        value: 'DAY_OF_MONTH',
                        label: 'Day of month',
                        title: 'A fixed day, e.g. the 15th',
                      },
                      { value: 'NTH_WEEKDAY', label: 'Weekday', title: 'e.g. the 2nd Tuesday' },
                      { value: 'LAST_DAY', label: 'Last day', title: 'Last day of the month' },
                    ]}
                  />
                )}
              />

              {/* Day of month: 1..28 */}
              {monthlyMode === 'DAY_OF_MONTH' && (
                <div className='pl-6'>
                  <Controller
                    name='dayOfMonth'
                    control={control}
                    render={({ field }) => (
                      <Select
                        value={field.value}
                        onValueChange={field.onChange}
                        disabled={!canEdit && isEditMode}
                      >
                        <SelectTrigger className='w-32'>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {dayOfMonthOptions.map(d => (
                            <SelectItem key={d} value={d}>
                              {d}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                  <p className='text-xs text-muted-foreground mt-1'>
                    Limited to 1–28 so the message always fires, even in February.
                  </p>
                </div>
              )}

              {/* Nth weekday: ordinal + weekday */}
              {monthlyMode === 'NTH_WEEKDAY' && (
                <div className='pl-6 flex gap-2'>
                  <Controller
                    name='weekOrdinal'
                    control={control}
                    render={({ field }) => (
                      <Select
                        value={field.value}
                        onValueChange={field.onChange}
                        disabled={!canEdit && isEditMode}
                      >
                        <SelectTrigger className='w-32'>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ordinalOptions.map(o => (
                            <SelectItem key={o.value} value={o.value}>
                              {o.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                  <Controller
                    name='weekday'
                    control={control}
                    render={({ field }) => (
                      <Select
                        value={field.value}
                        onValueChange={field.onChange}
                        disabled={!canEdit && isEditMode}
                      >
                        <SelectTrigger className='w-40'>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {dayOptions.map(d => (
                            <SelectItem key={d.value} value={d.value}>
                              {d.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                </div>
              )}
            </div>
          )}

          {/* Scheduled Time */}
          <div>
            <label
              htmlFor='scheduled-time-input'
              className='block text-foreground text-sm font-medium mb-1'
            >
              Time (Local)
            </label>
            <Controller
              name='scheduledTime'
              control={control}
              rules={{
                required: 'Time is required',
                pattern: {
                  value: /^\d{2}:\d{2}$/,
                  message: 'Time must be in HH:MM format',
                },
              }}
              render={({ field }) => (
                <Input
                  id='scheduled-time-input'
                  {...field}
                  type='time'
                  disabled={!canEdit && isEditMode}
                  className='text-foreground dark:[color-scheme:dark]'
                />
              )}
            />
            {errors.scheduledTime && (
              <p className='text-red-500 text-xs mt-1'>{errors.scheduledTime.message}</p>
            )}
            <p className='text-xs text-foreground mt-1'>Enter time in your local timezone</p>
          </div>

          {/* Active Toggle - only in edit mode */}
          {isEditMode && (
            <div className='flex items-center gap-2'>
              <Controller
                name='isActive'
                control={control}
                render={({ field }) => (
                  <input
                    type='checkbox'
                    id='active-toggle'
                    checked={!!field.value}
                    onChange={e => field.onChange(e.target.checked)}
                    disabled={!canEdit}
                    data-track-category='scheduled-message'
                    data-track-name='toggle-active'
                    className='w-4 h-4 rounded border-gray-300 text-primary focus:ring-2 focus:ring-primary cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed'
                  />
                )}
              />
              <label
                htmlFor='active-toggle'
                className='text-sm font-medium cursor-pointer select-none text-foreground'
              >
                Active
              </label>
            </div>
          )}

          {/* Actions */}
          <div className='flex justify-between pt-4'>
            <div>
              {isEditMode && canEdit && (
                <Button
                  type='button'
                  onClick={() => void handleDelete()}
                  data-track-category='scheduled-message'
                  data-track-name='DELETE_SCHEDULED_MESSAGE'
                >
                  Delete
                </Button>
              )}
            </div>
            <div className='flex gap-2'>
              <Button
                type='button'
                onClick={() => onOpenChange(false)}
                data-track-category='scheduled-message'
                data-track-name='CLOSE_SCHEDULED_MESSAGE_MODAL'
              >
                Cancel
              </Button>
              <Button type='submit' disabled={(!canEdit && isEditMode) || isSubmitting}>
                {isSubmitting ? 'Saving...' : isEditMode ? 'Save' : 'Create'}
              </Button>
            </div>
          </div>
        </form>
      </div>
    </Dialog>
  );
};

export default ScheduledMessageModal;
