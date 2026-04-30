import { type ReactElement, useMemo, useEffect, useRef, useState, useCallback } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { Button } from '../../ui/Button/Button';
import Input from '../../ui/Input/Input';
import Textarea from '../../ui/Textarea/Textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/Select';
import { Dialog } from '../../ui/Dialog/Dialog';
import type { InstalledApps } from '@xyne/shared';
import {
  Upload,
  Copy,
  Trash2,
  Plus,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Check,
  X,
  Lock,
} from 'lucide-react';
import { toast } from 'sonner';
import { copyTextToClipboard } from '../../../utils/clipboardUtils';
import {
  appsService,
  type BotChannel,
  type IncomingWebhook,
} from '../../../services/Apps/appsService';
import { APPS_PUBLIC_BASE_URL } from '../../../config';

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

const WEBHOOK_NAME_MAX_LENGTH = 84;

function WebhookNameInput({
  value,
  onChange,
  className,
  focusOnMount,
  onKeyDown,
  placeholder,
  id,
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  focusOnMount?: boolean;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  placeholder?: string;
  id?: string;
}): ReactElement {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (focusOnMount) inputRef.current?.focus();
  }, [focusOnMount]);
  return (
    <div className='relative'>
      <Input
        ref={inputRef}
        id={id}
        type='text'
        value={value}
        onChange={e => onChange(e.target.value.slice(0, WEBHOOK_NAME_MAX_LENGTH))}
        maxLength={WEBHOOK_NAME_MAX_LENGTH}
        className={`${className ?? ''} pr-12`}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
      />
      <span className='absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground pointer-events-none'>
        {value.length}/{WEBHOOK_NAME_MAX_LENGTH}
      </span>
    </div>
  );
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
  const [botChannels, setBotChannels] = useState<BotChannel[]>([]);
  const [webhooks, setWebhooks] = useState<IncomingWebhook[]>([]);
  const [webhookTotal, setWebhookTotal] = useState(0);
  const [webhookOffset, setWebhookOffset] = useState(0);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [webhookName, setWebhookName] = useState('');
  const [selectedChannelId, setSelectedChannelId] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [editingWebhookId, setEditingWebhookId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [revokeTargetId, setRevokeTargetId] = useState<string | null>(null);
  const WEBHOOK_PAGE_SIZE = 3;

  const installedAppId = appInstallations?.[0]?.id ?? null;

  useEffect(() => {
    if (!appId) return;
    void appsService
      .getBotChannels(appId)
      .then(setBotChannels)
      .catch(() => setBotChannels([]));
  }, [appId]);

  const fetchWebhooks = useCallback(
    (offset: number): void => {
      if (!installedAppId) return;
      void appsService
        .getIncomingWebhooks(installedAppId, { limit: WEBHOOK_PAGE_SIZE, offset })
        .then(data => {
          setWebhooks(data.webhooks);
          setWebhookTotal(data.total);
          setWebhookOffset(offset);
        })
        .catch(() => {
          setWebhooks([]);
          setWebhookTotal(0);
        });
    },
    [installedAppId],
  );

  useEffect(() => {
    fetchWebhooks(0);
  }, [fetchWebhooks]);

  const getFullWebhookUrl = (relativePath: string): string => {
    if (!relativePath) return '';
    const incomingWebhookPath = '/api/apps';
    const suffix = relativePath.startsWith(incomingWebhookPath)
      ? relativePath.slice(incomingWebhookPath.length)
      : relativePath;
    return `${APPS_PUBLIC_BASE_URL}${suffix}`;
  };

  const handleCreateWebhook = async (): Promise<void> => {
    if (!installedAppId || !selectedChannelId || !webhookName.trim()) return;

    setIsCreating(true);
    try {
      await appsService.createIncomingWebhook({
        installedAppId,
        channelId: selectedChannelId,
        name: webhookName.trim(),
      });
      setShowCreateForm(false);
      setWebhookName('');
      setSelectedChannelId('');
      toast.success('Incoming webhook created');
      fetchWebhooks(0);
    } catch (error) {
      toast.error('Failed to create webhook', {
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      setIsCreating(false);
    }
  };

  const handleRevokeWebhook = async (): Promise<void> => {
    if (!revokeTargetId) return;
    const targetId = revokeTargetId;
    setRevokeTargetId(null);
    try {
      await appsService.revokeIncomingWebhook(targetId);
      toast.success('Webhook revoked');
      fetchWebhooks(webhookOffset);
    } catch (error) {
      toast.error('Failed to revoke webhook', {
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  };

  const handleRenameWebhook = async (webhookId: string): Promise<void> => {
    const trimmed = editingName.trim();
    if (!trimmed) return;
    try {
      await appsService.updateIncomingWebhook(webhookId, { name: trimmed });
      setEditingWebhookId(null);
      setEditingName('');
      toast.success('Webhook renamed');
      fetchWebhooks(webhookOffset);
    } catch (error) {
      toast.error('Failed to rename webhook', {
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  };

  const handleCopyWebhookUrl = (webhookUrl: string): void => {
    const fullUrl = getFullWebhookUrl(webhookUrl);
    if (!fullUrl) return;
    void copyTextToClipboard(fullUrl);
    toast.success('Webhook URL copied to clipboard');
  };

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

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
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

  const onSubmit = async (formData: EditAppFormData): Promise<void> => {
    await onSave({
      description: formData.description.trim(),
      webhookUrl: formData.webhookUrl.trim(),
    });
  };

  const hasPrev = webhookOffset > 0;
  const hasNext = webhookOffset + WEBHOOK_PAGE_SIZE < webhookTotal;

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

        {isAppInstalled && (
          <div className='space-y-2'>
            <div className='border-t border-border pt-4'>
              <span className='block text-sm font-medium text-foreground'>Incoming Webhooks</span>
              <p className='text-xs text-muted-foreground mt-1'>
                Generate webhook URLs for external services to post messages as this bot. Compatible
                with Slack incoming webhooks.
              </p>
              {botChannels.length > 0 && !showCreateForm && (
                <Button
                  type='button'
                  variant='outline'
                  size='sm'
                  onClick={() => setShowCreateForm(true)}
                  className='gap-1 w-full mt-2'
                >
                  <Plus size={14} />
                  Create Incoming Webhook
                </Button>
              )}
            </div>

            {showCreateForm && botChannels.length > 0 && (
              <div className='border border-border rounded-md p-3 space-y-3'>
                <div className='space-y-2'>
                  <label
                    htmlFor='webhook-channel-select'
                    className='block text-xs font-medium text-foreground'
                  >
                    Channel
                  </label>
                  <Select
                    value={selectedChannelId}
                    onValueChange={channelId => {
                      setSelectedChannelId(channelId);
                      const channel = botChannels.find(c => c.id === channelId);
                      if (channel)
                        setWebhookName(`${channel.name}-ich`.slice(0, WEBHOOK_NAME_MAX_LENGTH));
                    }}
                  >
                    <SelectTrigger id='webhook-channel-select' className='w-full'>
                      <SelectValue placeholder='Select a channel' />
                    </SelectTrigger>
                    <SelectContent>
                      {botChannels.map(channel => (
                        <SelectItem key={channel.id} value={channel.id}>
                          <span className='inline-flex items-center gap-1'>
                            <span className='w-3.5 flex-shrink-0 flex items-center justify-center'>
                              {channel.visibility === 'PRIVATE' ? <Lock size={12} /> : '#'}
                            </span>
                            {channel.name}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className='space-y-1'>
                  <label
                    htmlFor='webhook-name-input'
                    className='block text-xs font-medium text-foreground'
                  >
                    Webhook Name
                  </label>
                  <WebhookNameInput
                    id='webhook-name-input'
                    value={webhookName}
                    onChange={setWebhookName}
                    placeholder='e.g., GitHub CI, Monitoring'
                    className='text-sm'
                  />
                </div>
                <div className='flex gap-2'>
                  <Button
                    type='button'
                    size='sm'
                    onClick={() => void handleCreateWebhook()}
                    disabled={isCreating || !webhookName.trim() || !selectedChannelId}
                  >
                    {isCreating ? 'Creating...' : 'Create'}
                  </Button>
                  <Button
                    type='button'
                    variant='ghost'
                    size='sm'
                    onClick={() => {
                      setShowCreateForm(false);
                      setWebhookName('');
                      setSelectedChannelId('');
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {botChannels.length === 0 && (
              <div className='bg-amber-500/10 border border-amber-500/30 text-amber-600 px-3 py-2 rounded-md text-sm dark:bg-amber-500/10 dark:text-amber-400'>
                Add the bot to a channel first to create incoming webhooks.
              </div>
            )}

            {webhooks.map(webhook => (
              <div key={webhook.id} className='border border-border rounded-md p-3 space-y-2'>
                {editingWebhookId === webhook.id ? (
                  <div className='flex items-center gap-1.5'>
                    <div className='flex-1 min-w-0'>
                      <WebhookNameInput
                        value={editingName}
                        onChange={setEditingName}
                        onKeyDown={e => {
                          if (e.key === 'Enter') void handleRenameWebhook(webhook.id);
                          if (e.key === 'Escape') {
                            setEditingWebhookId(null);
                            setEditingName('');
                          }
                        }}
                        className='text-sm h-7'
                        focusOnMount
                      />
                    </div>
                    <Button
                      type='button'
                      variant='ghost'
                      size='sm'
                      onClick={() => void handleRenameWebhook(webhook.id)}
                      disabled={!editingName.trim()}
                      className='h-7 w-7 p-0 flex-shrink-0 text-muted-foreground hover:text-foreground'
                      data-track-category='INCOMING_WEBHOOKS'
                      data-track-name='Confirm_Rename_Webhook'
                    >
                      <Check size={14} />
                    </Button>
                    <Button
                      type='button'
                      variant='ghost'
                      size='sm'
                      onClick={() => {
                        setEditingWebhookId(null);
                        setEditingName('');
                      }}
                      className='h-7 w-7 p-0 flex-shrink-0 text-muted-foreground hover:text-foreground'
                      data-track-category='INCOMING_WEBHOOKS'
                      data-track-name='Cancel_Rename_Webhook'
                    >
                      <X size={14} />
                    </Button>
                  </div>
                ) : (
                  <div className='flex items-center justify-between'>
                    <div className='flex items-center gap-1.5 min-w-0'>
                      <span className='text-sm font-medium text-foreground truncate'>
                        {webhook.name}
                      </span>
                      <span className='text-xs text-muted-foreground inline-flex items-center gap-0.5'>
                        <span className='w-3 flex-shrink-0 flex items-center justify-center'>
                          {webhook.channelVisibility === 'PRIVATE' ? <Lock size={10} /> : '#'}
                        </span>
                        {webhook.channelName}
                      </span>
                    </div>
                    <div className='flex items-center gap-0.5'>
                      <Button
                        type='button'
                        variant='ghost'
                        size='sm'
                        onClick={() => {
                          setEditingWebhookId(webhook.id);
                          setEditingName(webhook.name);
                        }}
                        className='h-7 w-7 p-0 text-muted-foreground hover:text-foreground'
                        title='Rename'
                        data-track-category='INCOMING_WEBHOOKS'
                        data-track-name='Edit_Webhook_Name'
                      >
                        <Pencil size={11} />
                      </Button>
                      <Button
                        type='button'
                        variant='ghost'
                        size='sm'
                        onClick={() => setRevokeTargetId(webhook.id)}
                        className='h-7 w-7 p-0 text-muted-foreground hover:text-destructive'
                        title='Revoke webhook'
                        data-track-category='INCOMING_WEBHOOKS'
                        data-track-name='Revoke_Webhook'
                      >
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  </div>
                )}
                <div className='flex items-center gap-2'>
                  <Input
                    type='text'
                    value={getFullWebhookUrl(webhook.webhookUrl)}
                    readOnly
                    className='text-xs bg-muted font-mono'
                  />
                  <Button
                    type='button'
                    variant='outline'
                    size='sm'
                    onClick={() => handleCopyWebhookUrl(webhook.webhookUrl)}
                    className='shrink-0'
                  >
                    <Copy size={14} />
                  </Button>
                </div>
              </div>
            ))}

            {(hasPrev || hasNext) && (
              <div className='flex items-center justify-between'>
                <span className='text-xs text-muted-foreground'>
                  {webhookOffset + 1}–{Math.min(webhookOffset + WEBHOOK_PAGE_SIZE, webhookTotal)} of{' '}
                  {webhookTotal}
                </span>
                <div className='flex gap-1'>
                  <Button
                    type='button'
                    variant='outline'
                    size='sm'
                    disabled={!hasPrev}
                    onClick={() => fetchWebhooks(webhookOffset - WEBHOOK_PAGE_SIZE)}
                    className='h-7 w-7 p-0'
                  >
                    <ChevronLeft size={14} />
                  </Button>
                  <Button
                    type='button'
                    variant='outline'
                    size='sm'
                    disabled={!hasNext}
                    onClick={() => fetchWebhooks(webhookOffset + WEBHOOK_PAGE_SIZE)}
                    className='h-7 w-7 p-0'
                  >
                    <ChevronRight size={14} />
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
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

      <Dialog
        open={revokeTargetId !== null}
        onOpenChange={open => {
          if (!open) setRevokeTargetId(null);
        }}
      >
        <div className='p-6 space-y-4'>
          <div className='space-y-1'>
            <h2 className='text-base font-semibold text-foreground'>Revoke webhook?</h2>
            <p className='text-sm text-muted-foreground'>
              This webhook URL will stop working immediately and cannot be re-enabled. Create a new
              webhook to replace it.
            </p>
          </div>
          <div className='flex gap-2 justify-end'>
            <Button
              type='button'
              variant='outline'
              size='sm'
              onClick={() => setRevokeTargetId(null)}
            >
              Cancel
            </Button>
            <Button
              type='button'
              variant='destructive'
              size='sm'
              onClick={() => void handleRevokeWebhook()}
              data-track-category='INCOMING_WEBHOOKS'
              data-track-name='Confirm_Revoke_Webhook'
            >
              Revoke
            </Button>
          </div>
        </div>
      </Dialog>
    </form>
  );
};

export default EditAppForm;
