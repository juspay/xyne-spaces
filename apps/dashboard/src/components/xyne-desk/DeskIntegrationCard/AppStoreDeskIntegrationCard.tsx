import { ReactElement, useState } from 'react';
import { IOS_BUNDLE_ID_PATTERN, SOCIAL_MEDIA_SOURCE_TYPE } from '@xyne/shared';
import { KeyRound, Plug, Plus, Trash2, Unplug } from 'lucide-react';
import { toast } from 'sonner';
import {
  addAppStoreApps,
  disconnectSocialMediaDesk,
  rotateAppStoreCredentials,
  setAppStoreAppConnection,
} from '../../../services/clients/socialMediaDeskApi';
import {
  clearChannelConnectedEmailCache,
  useChannelIntegrationInfo,
} from '../../../hooks/useChannelConnectedEmail';
import { Dialog } from '../../ui/Dialog';
import Button from '../../ui/Button';
import Input from '../../ui/Input';
import { DeskConnectionCard } from './DeskConnectionCard';

interface BundleIdRow {
  id: string;
  bundleId: string;
}

function createBundleIdRow(): BundleIdRow {
  return { id: crypto.randomUUID(), bundleId: '' };
}

function apiErrorMessage(error: unknown, fallback: string): string {
  return (
    (error as { response?: { data?: { error?: string } } })?.response?.data?.error ??
    (error instanceof Error ? error.message : fallback)
  );
}

interface AppStoreDeskIntegrationCardProps {
  channelId: string;
  canManage: boolean;
}

export const AppStoreDeskIntegrationCard = ({
  channelId,
  canManage,
}: AppStoreDeskIntegrationCardProps): ReactElement | null => {
  const [showAddApps, setShowAddApps] = useState(false);
  const [showRotateKey, setShowRotateKey] = useState(false);
  const [bundleIdRows, setBundleIdRows] = useState<BundleIdRow[]>([createBundleIdRow()]);
  const [issuerId, setIssuerId] = useState('');
  const [keyId, setKeyId] = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [appAction, setAppAction] = useState<string | null>(null);
  const { isConnected, hasSource, sourceType, connectedLabel, deskApps } =
    useChannelIntegrationInfo(channelId);

  if (sourceType !== SOCIAL_MEDIA_SOURCE_TYPE.APP_STORE || !hasSource) return null;
  if (!canManage) return null;

  const normalizedBundleIds = bundleIdRows
    .map(row => row.bundleId.trim())
    .filter(bundleId => bundleId.length > 0);
  const canAddApps =
    normalizedBundleIds.length > 0 &&
    normalizedBundleIds.every(bundleId => IOS_BUNDLE_ID_PATTERN.test(bundleId)) &&
    new Set(normalizedBundleIds).size === normalizedBundleIds.length;
  const canRotateKey =
    issuerId.trim().length > 0 &&
    keyId.trim().length > 0 &&
    privateKey.includes('BEGIN PRIVATE KEY');

  const handleDisconnect = async (): Promise<void> => {
    try {
      await disconnectSocialMediaDesk(channelId);
      clearChannelConnectedEmailCache(channelId);
      toast.success('App Store apps disconnected and the stored key was deleted.');
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Failed to disconnect review source.'));
      throw error;
    }
  };

  const handleAppConnection = async (sourceId: string, connect: boolean): Promise<void> => {
    setAppAction(`${connect ? 'reconnect' : 'disconnect'}:${sourceId}`);
    try {
      await setAppStoreAppConnection(channelId, sourceId, connect);
      clearChannelConnectedEmailCache(channelId);
      toast.success(connect ? 'App reconnected.' : 'App disconnected.');
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Failed to update App Store app.'));
    } finally {
      setAppAction(null);
    }
  };

  const handleAddApps = async (): Promise<void> => {
    setIsBusy(true);
    try {
      await addAppStoreApps(channelId, {
        applications: normalizedBundleIds.map(bundleId => ({ bundleId })),
      });
      clearChannelConnectedEmailCache(channelId);
      setShowAddApps(false);
      setBundleIdRows([createBundleIdRow()]);
      toast.success('App Store apps added.');
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Failed to add App Store apps.'));
    } finally {
      setIsBusy(false);
    }
  };

  const handleRotateKey = async (): Promise<void> => {
    setIsBusy(true);
    try {
      await rotateAppStoreCredentials(channelId, {
        issuerId: issuerId.trim(),
        keyId: keyId.trim(),
        privateKey: privateKey.trim(),
      });
      clearChannelConnectedEmailCache(channelId);
      setShowRotateKey(false);
      setIssuerId('');
      setKeyId('');
      setPrivateKey('');
      toast.success('App Store Connect key replaced.');
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Failed to replace the key.'));
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div className='flex flex-col gap-3'>
      <DeskConnectionCard
        label='Connected App Store apps'
        value={connectedLabel}
        isConnected={isConnected}
        onDisconnect={handleDisconnect}
        disconnectTitle='Disconnect review integration'
        disconnectPrompt='Disconnect all App Store apps from this desk?'
        disconnectBullets={[
          'New reviews will stop creating tickets.',
          'Replies from this desk will stop.',
          'The stored App Store Connect key is deleted — you will need to paste it again.',
          'Revoke the key in App Store Connect too; it cannot be revoked from here.',
          'Existing review tickets and analytics are kept.',
        ]}
        trackCategory='app-store-desk-integration'
      />

      <div className='flex flex-col gap-2'>
        {deskApps.map(app => {
          const connectionAction = `${app.isActive ? 'disconnect' : 'reconnect'}:${app.id}`;
          return (
            <div
              key={app.id}
              className='flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-3'
            >
              <div className='min-w-0'>
                <p className='truncate text-sm font-medium text-foreground'>{app.displayName}</p>
                <p className='truncate text-xs text-muted-foreground'>
                  {app.externalIdentifier ?? 'App ID unavailable'} ·{' '}
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
                  data-track-category='app-store-desk-integration'
                  data-track-name='toggle-app-store-app-connection'
                >
                  {app.isActive ? <Unplug size={14} /> : <Plug size={14} />}
                  {app.isActive ? 'Disconnect' : 'Reconnect'}
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      <div className='flex flex-wrap gap-2'>
        <Button
          type='button'
          variant='outline'
          size='sm'
          onClick={() => {
            setBundleIdRows([createBundleIdRow()]);
            setShowAddApps(true);
          }}
          data-track-category='app-store-desk-integration'
          data-track-name='add-app-store-apps'
        >
          <Plus size={14} />
          Add App Store apps
        </Button>
        <Button
          type='button'
          variant='outline'
          size='sm'
          onClick={() => setShowRotateKey(true)}
          data-track-category='app-store-desk-integration'
          data-track-name='rotate-app-store-key'
        >
          <KeyRound size={14} />
          Replace key
        </Button>
      </div>

      <Dialog
        open={showAddApps}
        onOpenChange={setShowAddApps}
        title='Add App Store apps'
        description='These apps must be visible to the key already connected to this desk.'
      >
        <div className='flex flex-col gap-3'>
          {bundleIdRows.map((row, index) => (
            <div key={row.id} className='flex items-start gap-2'>
              <Input
                value={row.bundleId}
                onChange={event =>
                  setBundleIdRows(rows =>
                    rows.map((candidate, rowIndex) =>
                      rowIndex === index
                        ? { ...candidate, bundleId: event.target.value.trim() }
                        : candidate,
                    ),
                  )
                }
                placeholder='com.example.app'
                autoComplete='off'
              />
              {bundleIdRows.length > 1 && (
                <button
                  type='button'
                  onClick={() =>
                    setBundleIdRows(rows => rows.filter((_, rowIndex) => rowIndex !== index))
                  }
                  className='mt-2 text-muted-foreground hover:text-destructive'
                  aria-label={`Remove bundle ID ${index + 1}`}
                  data-track-category='app-store-desk-integration'
                  data-track-name='remove-app-store-bundle-id'
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))}
          <button
            type='button'
            onClick={() => setBundleIdRows(rows => [...rows, createBundleIdRow()])}
            data-track-category='app-store-desk-integration'
            data-track-name='add-app-store-bundle-id'
            disabled={bundleIdRows.length >= 20}
            className='inline-flex items-center gap-1 self-start text-sm text-primary hover:text-primary/80 disabled:cursor-not-allowed disabled:opacity-50'
          >
            <Plus size={14} />
            Add another
          </button>
          <div className='flex justify-end gap-2'>
            <Button type='button' variant='outline' onClick={() => setShowAddApps(false)}>
              Cancel
            </Button>
            <Button
              type='button'
              loading={isBusy}
              disabled={!canAddApps}
              onClick={() => void handleAddApps()}
            >
              Add apps
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={showRotateKey}
        onOpenChange={setShowRotateKey}
        title='Replace App Store Connect key'
        description='Paste a new key. It is verified against every app on this desk before it is stored.'
      >
        <div className='flex flex-col gap-3'>
          <Input
            value={issuerId}
            onChange={event => setIssuerId(event.target.value.trim())}
            placeholder='Issuer ID'
            autoComplete='off'
          />
          <Input
            value={keyId}
            onChange={event => setKeyId(event.target.value.trim().toUpperCase())}
            placeholder='Key ID'
            autoComplete='off'
          />
          <textarea
            value={privateKey}
            onChange={event => setPrivateKey(event.target.value)}
            data-track-category='app-store-desk-integration'
            data-track-name='edit-app-store-private-key'
            rows={5}
            spellCheck={false}
            placeholder={'-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----'}
            className='w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring'
          />
          <div className='flex justify-end gap-2'>
            <Button type='button' variant='outline' onClick={() => setShowRotateKey(false)}>
              Cancel
            </Button>
            <Button
              type='button'
              loading={isBusy}
              disabled={!canRotateKey}
              onClick={() => void handleRotateKey()}
            >
              Replace key
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
};
