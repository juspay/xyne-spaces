import { ReactElement, useCallback, useEffect, useId, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Copy, Hash, KeyRound, Plus, Power, Trash2 } from 'lucide-react';
import { ChannelScopeType } from '@xyne/shared';
import { toast } from 'sonner';
import { Button } from '../../components/ui/Button/Button';
import Input from '../../components/ui/Input/Input';
import { SegmentedToggle } from '../../components/ui/SegmentedToggle';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { apiInstance } from '../../services/clients/apiClient';
import { queries } from '../../zero/queries';

interface AccountResource {
  type: 'CHANNEL';
  id: string;
}

interface ServiceAccount {
  id: string;
  name: string;
  status: 'ACTIVE' | 'DISABLED';
  resources: AccountResource[];
  createdBy: string;
  createdAt: string;
}

interface ServiceAccountKey {
  id: string;
  status: 'ACTIVE' | 'REVOKED';
  expiresAt: string;
  lastUsedAt: string | null;
  createdAt: string;
  revokedAt: string | null;
}

const KEY_LIFETIMES = ['30', '90', '180', '365'] as const;

function errorMessage(error: unknown, fallback: string): string {
  const response = (error as { response?: { data?: { error?: string; message?: string } } })
    ?.response?.data;
  return (
    response?.error || response?.message || (error instanceof Error ? error.message : fallback)
  );
}

const formatDate = (value: string): string =>
  new Date(value).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });

/** Channel names the user can see, and which of them they administer (the ones they may connect). */
function useChannelOptions(): {
  nameOf: (id: string) => string;
  adminChannels: { id: string; name: string }[];
} {
  const [channels] = useCachedQuery(queries.userAllChannels({}));
  const [adminParticipations] = useCachedQuery(queries.myChannelParticipations({}));

  return useMemo(() => {
    const names = new Map(channels.map(channel => [channel.id, channel.name]));
    const adminIds = new Set(adminParticipations.map(participation => participation.channelId));
    const adminChannels = channels
      .filter(
        channel =>
          adminIds.has(channel.id) &&
          !channel.isArchived &&
          channel.scopeType !== ChannelScopeType.DM &&
          channel.scopeType !== ChannelScopeType.GROUP_DM,
      )
      .map(channel => ({ id: channel.id, name: channel.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { nameOf: (id: string) => names.get(id) ?? id, adminChannels };
  }, [channels, adminParticipations]);
}

export function ServiceAccountsTab({ isActive }: { isActive: boolean }): ReactElement {
  const [accounts, setAccounts] = useState<ServiceAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const channelOptions = useChannelOptions();

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const response = await apiInstance.get<{ serviceAccounts: ServiceAccount[] }>(
        '/service-accounts',
      );
      setAccounts(response.data.serviceAccounts);
    } catch (error) {
      toast.error(errorMessage(error, 'Could not load service accounts'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isActive) void load();
  }, [isActive, load]);

  return (
    <div className='space-y-4'>
      <div className='flex items-start justify-between gap-4'>
        <div>
          <h2 className='text-lg font-semibold text-foreground'>Service accounts</h2>
          <p className='text-sm text-muted-foreground'>
            Let an outside system, such as a partner&apos;s dashboard, create guest users in the
            channels you connect and sign them in with the Spaces SDK.
          </p>
        </div>
        {!adding && (
          <Button
            variant='outline'
            onClick={() => setAdding(true)}
            data-track-category='workspace-management'
            data-track-name='ADD_SERVICE_ACCOUNT'
          >
            <Plus className='h-4 w-4' /> New service account
          </Button>
        )}
      </div>

      {adding && (
        <CreateServiceAccountForm
          onCancel={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            void load();
          }}
        />
      )}

      {loading ? (
        <p className='text-sm text-muted-foreground'>Loading service accounts…</p>
      ) : accounts.length === 0 ? (
        <div className='rounded-lg border border-dashed p-4 text-sm text-muted-foreground'>
          No service accounts you can manage yet.
        </div>
      ) : (
        accounts.map(account => (
          <ServiceAccountCard
            key={account.id}
            account={account}
            channelOptions={channelOptions}
            onChanged={() => void load()}
          />
        ))
      )}
    </div>
  );
}

function ChannelPicker(props: {
  channels: { id: string; name: string }[];
  selected: string[];
  onChange: (ids: string[]) => void;
}): ReactElement {
  const [search, setSearch] = useState('');
  const visible = props.channels.filter(channel =>
    channel.name.toLowerCase().includes(search.trim().toLowerCase()),
  );
  const toggle = (id: string): void =>
    props.onChange(
      props.selected.includes(id)
        ? props.selected.filter(selectedId => selectedId !== id)
        : [...props.selected, id],
    );

  if (props.channels.length === 0) {
    return (
      <p className='text-sm text-muted-foreground'>
        You aren&apos;t an admin of any channel that can be connected.
      </p>
    );
  }
  return (
    <div className='space-y-2'>
      <Input
        value={search}
        onChange={event => setSearch(event.target.value)}
        placeholder='Search channels you admin…'
      />
      <div className='max-h-56 space-y-1 overflow-y-auto rounded-lg border border-border p-2'>
        {visible.map(channel => (
          <label
            key={channel.id}
            className='flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-muted'
          >
            <input
              type='checkbox'
              checked={props.selected.includes(channel.id)}
              onChange={() => toggle(channel.id)}
              data-track-category='workspace-management'
              data-track-name='SELECT_SERVICE_ACCOUNT_CHANNEL'
            />
            <Hash className='h-3.5 w-3.5 text-muted-foreground' />
            {channel.name}
          </label>
        ))}
      </div>
    </div>
  );
}

function CreateServiceAccountForm(props: {
  onCancel: () => void;
  onSaved: () => void;
}): ReactElement {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const nameId = useId();

  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      await apiInstance.post('/service-accounts', { name: name.trim() });
      toast.success('Service account created. Create a key to hand to the partner.');
      props.onSaved();
    } catch (error) {
      toast.error(errorMessage(error, 'Could not create service account'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className='space-y-4 rounded-xl border border-border bg-card p-6 shadow-sm'
      onSubmit={event => {
        event.preventDefault();
        void save();
      }}
    >
      <label htmlFor={nameId} className='block text-sm font-medium'>
        Name
        <Input
          id={nameId}
          className='mt-2'
          value={name}
          onChange={event => setName(event.target.value)}
          placeholder='Partner dashboard'
          maxLength={80}
          required
        />
      </label>
      <div className='flex gap-2'>
        <Button
          type='submit'
          loading={busy}
          disabled={!name.trim()}
          data-track-category='workspace-management'
          data-track-name='SAVE_SERVICE_ACCOUNT'
        >
          Create
        </Button>
        <Button type='button' variant='outline' onClick={props.onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function ServiceAccountCard(props: {
  account: ServiceAccount;
  channelOptions: ReturnType<typeof useChannelOptions>;
  onChanged: () => void;
}): ReactElement {
  const { account, channelOptions } = props;
  const [open, setOpen] = useState(false);
  const [keys, setKeys] = useState<ServiceAccountKey[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [toConnect, setToConnect] = useState<string[]>([]);
  const [keyDays, setKeyDays] = useState<(typeof KEY_LIFETIMES)[number]>('90');
  const [newKey, setNewKey] = useState<{ key: string; expiresAt: string } | null>(null);
  const channelIds = account.resources.filter(r => r.type === 'CHANNEL').map(r => r.id);
  const active = account.status === 'ACTIVE';

  const loadKeys = useCallback(async (): Promise<void> => {
    try {
      const response = await apiInstance.get<{ keys: ServiceAccountKey[] }>(
        `/service-accounts/${account.id}`,
      );
      setKeys(response.data.keys);
    } catch (error) {
      toast.error(errorMessage(error, 'Could not load keys'));
    }
  }, [account.id]);

  useEffect(() => {
    if (open) void loadKeys();
  }, [open, loadKeys]);

  const run = async (action: string, fn: () => Promise<void>, failure: string): Promise<void> => {
    setBusy(action);
    try {
      await fn();
    } catch (error) {
      toast.error(errorMessage(error, failure));
    } finally {
      setBusy(null);
    }
  };

  const toggleStatus = (): Promise<void> =>
    run(
      'status',
      async () => {
        if (
          active &&
          !window.confirm(`Disable "${account.name}"? All its keys and user tokens stop working.`)
        )
          return;
        await apiInstance.patch(`/service-accounts/${account.id}`, {
          status: active ? 'DISABLED' : 'ACTIVE',
        });
        props.onChanged();
      },
      'Could not change status',
    );

  const connect = (): Promise<void> =>
    run(
      'connect',
      async () => {
        await apiInstance.post(`/service-accounts/${account.id}/channels`, {
          channelIds: toConnect,
        });
        setToConnect([]);
        setConnecting(false);
        props.onChanged();
      },
      'Could not connect channels',
    );

  const disconnect = (channelId: string): Promise<void> =>
    run(
      `disconnect:${channelId}`,
      async () => {
        const channel = channelOptions.nameOf(channelId);
        if (!window.confirm(`Disconnect #${channel}? Users this account gave it to lose access.`))
          return;
        await apiInstance.delete(`/service-accounts/${account.id}/channels/${channelId}`);
        props.onChanged();
      },
      'Could not disconnect channel',
    );

  const createKey = (): Promise<void> =>
    run(
      'key',
      async () => {
        const response = await apiInstance.post<{ key: string; expiresAt: string }>(
          `/service-accounts/${account.id}/keys`,
          { expiresInDays: Number(keyDays) },
        );
        setNewKey(response.data);
        void loadKeys();
      },
      'Could not create key',
    );

  const revokeKey = (keyId: string): Promise<void> =>
    run(
      `revoke:${keyId}`,
      async () => {
        if (!window.confirm('Revoke this key? Anything using it stops working immediately.'))
          return;
        await apiInstance.post(`/service-accounts/${account.id}/keys/${keyId}/revoke`);
        void loadKeys();
      },
      'Could not revoke key',
    );

  const connectable = channelOptions.adminChannels.filter(c => !channelIds.includes(c.id));

  return (
    <div className='rounded-xl border border-border bg-card p-6 shadow-sm'>
      <div className='flex items-start justify-between gap-4'>
        <button
          type='button'
          className='flex items-start gap-3 text-left'
          onClick={() => setOpen(value => !value)}
          data-track-category='workspace-management'
          data-track-name='EXPAND_SERVICE_ACCOUNT'
        >
          {open ? (
            <ChevronDown className='mt-1 h-4 w-4' />
          ) : (
            <ChevronRight className='mt-1 h-4 w-4' />
          )}
          <div>
            <h3 className='font-semibold'>{account.name}</h3>
            <p className='text-sm text-muted-foreground'>
              {channelIds.length} channel{channelIds.length === 1 ? '' : 's'} · created{' '}
              {formatDate(account.createdAt)}
            </p>
          </div>
        </button>
        <div className='flex items-center gap-2'>
          <span
            className={
              active
                ? 'rounded-full bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                : 'rounded-full bg-muted px-2 py-1 text-xs font-medium text-muted-foreground'
            }
          >
            {active ? 'Active' : 'Disabled'}
          </span>
          <Button
            variant='outline'
            loading={busy === 'status'}
            onClick={() => void toggleStatus()}
            data-track-category='workspace-management'
            data-track-name='TOGGLE_SERVICE_ACCOUNT'
          >
            <Power className='h-4 w-4' /> {active ? 'Disable' : 'Enable'}
          </Button>
        </div>
      </div>

      {open && (
        <div className='mt-6 space-y-6'>
          <section className='space-y-2'>
            <div className='flex items-center justify-between'>
              <h4 className='text-sm font-semibold'>Channels</h4>
              {!connecting && (
                <Button variant='outline' onClick={() => setConnecting(true)}>
                  <Plus className='h-4 w-4' /> Connect channels
                </Button>
              )}
            </div>
            {connecting && (
              <div className='space-y-2 rounded-lg border border-border p-4'>
                <ChannelPicker
                  channels={connectable}
                  selected={toConnect}
                  onChange={setToConnect}
                />
                <div className='flex gap-2'>
                  <Button
                    loading={busy === 'connect'}
                    disabled={toConnect.length === 0}
                    onClick={() => void connect()}
                    data-track-category='workspace-management'
                    data-track-name='CONNECT_SERVICE_ACCOUNT_CHANNELS'
                  >
                    Connect
                  </Button>
                  <Button variant='outline' onClick={() => setConnecting(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
            {channelIds.map(channelId => (
              <div key={channelId} className='flex items-center justify-between text-sm'>
                <span className='flex items-center gap-2'>
                  <Hash className='h-3.5 w-3.5 text-muted-foreground' />
                  {channelOptions.nameOf(channelId)}
                </span>
                <Button
                  variant='outline'
                  loading={busy === `disconnect:${channelId}`}
                  onClick={() => void disconnect(channelId)}
                  data-track-category='workspace-management'
                  data-track-name='DISCONNECT_SERVICE_ACCOUNT_CHANNEL'
                >
                  <Trash2 className='h-4 w-4' /> Disconnect
                </Button>
              </div>
            ))}
          </section>

          <section className='space-y-2'>
            <div className='flex flex-wrap items-center justify-between gap-2'>
              <h4 className='text-sm font-semibold'>Keys</h4>
              <div className='flex items-center gap-2'>
                <SegmentedToggle<(typeof KEY_LIFETIMES)[number]>
                  options={KEY_LIFETIMES.map(days => ({ value: days, label: `${days} days` }))}
                  value={keyDays}
                  onChange={setKeyDays}
                />
                <Button
                  variant='outline'
                  loading={busy === 'key'}
                  onClick={() => void createKey()}
                  data-track-category='workspace-management'
                  data-track-name='CREATE_SERVICE_ACCOUNT_KEY'
                >
                  <KeyRound className='h-4 w-4' /> Create key
                </Button>
              </div>
            </div>

            {newKey && (
              <div className='space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200'>
                <p className='font-medium'>Copy this key now. You won&apos;t see it again.</p>
                <div className='flex gap-2'>
                  <Input readOnly value={newKey.key} className='font-mono' />
                  <Button
                    variant='outline'
                    onClick={() => {
                      void navigator.clipboard.writeText(newKey.key);
                      toast.success('Key copied');
                    }}
                  >
                    <Copy className='h-4 w-4' /> Copy
                  </Button>
                </div>
                <div className='flex items-center justify-between'>
                  <span>Expires {formatDate(newKey.expiresAt)}</span>
                  <Button variant='outline' onClick={() => setNewKey(null)}>
                    Done
                  </Button>
                </div>
              </div>
            )}

            {keys.length === 0 ? (
              <p className='text-sm text-muted-foreground'>No keys yet.</p>
            ) : (
              keys.map(key => (
                <div key={key.id} className='flex items-center justify-between text-sm'>
                  <span className='text-muted-foreground'>
                    Created {formatDate(key.createdAt)} ·{' '}
                    {key.status === 'REVOKED'
                      ? `Revoked ${key.revokedAt ? formatDate(key.revokedAt) : ''}`
                      : `Expires ${formatDate(key.expiresAt)} · ${
                          key.lastUsedAt ? `Last used ${formatDate(key.lastUsedAt)}` : 'Never used'
                        }`}
                  </span>
                  {key.status === 'ACTIVE' && (
                    <Button
                      variant='outline'
                      loading={busy === `revoke:${key.id}`}
                      onClick={() => void revokeKey(key.id)}
                      data-track-category='workspace-management'
                      data-track-name='REVOKE_SERVICE_ACCOUNT_KEY'
                    >
                      Revoke
                    </Button>
                  )}
                </div>
              ))
            )}
          </section>
        </div>
      )}
    </div>
  );
}
