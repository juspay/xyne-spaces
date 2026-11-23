import { ReactElement, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { SOCIAL_MEDIA_SOURCE_TYPE } from '@xyne/shared';
import { Lock, LockOpen, Plug, Plus, Unplug } from 'lucide-react';
import { toast } from 'sonner';
import {
  addXAccount,
  disableXChat,
  disconnectXAccount,
  enableXChat,
  getXAccounts,
  getXChatGuessesRemaining,
  getXErrorCode,
  reconnectXAccount,
  type XAccountStatus,
  type XAppKeys,
} from '../../../services/clients/socialMediaDeskApi';
import {
  clearChannelConnectedEmailCache,
  useChannelIntegrationInfo,
} from '../../../hooks/useChannelConnectedEmail';
import { useConfirmDialog } from '../../../hooks/useConfirmDialog';
import { getApiErrorMessage } from '../../../utils/apiError';
import { Dialog } from '../../ui/Dialog';
import Button from '../../ui/Button';
import Input from '../../ui/Input';
import { DeskConnectionCard } from './DeskConnectionCard';
import {
  EMPTY_X_APP_KEYS,
  X_ERROR_MESSAGES,
  XAppKeysFields,
  isXAppKeysComplete,
  trimXAppKeys,
} from './XAppKeysFields';

const TRACK = 'x-desk-integration';

const XCHAT_ERROR_MESSAGES: Record<string, string> = {
  xchat_not_set_up:
    'XChat is not set up on this X account. Open Chat in the X app, create a passcode, then try again.',
  xchat_unlock_failed: 'Could not reach X to unlock XChat. Please try again in a moment.',
};

function openAuthUrl(authUrl: string): void {
  if (window.electronAPI?.openExternal) {
    window.electronAPI.openExternal(authUrl);
  } else {
    window.location.href = authUrl;
  }
}

const oauthPlatform = (): 'web' | 'electron' =>
  typeof window.electronAPI?.openExternal === 'function' ? 'electron' : 'web';

function xErrorMessage(error: unknown, fallback: string): string {
  const code = getXErrorCode(error);
  return (code && X_ERROR_MESSAGES[code]) || getApiErrorMessage(error, fallback);
}

function formatSyncedAt(iso: string | null): string | null {
  if (!iso) {
    return null;
  }
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? null : at.toLocaleString();
}

/** Which keys dialog is open: adding an account, or reconnecting one. */
type KeysDialog = { mode: 'add' } | { mode: 'reconnect'; sourceId: string; label: string } | null;

interface XDeskIntegrationCardProps {
  channelId: string;
  canManage: boolean;
}

export const XDeskIntegrationCard = ({
  channelId,
  canManage,
}: XDeskIntegrationCardProps): ReactElement | null => {
  const queryClient = useQueryClient();
  const { isConnected, hasSource, sourceType, deskApps } = useChannelIntegrationInfo(channelId);
  const { confirm, ConfirmDialog } = useConfirmDialog();
  const isXDesk = sourceType === SOCIAL_MEDIA_SOURCE_TYPE.X && hasSource && canManage;

  const accountsQueryKey = ['x-accounts', channelId];
  const { data: accountsData } = useQuery({
    queryKey: accountsQueryKey,
    queryFn: () => getXAccounts(channelId),
    enabled: isXDesk,
  });

  const [keysDialog, setKeysDialog] = useState<KeysDialog>(null);
  const [useNewKeys, setUseNewKeys] = useState(false);
  const [keys, setKeys] = useState<XAppKeys>(EMPTY_X_APP_KEYS);
  const [isRedirecting, setIsRedirecting] = useState(false);

  const [xchatTarget, setXchatTarget] = useState<{ sourceId: string; label: string } | null>(null);
  const [passcode, setPasscode] = useState('');
  const [xchatError, setXchatError] = useState<string | null>(null);
  const [isEnablingXChat, setIsEnablingXChat] = useState(false);

  const [accountAction, setAccountAction] = useState<string | null>(null);

  if (!isXDesk) {
    return null;
  }

  const statusById = new Map<string, XAccountStatus>(
    (accountsData?.accounts ?? []).map(account => [account.id, account]),
  );
  const refresh = (): void => {
    clearChannelConnectedEmailCache(channelId);
    void queryClient.invalidateQueries({ queryKey: accountsQueryKey });
  };
  const accountLabel = (displayName: string | null, fallback: string | null): string =>
    displayName ? `@${displayName}` : (fallback ?? 'X account');

  const openKeysDialog = (dialog: Exclude<KeysDialog, null>): void => {
    setKeys(EMPTY_X_APP_KEYS);
    setUseNewKeys(false);
    setKeysDialog(dialog);
  };
  const closeKeysDialog = (): void => {
    setKeysDialog(null);
    setKeys(EMPTY_X_APP_KEYS); // never keep secrets in state longer than needed
  };

  const handleContinueToX = async (): Promise<void> => {
    if (!keysDialog) {
      return;
    }
    const app = useNewKeys ? trimXAppKeys(keys) : undefined;
    setIsRedirecting(true);
    try {
      const authUrl =
        keysDialog.mode === 'add'
          ? await addXAccount(channelId, oauthPlatform(), app)
          : await reconnectXAccount(channelId, keysDialog.sourceId, oauthPlatform(), app);
      closeKeysDialog();
      openAuthUrl(authUrl);
    } catch (error) {
      if (getXErrorCode(error) === 'x_keys_required') {
        setUseNewKeys(true);
      }
      toast.error(xErrorMessage(error, 'Failed to start X authorization.'));
    } finally {
      setIsRedirecting(false);
    }
  };

  const handleDisconnectAll = async (): Promise<void> => {
    try {
      for (const account of deskApps.filter(a => a.isActive)) {
        await disconnectXAccount(channelId, account.id);
      }
      refresh();
      toast.success('X accounts disconnected. Existing tickets are kept.');
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Failed to disconnect — please try again.'));
      throw error;
    }
  };

  const handleDisconnect = async (sourceId: string, label: string): Promise<void> => {
    const confirmed = await confirm({
      title: `Disconnect ${label}`,
      description:
        'New mentions, replies and DMs for this account will stop creating tickets. Its XChat keys are deleted and its X tokens revoked. Existing tickets are kept.',
      confirmLabel: 'Disconnect',
      cancelLabel: 'Cancel',
    });
    if (!confirmed) {
      return;
    }
    setAccountAction(`disconnect:${sourceId}`);
    try {
      await disconnectXAccount(channelId, sourceId);
      refresh();
      toast.success(`${label} disconnected.`);
    } catch (error) {
      toast.error(getApiErrorMessage(error, `Failed to disconnect ${label}.`));
    } finally {
      setAccountAction(null);
    }
  };

  const openXChatDialog = (sourceId: string, label: string): void => {
    setPasscode('');
    setXchatError(null);
    setXchatTarget({ sourceId, label });
  };
  const closeXChatDialog = (): void => {
    setXchatTarget(null);
    setPasscode(''); // the passcode never outlives the dialog
    setXchatError(null);
  };

  const handleEnableXChat = async (): Promise<void> => {
    if (!xchatTarget || !passcode) {
      return;
    }
    setIsEnablingXChat(true);
    setXchatError(null);
    try {
      await enableXChat(channelId, xchatTarget.sourceId, passcode);
      closeXChatDialog();
      refresh();
      toast.success(
        `XChat enabled for ${xchatTarget.label}. Encrypted DMs will now be readable here.`,
      );
    } catch (error) {
      setPasscode('');
      const code = getXErrorCode(error);
      if (code === 'xchat_invalid_passcode') {
        const left = getXChatGuessesRemaining(error);
        setXchatError(
          left === null
            ? 'X rejected the passcode. Check it in the X app before trying again — wrong attempts are limited.'
            : `X rejected the passcode. ${left} attempt${left === 1 ? '' : 's'} left for this account (shared with its XChat apps). Check it in the X app before trying again.`,
        );
      } else {
        setXchatError(
          (code && XCHAT_ERROR_MESSAGES[code]) ||
            getApiErrorMessage(error, 'Failed to enable XChat.'),
        );
      }
    } finally {
      setIsEnablingXChat(false);
    }
  };

  const handleDisableXChat = async (sourceId: string, label: string): Promise<void> => {
    const confirmed = await confirm({
      title: `Turn off XChat for ${label}`,
      description:
        'The stored XChat keys are deleted. New encrypted DMs will appear as locked messages until XChat is enabled again.',
      confirmLabel: 'Turn off',
      cancelLabel: 'Cancel',
    });
    if (!confirmed) {
      return;
    }
    setAccountAction(`xchat:${sourceId}`);
    try {
      await disableXChat(channelId, sourceId);
      refresh();
      toast.success(`XChat turned off for ${label}.`);
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Failed to turn off XChat.'));
    } finally {
      setAccountAction(null);
    }
  };

  const canContinueToX = !useNewKeys || isXAppKeysComplete(keys);
  // The rows below name each account, so the header only summarises; its desk-wide disconnect
  // only appears when there is more than one account (with one, the row button does the same).
  const activeCount = deskApps.filter(account => account.isActive).length;
  const summary =
    deskApps.length === 0
      ? null
      : `${activeCount} of ${deskApps.length} account${deskApps.length === 1 ? '' : 's'} connected`;

  return (
    <div className='flex flex-col gap-3'>
      <DeskConnectionCard
        label='Connected X accounts'
        value={
          activeCount === deskApps.length
            ? `${activeCount} account${activeCount === 1 ? '' : 's'} connected`
            : summary
        }
        isConnected={isConnected}
        onDisconnect={handleDisconnectAll}
        disconnectLabel='Disconnect all'
        hideDisconnect={activeCount < 2}
        disconnectTitle='Disconnect X integration'
        disconnectPrompt='Disconnect all X accounts from this desk?'
        disconnectBullets={[
          'New mentions, replies and DMs will stop creating tickets immediately.',
          'Stored XChat keys are deleted and X tokens revoked.',
          'Existing tickets on this desk are kept.',
          'You can reconnect the same accounts later.',
        ]}
        trackCategory={TRACK}
        provider='x'
      />

      {deskApps.length > 0 && (
        <div className='flex flex-col gap-2'>
          {deskApps.map(account => {
            const label = accountLabel(account.displayName, account.externalIdentifier);
            const status = statusById.get(account.id);
            const syncedAt = formatSyncedAt(status?.lastSyncedAt ?? null);
            const details = account.isActive
              ? [
                  'Connected',
                  status &&
                    (status.xchatEnabled ? 'XChat on' : 'XChat off — encrypted DMs show as locked'),
                  syncedAt && `Last synced ${syncedAt}`,
                ]
              : ['Disconnected'];
            return (
              <div
                key={account.id}
                className='flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-3'
              >
                <div className='min-w-0'>
                  <p className='truncate text-sm font-medium text-foreground'>{label}</p>
                  <p className='truncate text-xs text-muted-foreground'>
                    {details.filter(Boolean).join(' · ')}
                  </p>
                </div>
                <div className='flex shrink-0 flex-wrap gap-2'>
                  {account.isActive && status && (
                    <Button
                      type='button'
                      variant='outline'
                      size='sm'
                      loading={accountAction === `xchat:${account.id}`}
                      disabled={accountAction !== null}
                      onClick={() =>
                        status.xchatEnabled
                          ? void handleDisableXChat(account.id, label)
                          : openXChatDialog(account.id, label)
                      }
                      data-track-category={TRACK}
                      data-track-name={status.xchatEnabled ? 'disable-xchat' : 'enable-xchat'}
                    >
                      {status.xchatEnabled ? <Lock size={14} /> : <LockOpen size={14} />}
                      {status.xchatEnabled ? 'Turn off XChat' : 'Enable XChat'}
                    </Button>
                  )}
                  <Button
                    type='button'
                    variant='outline'
                    size='sm'
                    loading={accountAction === `disconnect:${account.id}`}
                    disabled={accountAction !== null}
                    onClick={() =>
                      account.isActive
                        ? void handleDisconnect(account.id, label)
                        : openKeysDialog({ mode: 'reconnect', sourceId: account.id, label })
                    }
                    data-track-category={TRACK}
                    data-track-name='toggle-x-account-connection'
                  >
                    {account.isActive ? <Unplug size={14} /> : <Plug size={14} />}
                    {account.isActive ? 'Disconnect' : 'Reconnect'}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {isConnected && (
        <div className='flex flex-wrap gap-2'>
          <Button
            type='button'
            variant='outline'
            size='sm'
            onClick={() => openKeysDialog({ mode: 'add' })}
            data-track-category={TRACK}
            data-track-name='add-x-account'
          >
            <Plus size={14} />
            Add X account
          </Button>
        </div>
      )}

      <Dialog
        open={keysDialog !== null}
        onOpenChange={open => !open && closeKeysDialog()}
        title={keysDialog?.mode === 'reconnect' ? `Reconnect ${keysDialog.label}` : 'Add X account'}
        description='Authorize an X account for this desk.'
      >
        <div className='flex flex-col gap-4 p-5'>
          <div>
            <h2 className='text-base font-semibold text-foreground'>
              {keysDialog?.mode === 'reconnect' ? `Reconnect ${keysDialog.label}` : 'Add X account'}
            </h2>
            <p className='mt-1 text-sm text-muted-foreground'>
              {keysDialog?.mode === 'reconnect'
                ? `Sign in to ${keysDialog.label} on x.com first — X authorizes whichever account is signed in.`
                : 'Sign in to the X account you want to add on x.com first — X authorizes whichever account is signed in.'}
            </p>
          </div>

          <label className='flex items-start gap-2 text-sm text-foreground'>
            <input
              type='checkbox'
              className='mt-0.5'
              checked={useNewKeys}
              onChange={event => setUseNewKeys(event.target.checked)}
              data-track-category={TRACK}
              data-track-name='toggle-x-new-keys'
            />
            <span>
              Use different X app keys
              <span className='block text-xs text-muted-foreground'>
                {keysDialog?.mode === 'reconnect'
                  ? 'Only needed if you regenerated the keys in the X Developer Console.'
                  : "Leave unchecked to use this desk's X app."}
              </span>
            </span>
          </label>

          {useNewKeys && (
            <XAppKeysFields
              idPrefix='x-desk-keys'
              value={keys}
              onChange={setKeys}
              showSetupSteps={false}
              trackCategory={TRACK}
            />
          )}

          <div className='flex justify-end gap-2'>
            <Button type='button' variant='outline' onClick={closeKeysDialog}>
              Cancel
            </Button>
            <Button
              type='button'
              loading={isRedirecting}
              disabled={!canContinueToX}
              onClick={() => void handleContinueToX()}
              data-track-category={TRACK}
              data-track-name='continue-to-x'
            >
              Continue to X
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={xchatTarget !== null}
        onOpenChange={open => !open && closeXChatDialog()}
        title='Enable XChat'
        description='Read and reply to encrypted X chats on this desk.'
      >
        <form
          className='flex flex-col gap-4 p-5'
          onSubmit={event => {
            event.preventDefault();
            void handleEnableXChat();
          }}
        >
          <div>
            <h2 className='text-base font-semibold text-foreground'>
              Enable XChat for {xchatTarget?.label}
            </h2>
            <p className='mt-1 text-sm text-muted-foreground'>
              New X DMs are end-to-end encrypted. Enter this account&apos;s XChat passcode so the
              desk can read and answer them.
            </p>
          </div>
          <ul className='list-disc space-y-1 pl-4 text-xs text-muted-foreground'>
            <li>
              The passcode is used once to unlock the account&apos;s chat keys and is not stored.
            </li>
            <li>
              The unlocked keys are stored encrypted. Anyone with access to them could read this
              account&apos;s chats — turn XChat off here to delete them.
            </li>
            <li>
              X allows only a few wrong passcodes per account, shared with its own XChat apps. We
              try once and never retry.
            </li>
          </ul>
          <label htmlFor='x-chat-passcode' className='flex flex-col gap-1 text-sm text-foreground'>
            XChat passcode
            <Input
              id='x-chat-passcode'
              type='password'
              value={passcode}
              onChange={event => setPasscode(event.target.value)}
              autoComplete='off'
              aria-invalid={Boolean(xchatError)}
              data-track-category={TRACK}
              data-track-name='edit-xchat-passcode'
            />
          </label>
          {xchatError && <p className='text-xs text-destructive'>{xchatError}</p>}
          <div className='flex justify-end gap-2'>
            <Button type='button' variant='outline' onClick={closeXChatDialog}>
              Cancel
            </Button>
            <Button
              type='submit'
              loading={isEnablingXChat}
              disabled={!passcode}
              data-track-category={TRACK}
              data-track-name='submit-xchat-passcode'
            >
              Enable XChat
            </Button>
          </div>
        </form>
      </Dialog>

      <ConfirmDialog />
    </div>
  );
};
