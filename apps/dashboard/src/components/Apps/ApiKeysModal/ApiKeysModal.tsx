import { ReactElement, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, KeyRound, Trash2, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../../ui/Button/Button';
import Input from '../../ui/Input/Input';
import { SegmentedToggle } from '../../ui/SegmentedToggle/SegmentedToggle';
import {
  API_KEY_TTL_CHOICES,
  sdkKeysService,
  type ApiKeyTtlDays,
  type CreatedSdkApiKey,
  type SdkApiKey,
} from '../../../services/Apps/sdkKeysService';
import { daysLeft, formatDate } from './ApiKeysModal.utils';

const TTL_OPTIONS = API_KEY_TTL_CHOICES.map(days => ({
  value: String(days),
  label: `${days}d`,
}));

const QUERY_KEY = ['sdk-keys'] as const;

/**
 * Create and remove API keys for the Spaces SDK.
 *
 * The plaintext key is shown exactly once, at creation. The list afterwards
 * carries only the last four characters — enough to tell two keys apart when
 * deciding which to remove, and useless to anyone who sees the screen.
 *
 * Revoking a key stops it working on its very next request. The row stays in
 * the list, marked, rather than disappearing — it is the audit trail, and a
 * key that vanished would leave no way to see that it was ever revoked.
 *
 * `Dialog` renders its `title` and `description` hidden, for screen readers
 * only, so the visible heading belongs here.
 */
export const ApiKeysModal = (): ReactElement => {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [ttlDays, setTtlDays] = useState<ApiKeyTtlDays>(30);
  const [revealed, setRevealed] = useState<CreatedSdkApiKey | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmingRevoke, setConfirmingRevoke] = useState<string | null>(null);

  const keys = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => sdkKeysService.list(),
  });

  const createKey = useMutation({
    mutationFn: (input: { name: string; ttlDays: ApiKeyTtlDays }) =>
      sdkKeysService.create(input.name, input.ttlDays),
    onSuccess: created => {
      setRevealed(created);
      setName('');
      setCopied(false);
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
    onError: (error: Error) => {
      toast.error('Could not create the key', { description: error.message });
    },
  });

  const revokeKey = useMutation({
    mutationFn: (id: string) => sdkKeysService.revoke(id),
    onSuccess: () => {
      toast.success('Key revoked');
      setConfirmingRevoke(null);
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
    onError: (error: Error) => {
      toast.error('Could not revoke the key', { description: error.message });
    },
  });

  const rows: SdkApiKey[] = keys.data?.keys ?? [];
  const maxLiveKeys = keys.data?.maxLiveKeys ?? 2;
  // Mirrors the backend's live-key count: neither expiry nor revocation holds a slot.
  const liveCount = rows.filter(key => !key.expired && !key.revoked).length;
  const atLimit = liveCount >= maxLiveKeys;

  const copy = async (): Promise<void> => {
    if (!revealed) return;
    await navigator.clipboard.writeText(revealed.key);
    setCopied(true);
    toast.success('Key copied');
  };

  return (
    <div className='flex flex-col max-h-[85vh]'>
      <div className='px-6 pt-6'>
        <h2 className='text-lg font-bold text-foreground'>API keys</h2>
        <p className='mt-1 text-xs text-muted-foreground'>
          For the Spaces SDK. A key acts with your own permissions, in this workspace only.
        </p>
      </div>

      <div className='flex-1 overflow-y-auto p-6 space-y-4'>
        {revealed ? (
          <div className='rounded-lg border border-amber-500/40 bg-amber-500/5 p-4'>
            <div className='flex items-start gap-2'>
              <TriangleAlert size={16} className='mt-0.5 shrink-0 text-amber-500' />
              <div className='min-w-0 flex-1'>
                <p className='text-sm font-medium text-foreground'>
                  Copy this key now — it will not be shown again.
                </p>
                <p className='mt-1 text-xs text-muted-foreground'>
                  “{revealed.name}” expires {formatDate(revealed.expiresAt)}. If you lose it, revoke
                  it and create another.
                </p>
                <div className='mt-3 flex items-center gap-2'>
                  <code className='min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-md border border-border bg-background px-3 py-2 font-mono text-xs'>
                    {revealed.key}
                  </code>
                  <Button size='sm' variant='outline' onClick={() => void copy()}>
                    {copied ? <Check size={14} /> : <Copy size={14} />}
                  </Button>
                </div>
              </div>
            </div>
            <div className='mt-3 flex justify-end'>
              <Button size='sm' variant='ghost' onClick={() => setRevealed(null)}>
                Done
              </Button>
            </div>
          </div>
        ) : (
          <form
            className='space-y-3'
            onSubmit={event => {
              event.preventDefault();
              if (name.trim() && !atLimit) createKey.mutate({ name: name.trim(), ttlDays });
            }}
          >
            <div className='flex items-end gap-2'>
              <div className='flex-1'>
                <label htmlFor='sdk-key-name' className='block text-sm text-muted-foreground'>
                  Name
                </label>
                <Input
                  id='sdk-key-name'
                  value={name}
                  onChange={event => setName(event.target.value)}
                  placeholder='e.g. CI pipeline'
                  maxLength={80}
                  disabled={atLimit}
                  className='mt-1'
                />
              </div>
              <Button type='submit' disabled={!name.trim() || atLimit || createKey.isPending}>
                {createKey.isPending ? 'Creating…' : 'Create key'}
              </Button>
            </div>
            <div className='flex items-center gap-2'>
              <span className='text-sm text-muted-foreground'>Expires in</span>
              <SegmentedToggle
                options={TTL_OPTIONS}
                value={String(ttlDays)}
                onChange={value => setTtlDays(Number(value) as ApiKeyTtlDays)}
              />
            </div>
          </form>
        )}

        <p className='text-xs text-muted-foreground'>
          {atLimit
            ? `You have ${liveCount} of ${maxLiveKeys} active keys. Revoke one to create another.`
            : `You can hold ${maxLiveKeys} active keys at a time.`}
        </p>

        <div className='rounded-lg border border-border'>
          {keys.isLoading && (
            <p className='px-3 py-6 text-center text-sm text-muted-foreground'>Loading…</p>
          )}
          {keys.error && (
            <p className='px-3 py-6 text-center text-sm text-destructive'>
              Could not load your keys.
            </p>
          )}
          {!keys.isLoading && !keys.error && rows.length === 0 && (
            <div className='flex flex-col items-center gap-1 px-3 py-8 text-center'>
              <KeyRound size={20} className='text-muted-foreground' />
              <p className='text-sm text-muted-foreground'>No API keys yet</p>
            </div>
          )}
          <ul className='divide-y divide-border'>
            {rows.map(key => (
              <li key={key.id} className='flex items-center gap-3 px-3 py-2.5'>
                <div className='min-w-0 flex-1'>
                  <p className='truncate text-sm font-medium text-foreground'>{key.name}</p>
                  <p className='mt-0.5 text-xs text-muted-foreground'>
                    <span className='font-mono'>xyne_sk_…{key.hint}</span>
                    {' · created '}
                    {formatDate(key.createdAt)}
                  </p>
                </div>

                {confirmingRevoke === key.id ? (
                  <div className='flex shrink-0 items-center gap-1'>
                    <Button
                      size='sm'
                      variant='destructive'
                      disabled={revokeKey.isPending}
                      onClick={() => revokeKey.mutate(key.id)}
                    >
                      Revoke
                    </Button>
                    <Button size='sm' variant='ghost' onClick={() => setConfirmingRevoke(null)}>
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <>
                    {/* Revoked wins over expired: it is the deliberate act, and
                        the one worth showing when a key is both. */}
                    {key.revoked ? (
                      <span className='shrink-0 rounded-full bg-destructive/10 px-2 py-0.5 text-xs text-destructive'>
                        Revoked
                      </span>
                    ) : key.expired ? (
                      <span className='shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground'>
                        Expired
                      </span>
                    ) : (
                      <span className='shrink-0 text-xs text-muted-foreground'>
                        {daysLeft(key.expiresAt)}d left
                      </span>
                    )}
                    {/* Nothing to revoke on a key that is already dead either way. */}
                    {!key.revoked && !key.expired && (
                      <Button
                        size='sm'
                        variant='ghost'
                        aria-label={`Revoke ${key.name}`}
                        onClick={() => setConfirmingRevoke(key.id)}
                      >
                        <Trash2 size={14} />
                      </Button>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
};

export default ApiKeysModal;
