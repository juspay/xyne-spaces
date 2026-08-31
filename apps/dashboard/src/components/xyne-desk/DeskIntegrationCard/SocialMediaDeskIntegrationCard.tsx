import { ReactElement, useState } from 'react';
import { ANDROID_PACKAGE_NAME_PATTERN } from '@xyne/shared';
import { Plug, Plus, RefreshCw, Trash2, Unplug } from 'lucide-react';
import { toast } from 'sonner';
import {
  addGooglePlayApps,
  disconnectGooglePlayApp,
  disconnectSocialMediaDesk,
  reconnectGooglePlayApp,
  reconnectSocialMediaDesk,
} from '../../../services/clients/socialMediaDeskApi';
import {
  clearChannelConnectedEmailCache,
  useChannelIntegrationInfo,
} from '../../../hooks/useChannelConnectedEmail';
import { Dialog } from '../../ui/Dialog';
import Button from '../../ui/Button';
import Input from '../../ui/Input';
import { DeskConnectionCard } from './DeskConnectionCard';

interface GooglePlayApplicationInput {
  id: string;
  displayName: string;
  packageName: string;
}

function createGooglePlayApplication(): GooglePlayApplicationInput {
  return { id: crypto.randomUUID(), displayName: '', packageName: '' };
}

interface SocialMediaDeskIntegrationCardProps {
  channelId: string;
  canManage: boolean;
}

export const SocialMediaDeskIntegrationCard = ({
  channelId,
  canManage,
}: SocialMediaDeskIntegrationCardProps): ReactElement | null => {
  const [showAddApps, setShowAddApps] = useState(false);
  const [applications, setApplications] = useState<GooglePlayApplicationInput[]>([
    createGooglePlayApplication(),
  ]);
  const [isAdding, setIsAdding] = useState(false);
  const [isReauthorizing, setIsReauthorizing] = useState(false);
  const [appAction, setAppAction] = useState<string | null>(null);
  const { isConnected, hasSource, sourceType, connectedLabel, googlePlayApps } =
    useChannelIntegrationInfo(channelId);

  if (sourceType !== 'google-play-reviews' || !hasSource) {
    return null;
  }
  if (!canManage) return null;

  const handleDisconnect = async (): Promise<void> => {
    try {
      await disconnectSocialMediaDesk(channelId);
      clearChannelConnectedEmailCache(channelId);
      toast.success('Google Play apps disconnected. Existing tickets are preserved.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to disconnect review source.');
      throw error;
    }
  };

  const handleReconnect = async (): Promise<void> => {
    setIsReauthorizing(true);
    try {
      const isElectron = typeof window.electronAPI?.openExternal === 'function';
      const authorizationUrl = await reconnectSocialMediaDesk(
        channelId,
        isElectron ? 'electron' : 'web',
      );
      if (isElectron && window.electronAPI?.openExternal) {
        window.electronAPI.openExternal(authorizationUrl);
      } else {
        window.location.href = authorizationUrl;
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to reconnect review source.');
      throw error;
    } finally {
      setIsReauthorizing(false);
    }
  };

  const handleAppConnection = async (sourceId: string, reconnect: boolean): Promise<void> => {
    setAppAction(`${reconnect ? 'reconnect' : 'disconnect'}:${sourceId}`);
    try {
      if (reconnect) {
        await reconnectGooglePlayApp(channelId, sourceId);
      } else {
        await disconnectGooglePlayApp(channelId, sourceId);
      }
      clearChannelConnectedEmailCache(channelId);
      toast.success(reconnect ? 'Google Play app reconnected.' : 'Google Play app disconnected.');
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : `Failed to ${reconnect ? 'reconnect' : 'disconnect'} Google Play app.`,
      );
    } finally {
      setAppAction(null);
    }
  };

  const updateApplication = (
    index: number,
    field: keyof GooglePlayApplicationInput,
    value: string,
  ): void => {
    setApplications(current =>
      current.map((application, applicationIndex) =>
        applicationIndex === index ? { ...application, [field]: value } : application,
      ),
    );
  };

  const normalizedApplications = applications.map(application => ({
    displayName: application.displayName.trim(),
    packageName: application.packageName.trim(),
  }));
  const packageNames = normalizedApplications.map(application => application.packageName);
  const nonEmptyPackageNames = packageNames.filter(Boolean);
  const hasDuplicatePackageNames =
    new Set(nonEmptyPackageNames).size !== nonEmptyPackageNames.length;
  const canAdd =
    normalizedApplications.length > 0 &&
    normalizedApplications.every(
      application =>
        application.displayName.length > 0 &&
        ANDROID_PACKAGE_NAME_PATTERN.test(application.packageName),
    ) &&
    !hasDuplicatePackageNames;

  const handleAddApplications = async (): Promise<void> => {
    if (!canAdd || isAdding) return;
    setIsAdding(true);
    try {
      const result = await addGooglePlayApps(channelId, {
        applications: normalizedApplications,
      });
      setShowAddApps(false);
      setApplications([createGooglePlayApplication()]);
      clearChannelConnectedEmailCache(channelId);
      toast.success(
        `${result.added} Google Play app${result.added === 1 ? '' : 's'} added successfully.`,
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to add Google Play applications.',
      );
    } finally {
      setIsAdding(false);
    }
  };

  return (
    <div className='flex flex-col gap-3'>
      <DeskConnectionCard
        label='Connected Google Play apps'
        value={connectedLabel}
        isConnected={isConnected}
        onDisconnect={handleDisconnect}
        onReconnect={handleReconnect}
        disconnectTitle='Disconnect review integration'
        disconnectPrompt='Disconnect all Google Play apps from this desk?'
        disconnectBullets={[
          'New reviews will stop creating tickets.',
          'Replies from this desk will stop.',
          'Existing review tickets and analytics are kept.',
          'You can reconnect this source later.',
        ]}
        trackCategory='social-media-desk-integration'
      />

      <div className='flex flex-col gap-2'>
        {googlePlayApps.map(app => {
          const connectionAction = `${app.isActive ? 'disconnect' : 'reconnect'}:${app.id}`;
          return (
            <div
              key={app.id}
              className='flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-3'
            >
              <div className='min-w-0'>
                <p className='truncate text-sm font-medium text-foreground'>{app.displayName}</p>
                <p className='truncate text-xs text-muted-foreground'>
                  {app.packageName ?? 'Package name unavailable'} ·{' '}
                  {app.isActive ? 'Connected' : 'Disconnected'}
                </p>
              </div>
              <div className='shrink-0'>
                <Button
                  type='button'
                  variant='outline'
                  size='sm'
                  loading={appAction === connectionAction}
                  disabled={appAction !== null}
                  onClick={() => void handleAppConnection(app.id, !app.isActive)}
                  data-track-category='social-media-desk-integration'
                  data-track-name='toggle-google-play-app-connection'
                >
                  {app.isActive ? <Unplug size={14} /> : <Plug size={14} />}
                  {app.isActive ? 'Disconnect' : 'Reconnect'}
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      {isConnected && (
        <div className='flex flex-wrap gap-2'>
          <Button
            type='button'
            variant='outline'
            size='sm'
            onClick={() => {
              setApplications([createGooglePlayApplication()]);
              setShowAddApps(true);
            }}
            data-track-category='social-media-desk-integration'
            data-track-name='add-google-play-apps'
          >
            <Plus size={14} />
            Add Google Play apps
          </Button>
          <Button
            type='button'
            variant='outline'
            size='sm'
            loading={isReauthorizing}
            onClick={() => void handleReconnect()}
            data-track-category='social-media-desk-integration'
            data-track-name='reauthorize-google-play'
          >
            <RefreshCw size={14} />
            Reauthorize Google
          </Button>
        </div>
      )}

      <Dialog
        open={showAddApps}
        onOpenChange={setShowAddApps}
        title='Add Google Play apps'
        description='Connect additional Google Play applications to this desk.'
      >
        <div className='flex flex-col gap-4 p-5'>
          <div>
            <h2 className='text-base font-semibold text-foreground'>Add Google Play apps</h2>
            <p className='mt-1 text-sm text-muted-foreground'>
              Reviews from these apps will create tickets in this desk.
            </p>
          </div>

          <div className='flex max-h-80 flex-col gap-3 overflow-y-auto'>
            {applications.map((application, index) => (
              <div
                key={application.id}
                className='grid grid-cols-[1fr_1fr_auto] items-end gap-2 rounded-md border border-border p-3'
              >
                <label
                  htmlFor={`google-play-app-name-${index}`}
                  className='flex flex-col gap-1 text-xs text-muted-foreground'
                >
                  App name
                  <Input
                    id={`google-play-app-name-${index}`}
                    value={application.displayName}
                    onChange={event => updateApplication(index, 'displayName', event.target.value)}
                    data-track-category='social-media-desk-integration'
                    data-track-name='app-name-input'
                    placeholder='My Android app'
                    maxLength={120}
                  />
                </label>
                <label
                  htmlFor={`google-play-package-name-${index}`}
                  className='flex flex-col gap-1 text-xs text-muted-foreground'
                >
                  Package name
                  <Input
                    id={`google-play-package-name-${index}`}
                    value={application.packageName}
                    onChange={event => updateApplication(index, 'packageName', event.target.value)}
                    data-track-category='social-media-desk-integration'
                    data-track-name='package-name-input'
                    placeholder='com.example.app'
                    aria-invalid={
                      application.packageName.length > 0 &&
                      !ANDROID_PACKAGE_NAME_PATTERN.test(application.packageName.trim())
                    }
                  />
                </label>
                <Button
                  type='button'
                  variant='ghost'
                  size='iconSm'
                  aria-label={`Remove application ${index + 1}`}
                  disabled={applications.length === 1}
                  onClick={() =>
                    setApplications(current =>
                      current.filter((_, applicationIndex) => applicationIndex !== index),
                    )
                  }
                  data-track-category='social-media-desk-integration'
                  data-track-name='remove-app-row'
                >
                  <Trash2 size={14} />
                </Button>
              </div>
            ))}
          </div>

          {hasDuplicatePackageNames && (
            <p className='text-xs text-destructive'>Package names must be unique.</p>
          )}

          <div className='flex items-center justify-between gap-3'>
            <Button
              type='button'
              variant='ghost'
              size='sm'
              disabled={applications.length >= 20}
              onClick={() =>
                setApplications(current => [...current, createGooglePlayApplication()])
              }
              data-track-category='social-media-desk-integration'
              data-track-name='add-app-row'
            >
              <Plus size={14} />
              Add another
            </Button>
            <div className='flex gap-2'>
              <Button
                type='button'
                variant='secondary'
                size='sm'
                disabled={isAdding}
                onClick={() => setShowAddApps(false)}
                data-track-category='social-media-desk-integration'
                data-track-name='cancel-add-apps'
              >
                Cancel
              </Button>
              <Button
                type='button'
                size='sm'
                loading={isAdding}
                disabled={!canAdd}
                onClick={() => void handleAddApplications()}
                data-track-category='social-media-desk-integration'
                data-track-name='submit-add-apps'
              >
                Add apps
              </Button>
            </div>
          </div>
        </div>
      </Dialog>
    </div>
  );
};
