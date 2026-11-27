import { ReactElement, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { SOCIAL_MEDIA_SOURCE_TYPE } from '@xyne/shared';
import { Lock, LockOpen } from 'lucide-react';
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
import { oauthPlatform, openOAuthUrl } from '../../../utils/oauthRedirect';
import { xErrorMessage } from '../../../utils/xErrors';
import { Dialog } from '../../ui/Dialog';
import Button from '../../ui/Button';
import { Checkbox } from '../../ui/Checkbox/Checkbox';
import Input from '../../ui/Input';
import { MultiAccountDeskCard } from './MultiAccountDeskCard';
import {
  EMPTY_X_APP_KEYS,
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

/**
 * X on the shared multi-account card, plus what only X has: the customer's own app keys (asked
 * for when adding or reconnecting with different keys) and per-account XChat.
 */
export const XDeskIntegrationCard = ({
  channelId,
  canManage,
}: XDeskIntegrationCardProps): ReactElement | null => {
  const queryClient = useQueryClient();
  const { isConnected, hasSource, sourceType, deskApps } = useChannelIntegrationInfo(channelId);
  const { confirm, ConfirmDialog } = useConfirmDialog();
  const isXDesk = sourceType === SOCIAL_MEDIA_SOURCE_TYPE.X && hasSource && canManage;

  const accountsQueryKey = ['x-accounts', channelId];
  const {
    data: accountsData,
    isError: accountsFailed,
    refetch: refetchAccounts,
    isFetching: accountsLoading,
  } = useQuery({
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

  const openKeysDialog = (dialog: Exclude<KeysDialog, null>): void => {
    setKeys(EMPTY_X_APP_KEYS);
    // Reconnecting an account with no stored keys needs new ones up front.
    const storedKeys =
      dialog.mode === 'reconnect' ? statusById.get(dialog.sourceId)?.hasAppKeys : true;
    setUseNewKeys(storedKeys === false);
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
      openOAuthUrl(authUrl);
    } catch (error) {
      if (getXErrorCode(error) === 'x_keys_required') {
        setUseNewKeys(true);
      }
      toast.error(xErrorMessage(error, 'Failed to start X authorization.'));
    } finally {
      setIsRedirecting(false);
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

  const confirmDisableXChat = (label: string): Promise<boolean> =>
    confirm({
      title: `Turn off XChat for ${label}`,
      description:
        'The stored XChat keys are deleted. New encrypted DMs will appear as locked messages until XChat is enabled again.',
      confirmLabel: 'Turn off',
      cancelLabel: 'Cancel',
    });

  const disableXChatFor = async (sourceId: string, label: string): Promise<void> => {
    await disableXChat(channelId, sourceId);
    refresh();
    toast.success(`XChat turned off for ${label}.`);
  };

  const canContinueToX = !useNewKeys || isXAppKeysComplete(keys);

  return (
    <MultiAccountDeskCard
      trackCategory={TRACK}
      provider='x'
      accounts={deskApps}
      isConnected={isConnected}
      noun={{ one: 'X account', many: 'X accounts' }}
      handlePrefix='@'
      accountSlug='x-account'
      disconnectAll={{
        title: 'Disconnect X integration',
        bullets: [
          'New mentions, replies and DMs will stop creating tickets immediately.',
          'Stored XChat keys are deleted and X tokens revoked.',
          'Existing tickets on this desk are kept.',
          'You can reconnect the same accounts later.',
        ],
        successMessage: 'X accounts disconnected. Existing tickets are kept.',
      }}
      disconnect={sourceId => disconnectXAccount(channelId, sourceId)}
      accountDisconnectBullets={() => [
        'New mentions, replies and DMs for this account stop creating tickets.',
        'Its stored XChat keys are deleted and its X tokens revoked.',
        'Existing tickets are kept; you can reconnect it later.',
      ]}
      errorMessage={xErrorMessage}
      onReconnect={(account, label) =>
        openKeysDialog({ mode: 'reconnect', sourceId: account.id, label })
      }
      onAdd={() => openKeysDialog({ mode: 'add' })}
      onChanged={refresh}
      accountDetails={account => {
        const status = statusById.get(account.id);
        const syncedAt = formatSyncedAt(status?.lastSyncedAt ?? null);
        return [
          status && (status.xchatEnabled ? 'XChat on' : 'XChat off — encrypted DMs show as locked'),
          syncedAt && `Last synced ${syncedAt}`,
        ];
      }}
      accountActions={(account, label, { busyKey, run }) => {
        const status = statusById.get(account.id);
        if (!account.isActive || !status) {
          return null;
        }
        return (
          <Button
            type='button'
            variant='outline'
            size='sm'
            loading={busyKey === `xchat:${account.id}`}
            disabled={busyKey !== null}
            onClick={() => {
              if (!status.xchatEnabled) {
                openXChatDialog(account.id, label);
                return;
              }
              // Confirm first: the button only spins once the user has confirmed.
              void confirmDisableXChat(label).then(confirmed => {
                if (confirmed) {
                  void run(`xchat:${account.id}`, () => disableXChatFor(account.id, label));
                }
              });
            }}
            data-track-category={TRACK}
            data-track-name={status.xchatEnabled ? 'disable-xchat' : 'enable-xchat'}
          >
            {status.xchatEnabled ? <Lock size={14} /> : <LockOpen size={14} />}
            {status.xchatEnabled ? 'Turn off XChat' : 'Enable XChat'}
          </Button>
        );
      }}
      notice={
        accountsFailed && (
          <div className='flex items-center justify-between gap-3 rounded-md border border-border p-3 text-xs text-muted-foreground'>
            <span>Could not load XChat and sync status for these accounts.</span>
            <Button
              type='button'
              variant='outline'
              size='sm'
              loading={accountsLoading}
              onClick={() => void refetchAccounts()}
              data-track-category={TRACK}
              data-track-name='retry-x-accounts'
            >
              Retry
            </Button>
          </div>
        )
      }
    >
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

          <div className='flex flex-col gap-1'>
            <Checkbox
              checked={useNewKeys}
              onChange={setUseNewKeys}
              label='Use different X app keys'
              size='sm'
              data-track-category={TRACK}
              data-track-name='toggle-x-new-keys'
            />
            <span className='pl-6 text-xs text-muted-foreground'>
              {keysDialog?.mode === 'reconnect'
                ? 'Only needed if you regenerated the keys in the X Developer Console.'
                : "Leave unchecked to use this desk's X app."}
            </span>
          </div>

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
    </MultiAccountDeskCard>
  );
};
