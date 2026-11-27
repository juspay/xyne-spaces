import { ReactElement, ReactNode, useState } from 'react';
import { Plug, Plus, Unplug } from 'lucide-react';
import { toast } from 'sonner';
import type { DeskAppIntegration } from '../../../hooks/useChannelConnectedEmail';
import { globalClickTracker } from '../../../services/Analytics/globalClickTracker';
import { getApiErrorMessage } from '../../../utils/apiError';
import Button from '../../ui/Button';
import { DisconnectConfirmDialog } from '../DisconnectConfirmDialog';
import { DeskConnectionCard } from './DeskConnectionCard';

/** Runs a per-account action with the row's shared busy state and error toast. */
export type RunAccountAction = (key: string, action: () => Promise<void>) => Promise<void>;

export interface MultiAccountDeskCardProps {
  trackCategory: string;
  /** INTEGRATION_DISCONNECTED dimension. */
  provider: string;
  accounts: DeskAppIntegration[];
  isConnected: boolean;
  /** e.g. { one: 'Instagram account', many: 'Instagram accounts' }. */
  noun: { one: string; many: string };
  /** Shown before a display name, e.g. '@'. */
  handlePrefix: string;
  /** Slug for tracking names, e.g. 'instagram-account'. */
  accountSlug: string;
  disconnectAll: { title: string; bullets: string[]; successMessage: string };
  /** Disconnects one account (API call only; the card asks for confirmation first). */
  disconnect: (sourceId: string) => Promise<void>;
  /** What the confirm dialog lists for disconnecting one account. */
  accountDisconnectBullets: (label: string) => string[];
  /** Turns an API error into a message; defaults to the backend's text. */
  errorMessage?: (error: unknown, fallback: string) => string;
  onReconnect: (account: DeskAppIntegration, label: string) => Promise<void> | void;
  onAdd: () => Promise<void> | void;
  /** Called after any change so the parent can refresh what it shows. */
  onChanged: () => void;
  /** Extra status parts after "Connected", e.g. XChat state. */
  accountDetails?: (account: DeskAppIntegration) => Array<string | null | undefined | false>;
  /** Extra buttons before the connection toggle. */
  accountActions?: (
    account: DeskAppIntegration,
    label: string,
    ctx: { busyKey: string | null; run: RunAccountAction },
  ) => ReactNode;
  /** Rendered between the header and the rows (e.g. a load error). */
  notice?: ReactNode;
  /** Dialogs owned by the parent. */
  children?: ReactNode;
}

/**
 * Shared layout of desks with one source per connected account (Instagram, Facebook, X): a
 * summary header, one row per account with its own connect toggle, and "Add …". The header's
 * desk-wide disconnect only appears with two or more connected accounts; with one, the row
 * button does the same thing.
 */
export const MultiAccountDeskCard = ({
  trackCategory,
  provider,
  accounts,
  isConnected,
  noun,
  handlePrefix,
  accountSlug,
  disconnectAll,
  disconnect,
  accountDisconnectBullets,
  errorMessage = getApiErrorMessage,
  onReconnect,
  onAdd,
  onChanged,
  accountDetails,
  accountActions,
  notice,
  children,
}: MultiAccountDeskCardProps): ReactElement => {
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  /** The account whose disconnect is awaiting confirmation. */
  const [pendingDisconnect, setPendingDisconnect] = useState<DeskAppIntegration | null>(null);

  const labelOf = (account: DeskAppIntegration): string =>
    account.displayName
      ? `${handlePrefix}${account.displayName}`
      : (account.externalIdentifier ?? noun.one);

  const run: RunAccountAction = async (key, action) => {
    setBusyKey(key);
    try {
      await action();
    } catch (error) {
      toast.error(errorMessage(error, 'Something went wrong — please try again.'));
    } finally {
      setBusyKey(null);
    }
  };

  const handleDisconnectAll = async (): Promise<void> => {
    try {
      for (const account of accounts.filter(a => a.isActive)) {
        await disconnect(account.id);
      }
      toast.success(disconnectAll.successMessage);
    } catch (error) {
      toast.error(errorMessage(error, 'Failed to disconnect — please try again.'));
      throw error;
    } finally {
      // Some accounts may have been disconnected before a failure: show the real state either way.
      onChanged();
    }
  };

  const handleToggle = (account: DeskAppIntegration): void => {
    if (account.isActive) {
      // Confirm first; the row only shows progress once the user has confirmed.
      setPendingDisconnect(account);
      return;
    }
    const label = labelOf(account);
    void run(`reconnect:${account.id}`, async () => {
      await onReconnect(account, label);
    });
  };

  /** Same confirm dialog and INTEGRATION_DISCONNECTED analytics as the desk-wide disconnect. */
  const confirmAccountDisconnect = async (): Promise<void> => {
    const account = pendingDisconnect;
    if (!account) {
      return;
    }
    const label = labelOf(account);
    const dims = { provider, scope: 'account' };
    const startedAt = Date.now();
    setBusyKey(`disconnect:${account.id}`);
    try {
      await disconnect(account.id);
      globalClickTracker.trackManualEvent(trackCategory, 'INTEGRATION_DISCONNECTED', undefined, {
        ...dims,
        latencyMs: Date.now() - startedAt,
      });
      setPendingDisconnect(null);
      onChanged();
      toast.success(`${label} disconnected.`);
    } catch (error) {
      globalClickTracker.trackManualEvent(
        trackCategory,
        'INTEGRATION_DISCONNECT_FAILED',
        undefined,
        {
          ...dims,
          latencyMs: Date.now() - startedAt,
          errorKind: error instanceof Error ? error.name : 'unknown',
        },
      );
      toast.error(errorMessage(error, `Failed to disconnect ${label}.`));
    } finally {
      setBusyKey(null);
    }
  };

  const handleAdd = async (): Promise<void> => {
    setIsAdding(true);
    try {
      await onAdd();
    } catch (error) {
      toast.error(errorMessage(error, `Failed to add ${noun.one}.`));
    } finally {
      setIsAdding(false);
    }
  };

  const activeCount = accounts.filter(account => account.isActive).length;
  const summary =
    activeCount === accounts.length
      ? `${activeCount} ${activeCount === 1 ? noun.one : noun.many} connected`
      : `${activeCount} of ${accounts.length} ${noun.many} connected`;

  return (
    <div className='flex flex-col gap-3'>
      <DeskConnectionCard
        label={`Connected ${noun.many}`}
        value={accounts.length > 0 ? summary : null}
        isConnected={isConnected}
        onDisconnect={handleDisconnectAll}
        disconnectLabel='Disconnect all'
        hideDisconnect={activeCount < 2}
        disconnectTitle={disconnectAll.title}
        disconnectPrompt={`Disconnect all ${noun.many} from this desk?`}
        disconnectBullets={disconnectAll.bullets}
        trackCategory={trackCategory}
        provider={provider}
      />

      {notice}

      {accounts.length > 0 && (
        <div className='flex flex-col gap-2'>
          {accounts.map(account => {
            const label = labelOf(account);
            const toggleKey = `${account.isActive ? 'disconnect' : 'reconnect'}:${account.id}`;
            const details = account.isActive
              ? ['Connected', ...(accountDetails?.(account) ?? [])]
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
                  {accountActions?.(account, label, { busyKey, run })}
                  <Button
                    type='button'
                    variant='outline'
                    size='sm'
                    loading={busyKey === toggleKey}
                    disabled={busyKey !== null}
                    onClick={() => handleToggle(account)}
                    data-track-category={trackCategory}
                    data-track-name={`toggle-${accountSlug}-connection`}
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
            loading={isAdding}
            onClick={() => void handleAdd()}
            data-track-category={trackCategory}
            data-track-name={`add-${accountSlug}`}
          >
            <Plus size={14} />
            Add {noun.one}
          </Button>
        </div>
      )}

      <DisconnectConfirmDialog
        open={pendingDisconnect !== null}
        onOpenChange={open => {
          if (!open && busyKey === null) {
            setPendingDisconnect(null);
          }
        }}
        title={`Disconnect ${pendingDisconnect ? labelOf(pendingDisconnect) : noun.one}`}
        prompt={`Disconnect ${pendingDisconnect ? labelOf(pendingDisconnect) : `this ${noun.one}`} from this desk?`}
        bullets={pendingDisconnect ? accountDisconnectBullets(labelOf(pendingDisconnect)) : []}
        isPending={pendingDisconnect !== null && busyKey === `disconnect:${pendingDisconnect.id}`}
        onConfirm={() => void confirmAccountDisconnect()}
        trackCategory={trackCategory}
      />

      {children}
    </div>
  );
};
