import { ReactElement } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { useMutation } from '@tanstack/react-query';
import { Button } from '../../ui/Button/Button';
import Input from '../../ui/Input/Input';
import Textarea from '../../ui/Textarea/Textarea';
import { appsService, type CreateAppRequest } from '../../../services/Apps/appsService';
import { toast } from 'sonner';

interface CreateAppFormData {
  name: string;
  description: string;
}

export interface CreateAppFormProps {
  onSuccess?: () => void;
  onCancel?: () => void;
}

export const CreateAppForm = ({ onSuccess, onCancel }: CreateAppFormProps): ReactElement => {
  const {
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CreateAppFormData>({
    defaultValues: {
      name: '',
      description: '',
    },
    mode: 'onChange',
  });

  const createAppMutation = useMutation({
    mutationFn: async (data: CreateAppRequest) => {
      return appsService.createApp(data);
    },
    onSuccess: () => {
      toast.success('App created successfully');
      reset();
      onSuccess?.();
    },
    onError: (error: Error) => {
      toast.error('Failed to create app', {
        description: error.message,
      });
    },
  });

  const onSubmit = (formData: CreateAppFormData) => {
    const requestData: CreateAppRequest = {
      name: formData.name.trim(),
    };
    const trimmedDesc = formData.description.trim();
    if (trimmedDesc) {
      (requestData as CreateAppRequest & { description: string }).description = trimmedDesc;
    }
    createAppMutation.mutate(requestData);
  };

  return (
    <form onSubmit={e => void handleSubmit(onSubmit)(e)} className='flex flex-col max-h-[85vh]'>
      <div className='flex-1 overflow-y-auto p-6 space-y-6'>
        {createAppMutation.error && (
          <div className='bg-destructive/10 border border-destructive/30 text-destructive px-4 py-3 rounded-lg'>
            {createAppMutation.error instanceof Error
              ? createAppMutation.error.message
              : 'Failed to create app'}
          </div>
        )}

        <div className='space-y-2'>
          <label htmlFor='name' className='block text-sm font-medium text-foreground'>
            App Name <span className='text-red-500'>*</span>
          </label>
          <Controller
            name='name'
            control={control}
            rules={{
              required: 'App name is required',
              minLength: {
                value: 1,
                message: 'App name cannot be empty',
              },
            }}
            render={({ field }) => (
              <Input
                id='name'
                placeholder='Enter app name'
                disabled={createAppMutation.isPending}
                {...field}
              />
            )}
          />
          {errors.name && <p className='text-xs text-red-600'>{errors.name.message}</p>}
        </div>

        <div className='space-y-2'>
          <label htmlFor='description' className='block text-sm font-medium text-foreground'>
            Description
          </label>
          <Controller
            name='description'
            control={control}
            render={({ field }) => (
              <Textarea
                id='description'
                className='text-foreground'
                placeholder='Enter app description (optional)'
                rows={3}
                disabled={createAppMutation.isPending}
                {...field}
              />
            )}
          />
        </div>
      </div>

      <div className='flex gap-2 justify-end p-6 border-t border-border bg-background'>
        <Button
          variant='outline'
          onClick={onCancel}
          data-track-category='Apps'
          data-track-name='CANCEL_CREATE_APP'
          disabled={createAppMutation.isPending}
          type='button'
        >
          Cancel
        </Button>
        <Button
          type='submit'
          disabled={createAppMutation.isPending}
          data-track-category='Apps'
          data-track-name='CreateApp'
        >
          {createAppMutation.isPending ? 'Creating...' : 'Create App'}
        </Button>
      </div>
    </form>
  );
};

export default CreateAppForm;
