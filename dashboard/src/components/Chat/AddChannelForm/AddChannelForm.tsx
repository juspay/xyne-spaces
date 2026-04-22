import React, { useState, useEffect, ReactElement, useMemo } from 'react';
import { useForm } from '@tanstack/react-form';
import { useStore } from '@tanstack/react-store';
import { useQuery } from '@tanstack/react-query';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/Select';
import { Hash, Lock } from 'lucide-react';

import { Button } from '../../ui/Button';
import {
  channelService,
  CreateChannelFormData,
  PromoteGroupDmRequest,
} from '../../../services/Chat/channelService';
import Input from '../../ui/Input';
import Textarea from '../../ui/Textarea';
import RadioGroup, { Radio } from '../../ui/RadioGroup';
import { Badge } from '../../ui/Badge';
import { queries } from '../../../zero/queries';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { cn } from '../../../utils/classNames';
import { useOAuthProviders } from '../../../hooks/useOAuthProviders';

type ChannelFormMode = 'create' | 'promote';
type ChannelFormData = CreateChannelFormData | PromoteGroupDmRequest;
type ConnectorType = 'google' | 'microsoft' | null;

interface AddChannelFormProps {
  mode?: ChannelFormMode;
  onSubmit: (
    data: ChannelFormData & { connector?: ConnectorType; channelType?: 'EMAIL' | undefined },
  ) => void;
  onCancel: () => void;
  loading?: boolean;
  title?: string;
  hideVisibility?: boolean;
  requireConnector?: boolean;
}

export const AddChannelForm: React.FC<AddChannelFormProps> = ({
  mode = 'create',
  onSubmit,
  loading,
  onCancel,
  title,
  hideVisibility = false,
  requireConnector = false,
}) => {
  const [debouncedChannelName, setDebouncedChannelName] = useState('');
  const [channelName, setChannelName] = useState('');
  const [tagString, setTagString] = useState('');
  const [selectedConnector, setSelectedConnector] = useState<ConnectorType>(null);
  const { data: oauthProviders } = useOAuthProviders();

  // Fetch all projects for selection
  const [projects] = useCachedQuery(queries.getAllProjects());

  // Memoized project options for dropdown
  const projectOptions = useMemo(
    () =>
      projects?.map(project => ({
        label: project.name,
        value: project.id,
      })) || [],
    [projects],
  );

  const orgName = 'default';

  const { data: duplicateCheck } = useQuery({
    queryKey: ['checkDuplicateChannel', debouncedChannelName, orgName],
    queryFn: () => channelService.checkDuplicateChannel(debouncedChannelName, orgName),
    enabled: Boolean(debouncedChannelName.trim() && orgName.trim()),
    staleTime: 0,
    retry: 1,
    refetchOnWindowFocus: false,
  });

  const form = useForm({
    defaultValues: {
      name: '',
      description: '',
      visibility: 'public' as 'public' | 'private',
      topicTags: [] as string[],
      projectId: '',
    } as CreateChannelFormData,
    onSubmit: ({ value }) => {
      // Prevent submission if channel name is duplicate
      if (duplicateCheck?.isDuplicate) {
        return;
      }
      // Prevent submission if connector is required but not selected
      if (requireConnector && !selectedConnector) {
        return;
      }
      if (mode === 'promote') {
        const promoteData: PromoteGroupDmRequest = {
          name: value.name,
          visibility: value.visibility,
          projectId: value.projectId,
          topicTags: value.topicTags,
        };
        if (value.description) {
          promoteData.description = value.description;
        }
        onSubmit?.(promoteData);
      } else {
        // When requireConnector is true, pass connector as channel type
        const channelType = requireConnector && selectedConnector ? 'EMAIL' : undefined;
        if (channelType) {
          onSubmit?.({ ...value, connector: selectedConnector, channelType });
        } else {
          onSubmit?.({ ...value, connector: selectedConnector });
        }
      }
    },
  });

  const visibility = useStore(form.store, state => state.values.visibility);

  // Auto-select first project if none selected
  useEffect(() => {
    if (!form.getFieldValue('projectId') && projects && projects.length > 0) {
      form.setFieldValue('projectId', projects[0]!.id);
    }
  }, [projects, form]);

  // Debounce the channel name for duplicate checking
  useEffect(() => {
    if (channelName.length > 2) {
      const timeoutId = setTimeout(() => {
        setDebouncedChannelName(channelName);
      }, 500);
      return (): void => clearTimeout(timeoutId);
    }
    return (): void => {};
  }, [channelName]);

  // Trigger validation when duplicate check result changes
  useEffect(() => {
    if (duplicateCheck !== undefined) {
      void form.validateField('name', 'change');
    }
  }, [duplicateCheck, form]);

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const value = e.target.value;
    // Convert spaces to hyphens, then remove special characters, keep only alphanumeric and hyphens
    const cleanValue = value
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '');
    form.setFieldValue('name', cleanValue);
    setChannelName(cleanValue);
  };

  const getCharacterCount = (): number => {
    const name = form.getFieldValue('name');
    return name ? name.length : 0;
  };

  const handleTagAdd = (tag: string): void => {
    const trimmedTag = tag.trim();
    if (!trimmedTag) return;

    const oldTags = form.getFieldValue('topicTags');
    // Prevent duplicate tags
    if (oldTags.includes(trimmedTag)) {
      setTagString('');
      return;
    }

    setTagString('');
    form.setFieldValue('topicTags', [...oldTags, trimmedTag]);
  };

  const handleTagRemove = (tagToRemove: string): void => {
    const tags = form.getFieldValue('topicTags');
    const newTags = tags.filter((tag: string) => tag !== tagToRemove);
    form.setFieldValue('topicTags', newTags);
  };

  const handleTagInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      handleTagAdd(tagString);
    }
  };

  const renderFormComponent = (): ReactElement => (
    <div className='space-y-6 w-full'>
      {title ? (
        <div className='text-xl font-medium text-foreground mb-1'>{title}</div>
      ) : (
        <div className='text-xl font-medium text-foreground mb-1'>
          {mode === 'promote' ? 'Promote to Channel' : 'Create a channel'}
        </div>
      )}

      {/* Connector Selection (for email channels) */}
      {requireConnector && (
        <div className='space-y-2'>
          <div className='text-sm font-medium text-foreground'>
            Email Provider <span className='text-muted-foreground'>*</span>
          </div>
          <div className='flex gap-3'>
            <button
              type='button'
              onClick={() => setSelectedConnector('google')}
              className={cn(
                'flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg border-2 transition-all',
                selectedConnector === 'google'
                  ? 'border-blue-500 bg-blue-50 text-blue-700'
                  : 'border-border hover:border-muted-foreground/50',
              )}
              data-track-category='ADD_CHANNEL_FORM'
              data-track-name='SELECT_GOOGLE_PROVIDER'
            >
              <svg className='w-5 h-5' viewBox='0 0 24 24' fill='currentColor'>
                <path d='M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z' />
                <path d='M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z' />
                <path d='M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z' />
                <path d='M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z' />
              </svg>
              <span className='font-medium'>Google</span>
            </button>
            {oauthProviders?.microsoft && (
              <button
                type='button'
                onClick={() => setSelectedConnector('microsoft')}
                className={cn(
                  'flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg border-2 transition-all',
                  selectedConnector === 'microsoft'
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-border hover:border-muted-foreground/50',
                )}
                data-track-category='ADD_CHANNEL_FORM'
                data-track-name='SELECT_MICROSOFT_PROVIDER'
              >
                <svg className='w-5 h-5' viewBox='0 0 21 21' fill='currentColor'>
                  <path d='M10 0H0v10h10V0zM21 0H11v10h10V0zM10 11H0v10h10V11zM21 11H11v10h10V11z' />
                </svg>
                <span className='font-medium'>Microsoft</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Channel Name */}
      <form.Field
        name='name'
        validators={{
          onChange: ({ value }) => {
            if (!value) return 'Channel name is required';
            if (value.length < 2) return 'Channel name must be at least 2 characters';
            if (value.length > 80) return 'Channel name must be 80 characters or less';
            if (duplicateCheck?.isDuplicate) return 'Channel name already exists';
            return undefined;
          },
        }}
      >
        {field => (
          <div className='space-y-1.5'>
            <label htmlFor='channel-name' className='text-sm font-medium text-foreground'>
              Channel Name <span className='text-muted-foreground'>*</span>
            </label>
            <div className='relative'>
              <div className='absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground'>
                {hideVisibility ? (
                  <Hash size={14} />
                ) : visibility === 'private' ? (
                  <Lock size={14} />
                ) : (
                  <Hash size={14} />
                )}
              </div>
              <Input
                id='channel-name'
                value={field.state.value}
                onChange={handleNameChange}
                placeholder='e.g. general, development, support'
                className='pl-8 pr-12 text-foreground'
                aria-invalid={field.state.meta.errors.length > 0}
                data-testid='channel-name-input'
                data-track-category='ADD_CHANNEL_FORM'
                data-track-name='EDIT_CHANNEL_NAME'
                data-track-metadata={JSON.stringify({ mode, channelName: field.state.value })}
              />
              <div className='absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground'>
                {getCharacterCount()}/80
              </div>
            </div>
            {field.state.meta.errors.length > 0 && field.state.meta.errors[0] && (
              <p className='text-sm text-destructive'>{field.state.meta.errors[0]}</p>
            )}
          </div>
        )}
      </form.Field>

      {/* Project Selection */}
      <form.Field
        name='projectId'
        validators={{
          onChange: ({ value }) => {
            if (!value?.trim()) return 'Project is required';
            return undefined;
          },
        }}
      >
        {field => (
          <div className='space-y-1.5'>
            <label htmlFor='project-select' className='text-sm font-medium text-foreground'>
              Project *
            </label>
            <Select
              value={field.state.value}
              onValueChange={selected => field.handleChange(selected)}
              disabled={projectOptions.length === 0}
            >
              <SelectTrigger id='project-select' className='w-full'>
                <SelectValue
                  placeholder={
                    projectOptions.length > 0 ? 'Select a project' : 'No projects available'
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {projectOptions.map(option => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {field.state.meta.errors.length > 0 && (
              <p className='text-sm text-destructive'>{field.state.meta.errors[0] as string}</p>
            )}
            {projectOptions.length === 0 && (
              <p className='text-sm text-status-pending mt-1'>
                No projects found. Please create a project first.
              </p>
            )}
          </div>
        )}
      </form.Field>

      {/* Description */}
      <form.Field name='description'>
        {field => (
          <div className='space-y-1.5'>
            <label htmlFor='channel-description' className='text-sm font-medium text-foreground'>
              Description (optional)
            </label>
            <Textarea
              id='channel-description'
              value={field.state.value}
              className='text-foreground'
              onChange={e => field.handleChange(e.target.value)}
              placeholder='What is this channel about?'
              rows={4}
              data-track-category='ADD_CHANNEL_FORM'
              data-track-name='Edit_Channel_Description'
            />
          </div>
        )}
      </form.Field>

      {/* Channel Visibility */}
      {!hideVisibility && (
        <form.Field name='visibility'>
          {field => (
            <div>
              <RadioGroup
                name='visibility'
                label='Channel Visibility'
                value={field.state.value}
                onChange={value => field.handleChange(value as 'public' | 'private')}
              >
                <Radio value='public' subtext='Anyone in the organization can view and join'>
                  Public
                </Radio>
                <Radio value='private' subtext='Only invited members can view and join'>
                  Private
                </Radio>
              </RadioGroup>
            </div>
          )}
        </form.Field>
      )}

      {/* Topic Tags */}
      <form.Field name='topicTags'>
        {field => (
          <div className='space-y-1.5'>
            <label htmlFor='topic-tags' className='text-sm font-medium text-foreground'>
              Topic Tags (optional)
            </label>
            {field.state.value.length > 0 && (
              <div className='flex flex-wrap gap-2'>
                {field.state.value.map((tag, index) => (
                  <Badge
                    key={index}
                    variant='secondary'
                    className='cursor-pointer hover:bg-secondary/80 transition-colors'
                    onClick={() => handleTagRemove(tag)}
                    data-track-category='ADD_CHANNEL_FORM'
                    data-track-name='Remove_Topic_Tag'
                    data-track-metadata={JSON.stringify({ tag })}
                  >
                    {tag}
                    <span className='ml-1 text-xs'>×</span>
                  </Badge>
                ))}
              </div>
            )}
            <Input
              id='topic-tags'
              type='text'
              className='text-foreground'
              value={tagString}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTagString(e.target.value)}
              onKeyDown={handleTagInputKeyDown}
              placeholder='Type a tag and press Enter or add comma'
              data-track-category='ADD_CHANNEL_FORM'
              data-track-name='Edit_Topic_Tag'
            />
            <p className='text-xs text-muted-foreground'>
              Add tags to help organize and discover this channel
            </p>
          </div>
        )}
      </form.Field>

      <div className='flex justify-end space-x-3 pt-4'>
        {onCancel && (
          <Button
            variant='outline'
            size='default'
            type='button'
            onClick={e => {
              e.preventDefault();
              onCancel();
            }}
            data-track-category='ADD_CHANNEL_FORM'
            data-track-name='Cancel_Create_Channel'
          >
            Cancel
          </Button>
        )}
        <Button
          variant='default'
          size='default'
          loading={loading || false}
          type='submit'
          disabled={requireConnector && !selectedConnector}
          className='bg-action-primary text-action-primary-foreground hover:bg-action-primary/90 disabled:opacity-50 disabled:cursor-not-allowed'
          data-testid='create-channel-button'
          data-track-category='ADD_CHANNEL_FORM'
          data-track-name='CREATE_CHANNEL_SUBMIT'
          data-track-metadata={JSON.stringify({ mode, channelName })}
        >
          {mode === 'promote' ? 'Promote to Channel' : 'Create Channel'}
        </Button>
      </div>
    </div>
  );

  return (
    <form
      onSubmit={e => {
        e.preventDefault();
        e.stopPropagation();
        void form.handleSubmit();
      }}
    >
      {renderFormComponent()}
    </form>
  );
};

export default AddChannelForm;
