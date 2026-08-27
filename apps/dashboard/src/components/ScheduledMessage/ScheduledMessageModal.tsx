import { logger, Event as LogEvent } from '../../utils/logger';
import { ReactElement, useEffect, useMemo, useRef, useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { Dialog } from '../ui/Dialog/Dialog';
import { Button } from '../ui/Button/Button';
import Input from '../ui/Input/Input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/Select/Select';
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
  dayMode: 'weekday' | 'custom';
  daysOfWeek: string[];
  scheduledTime: string;
  isActive: boolean;
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
      dayMode: 'weekday',
      daysOfWeek: ['1', '2', '3', '4', '5'],
      scheduledTime: '09:00',
      isActive: true,
    },
  });

  const dayMode = watch('dayMode');
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

      const isWeekday = scheduledMessage.daysOfWeek === '1,2,3,4,5';
      const daysArray = scheduledMessage.daysOfWeek.split(',');

      reset({
        channelId: scheduledMessage.channelId,
        title: scheduledMessage.title,
        messageContent: scheduledMessage.messageContent,
        messageContentHtml: scheduledMessage.messageContent,
        dayMode: isWeekday ? 'weekday' : 'custom',
        daysOfWeek: daysArray,
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
        dayMode: 'weekday',
        daysOfWeek: ['1', '2', '3', '4', '5'],
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

      // Join daysOfWeek array to comma-separated string
      const daysOfWeek = formValues.daysOfWeek.sort((a, b) => Number(a) - Number(b)).join(',');

      if (isEditMode && scheduledMessage) {
        const payload: UpdateScheduledMessagePayload = {
          title: formValues.title,
          messageContent: formValues.messageContentHtml,
          daysOfWeek,
          scheduledTime,
          isActive: formValues.isActive,
        };
        await scheduledMessageApi.update(scheduledMessage.id, payload);
        toast.success('Scheduled message updated successfully');
      } else {
        const payload: CreateScheduledMessagePayload = {
          channelId: formValues.channelId,
          title: formValues.title,
          messageContent: formValues.messageContentHtml,
          daysOfWeek,
          scheduledTime,
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
    { value: '0', label: 'Sunday' },
    { value: '1', label: 'Monday' },
    { value: '2', label: 'Tuesday' },
    { value: '3', label: 'Wednesday' },
    { value: '4', label: 'Thursday' },
    { value: '5', label: 'Friday' },
    { value: '6', label: 'Saturday' },
  ];

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

          {/* Day Selection */}
          <div>
            <span className='block text-sm text-foreground font-medium mb-2'>Days</span>

            {/* Weekday vs Custom Radio Buttons */}
            <Controller
              name='dayMode'
              control={control}
              render={({ field }) => (
                <div className='space-y-2 mb-3'>
                  <label className='flex items-center gap-2 cursor-pointer'>
                    <input
                      type='radio'
                      value='weekday'
                      checked={field.value === 'weekday'}
                      onChange={e => {
                        field.onChange(e.target.value);
                        setValue('daysOfWeek', ['1', '2', '3', '4', '5']);
                      }}
                      disabled={!canEdit && isEditMode}
                      data-track-category='scheduled-message'
                      data-track-name='select-weekday-mode'
                      className='w-4 h-4 text-primary focus:ring-2 focus:ring-primary cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed'
                    />
                    <span className='text-foreground text-sm'>Weekday (Monday - Friday)</span>
                  </label>
                  <label className='flex items-center gap-2 cursor-pointer'>
                    <input
                      type='radio'
                      value='custom'
                      checked={field.value === 'custom'}
                      onChange={e => {
                        field.onChange(e.target.value);
                        const currentDays = watch('daysOfWeek');
                        if (
                          currentDays.length === 5 &&
                          currentDays.every(d => ['1', '2', '3', '4', '5'].includes(d))
                        ) {
                          setValue('daysOfWeek', []);
                        }
                      }}
                      disabled={!canEdit && isEditMode}
                      data-track-category='scheduled-message'
                      data-track-name='select-custom-mode'
                      className='w-4 h-4 text-primary focus:ring-2 focus:ring-primary cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed'
                    />
                    <span className='text-foreground text-sm'>Custom days of the week</span>
                  </label>
                </div>
              )}
            />

            {/* Custom Day Checkboxes - only show for custom mode */}
            {dayMode === 'custom' && (
              <Controller
                name='daysOfWeek'
                control={control}
                rules={{
                  validate: value =>
                    dayMode === 'custom' && value.length === 0 ? 'Select at least one day' : true,
                }}
                render={({ field }) => (
                  <div className='space-y-2 pl-6'>
                    {dayOptions.map(day => (
                      <label
                        key={day.value}
                        htmlFor={`day-${day.value}`}
                        className='flex items-center gap-2 cursor-pointer'
                      >
                        <input
                          id={`day-${day.value}`}
                          type='checkbox'
                          checked={field.value.includes(day.value)}
                          onChange={e => {
                            const newValue = e.target.checked
                              ? [...field.value, day.value]
                              : field.value.filter(v => v !== day.value);
                            field.onChange(newValue);
                          }}
                          disabled={!canEdit && isEditMode}
                          data-track-category='scheduled-message'
                          data-track-name={`toggle-day-${day.value}`}
                          className='w-4 h-4 rounded border-gray-300 text-primary focus:ring-2 focus:ring-primary cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed'
                        />
                        <span className='text-sm text-foreground'>{day.label}</span>
                      </label>
                    ))}
                  </div>
                )}
              />
            )}
            {errors.daysOfWeek && (
              <p className='text-red-500 text-xs mt-1'>{errors.daysOfWeek.message}</p>
            )}
          </div>

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
