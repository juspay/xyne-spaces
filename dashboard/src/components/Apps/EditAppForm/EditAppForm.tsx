import { ReactElement, useMemo, useEffect, useRef } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { Button } from '../../ui/Button/Button';
import Input from '../../ui/Input/Input';
import Textarea from '../../ui/Textarea/Textarea';
import type { InstalledApps } from '@xyne/shared';
import { Upload } from 'lucide-react';
import { toast } from 'sonner';

interface EditAppFormData {
  description: string;
  webhookUrl: string;
}

export interface EditAppFormProps {
  appId: string;
  appName: string;
  appDescription: string | null;
  appInstallations?: readonly InstalledApps[] | undefined;
  onSave: (data: { description: string; webhookUrl: string }) => Promise<void>;
  onUploadPicture?: ((appId: string, file: File) => Promise<void>) | undefined;
  isLoading?: boolean | undefined;
  onCancel?: (() => void) | undefined;
}

export const EditAppForm = ({
  appId,
  appName,
  appDescription,
  appInstallations,
  onSave,
  onUploadPicture,
  isLoading = false,
  onCancel,
}: EditAppFormProps): ReactElement => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const {
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<EditAppFormData>({
    defaultValues: {
      description: appDescription || '',
      webhookUrl: '',
    },
    mode: 'onChange',
  });

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!onUploadPicture) {
      toast.error('Upload not available');
      return;
    }

    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      toast.error('Invalid file type. Only JPG, PNG, and WebP are allowed.');
      return;
    }

    const maxSize = 5 * 1024 * 1024;
    if (file.size > maxSize) {
      toast.error('File too large. Maximum size is 5MB.');
      return;
    }

    try {
      await onUploadPicture(appId, file);
      toast.success('Profile picture uploaded successfully');
    } catch (error) {
      toast.error('Failed to upload profile picture', {
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleUploadClick = (): void => {
    fileInputRef.current?.click();
  };

  const webhookUrlValue = useMemo(() => {
    const installations = appInstallations || [];
    const firstInstallation = installations[0];
    return firstInstallation?.webhookUrl || '';
  }, [appInstallations]);

  const isAppInstalled = useMemo(() => {
    const installations = appInstallations || [];
    return installations.length > 0;
  }, [appInstallations]);

  useEffect(() => {
    reset({
      description: appDescription || '',
      webhookUrl: webhookUrlValue,
    });
  }, [appDescription, webhookUrlValue, reset]);

  const onSubmit = async (formData: EditAppFormData) => {
    await onSave({
      description: formData.description.trim(),
      webhookUrl: formData.webhookUrl.trim(),
    });
  };

  return (
    <form
      onSubmit={e => {
        e.preventDefault();
        void handleSubmit(onSubmit)(e);
      }}
      className='flex flex-col max-h-[85vh]'
    >
      <div className='flex-1 overflow-y-auto p-6 space-y-6'>
        <div className='space-y-2'>
          <label htmlFor='appName' className='block text-md font-medium text-foreground'>
            App Name
          </label>
          <Input
            id='appName'
            type='text'
            value={appName}
            disabled={true}
            className='bg-muted text-foreground'
          />
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
                placeholder='Enter app description (optional)'
                rows={3}
                disabled={isLoading}
                className='text-foreground'
                {...field}
              />
            )}
          />
          {errors.description && (
            <p className='text-xs text-destructive'>{errors.description.message}</p>
          )}
        </div>

        <div className='space-y-2'>
          <label htmlFor='webhookUrl' className='block text-sm font-medium text-foreground'>
            Webhook URL
          </label>
          {!isAppInstalled ? (
            <div className='bg-amber-500/10 border border-amber-500/30 text-amber-600 px-3 py-2 rounded-md text-sm'>
              Install app to add webhook URL
            </div>
          ) : (
            <Controller
              name='webhookUrl'
              control={control}
              rules={{
                validate: value => {
                  if (!value || value.trim() === '') return true;
                  try {
                    new URL(value);
                    return true;
                  } catch {
                    return 'Please enter a valid URL';
                  }
                },
              }}
              render={({ field }) => (
                <Input
                  id='webhookUrl'
                  type='url'
                  placeholder='https://your-app.com/webhook'
                  disabled={isLoading}
                  className='text-foreground'
                  {...field}
                />
              )}
            />
          )}
          {errors.webhookUrl && (
            <p className='text-xs text-destructive'>{errors.webhookUrl.message}</p>
          )}
        </div>

        <div className='space-y-2'>
          <label htmlFor='profilePicture' className='block text-sm font-medium text-foreground'>
            Profile Picture
          </label>
          <div className='flex gap-2'>
            <input
              type='file'
              ref={fileInputRef}
              onChange={e => void handleFileSelect(e)}
              accept='image/jpeg,image/png,image/webp'
              className='hidden'
            />
            <Button
              type='button'
              variant='outline'
              size='sm'
              onClick={handleUploadClick}
              disabled={isLoading}
              className='gap-1'
              title='Upload bot profile picture'
            >
              <Upload size={14} />
              Upload Picture
            </Button>
          </div>
          <p className='text-xs text-muted-foreground'>
            Supported formats: JPG, PNG, WebP. Max size: 5MB.
          </p>
        </div>
      </div>

      <div className='flex gap-2 justify-end p-6 border-t border-border bg-background'>
        <Button variant='outline' onClick={onCancel} disabled={isLoading} type='button'>
          Cancel
        </Button>
        <Button
          type='submit'
          disabled={isLoading}
          data-track-category='Apps'
          data-track-name='EditApp'
        >
          {isLoading ? 'Saving...' : 'Save Changes'}
        </Button>
      </div>
    </form>
  );
};

export default EditAppForm;
