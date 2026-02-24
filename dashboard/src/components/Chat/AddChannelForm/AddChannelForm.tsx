import React, { useState, useEffect, ReactElement, useMemo } from 'react';
import { useForm } from '@tanstack/react-form';
import { useQuery } from '@tanstack/react-query';
import { SingleSelect } from '@juspay/blend-design-system';

import { Button } from '../../ui/Button';
import { cn } from '../../../utils/classNames';
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

type ChannelFormMode = 'create' | 'promote';
type ChannelFormData = CreateChannelFormData | PromoteGroupDmRequest;

interface AddChannelFormProps {
  mode?: ChannelFormMode;
  onSubmit: (data: ChannelFormData) => void;
  onCancel: () => void;
  loading?: boolean;
}

export const AddChannelForm: React.FC<AddChannelFormProps> = ({
  mode = 'create',
  onSubmit,
  loading,
  onCancel,
}) => {
  const [debouncedChannelName, setDebouncedChannelName] = useState('');
  const [channelName, setChannelName] = useState('');
  const [tagString, setTagString] = useState('');

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
        onSubmit?.(value);
      }
    },
  });

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
    <div className='space-y-6 max-w-md mx-auto bg-white'>
      <div className='text-xl font-medium text-foreground mb-1'>
        {mode === 'promote' ? 'Promote to Channel' : 'Create a channel'}
      </div>
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
            <label htmlFor='channel-name' className='text-sm font-medium text-gray-700'>
              Channel Name
            </label>
            <div className='relative'>
              <div className='absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm'>
                #
              </div>
              <Input
                id='channel-name'
                value={field.state.value}
                onChange={handleNameChange}
                placeholder='e.g. general, development, support'
                className={cn(
                  'pl-7 pr-12',
                  field.state.meta.errors.length > 0 &&
                    'aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive',
                )}
                aria-invalid={field.state.meta.errors.length > 0}
                data-testid='channel-name-input'
                data-track-category='ADD_CHANNEL_FORM'
                data-track-name='EDIT_CHANNEL_NAME'
                data-track-metadata={JSON.stringify({ mode, channelName: field.state.value })}
              />
              <div className='absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-500'>
                {getCharacterCount()}/80
              </div>
            </div>
            {field.state.meta.errors.length > 0 && field.state.meta.errors[0] && (
              <p className='text-sm text-red-600'>{field.state.meta.errors[0]}</p>
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
          <div>
            <SingleSelect
              label='Project *'
              placeholder={projectOptions.length > 0 ? 'Select a project' : 'No projects available'}
              items={[{ items: projectOptions }]}
              selected={field.state.value}
              onSelect={selected => field.handleChange(selected)}
            />
            {field.state.meta.errors.length > 0 && (
              <p className='text-sm text-red-500 mt-1'>{field.state.meta.errors[0] as string}</p>
            )}
            {projectOptions.length === 0 && (
              <p className='text-sm text-amber-600 mt-1'>
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
            <label htmlFor='channel-description' className='text-sm font-medium text-gray-700'>
              Description (optional)
            </label>
            <Textarea
              id='channel-description'
              value={field.state.value}
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

      {/* Topic Tags */}
      <form.Field name='topicTags'>
        {field => (
          <div className='space-y-1.5'>
            <label htmlFor='topic-tags' className='text-sm font-medium text-gray-700'>
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
              value={tagString}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTagString(e.target.value)}
              onKeyDown={handleTagInputKeyDown}
              placeholder='Type a tag and press Enter or add comma'
              data-track-category='ADD_CHANNEL_FORM'
              data-track-name='Edit_Topic_Tag'
            />
            <p className='text-xs text-gray-500'>
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
          className='bg-blue-600 hover:bg-blue-700'
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
