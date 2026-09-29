import { ReactElement, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { secretsVaultApi, type SecretVersionDetail } from '../../api/secretsVaultApi';

const SECRETS_QUERY_KEY = ['secrets-vault'];
const versionsQueryKey = (name: string): (string | undefined)[] => [
  'secrets-vault',
  name,
  'versions',
];

function statusBadgeClass(status: string): string {
  switch (status) {
    case 'active':
      return 'bg-green-500/15 text-green-600 dark:text-green-400';
    case 'revoked':
    case 'failed':
      return 'bg-destructive/15 text-destructive';
    default:
      return 'bg-muted text-muted-foreground';
  }
}

/** Row for one historical version: rollback (if not active) or force-revoke (if active). */
function VersionRow({
  name,
  version,
}: {
  name: string;
  version: SecretVersionDetail;
}): ReactElement {
  const [confirming, setConfirming] = useState(false);
  const queryClient = useQueryClient();

  const invalidateAll = (): void => {
    void queryClient.invalidateQueries({ queryKey: SECRETS_QUERY_KEY });
    void queryClient.invalidateQueries({ queryKey: versionsQueryKey(name) });
  };

  const rollbackMutation = useMutation({
    mutationFn: () => secretsVaultApi.rollbackSecret(name, version.version),
    onSuccess: result => {
      toast.success(`Rolled back "${name}" — new version v${result.version} is now active`);
      setConfirming(false);
      invalidateAll();
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Rollback failed');
      setConfirming(false);
    },
  });

  const revokeMutation = useMutation({
    mutationFn: () => secretsVaultApi.revokeSecret(name, version.version),
    onSuccess: () => {
      toast.success(
        `Revoked v${version.version} of "${name}" — no version is active until you rotate or roll back`,
      );
      setConfirming(false);
      invalidateAll();
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Revoke failed');
      setConfirming(false);
    },
  });

  const isActive = version.status === 'active';
  const isPending = rollbackMutation.isPending || revokeMutation.isPending;

  return (
    <div className='flex items-center justify-between gap-3 border-b border-border py-2 last:border-b-0'>
      <div className='flex flex-col gap-0.5'>
        <div className='flex items-center gap-2'>
          <span className='font-medium'>v{version.version}</span>
          <span className={`rounded px-1.5 py-0.5 text-xs ${statusBadgeClass(version.status)}`}>
            {version.status}
          </span>
        </div>
        <span className='text-xs text-muted-foreground'>
          Created {new Date(version.createdAt).toLocaleString()}
          {version.verifiedAt ? ` · Verified ${new Date(version.verifiedAt).toLocaleString()}` : ''}
          {version.retiredAt ? ` · Retired ${new Date(version.retiredAt).toLocaleString()}` : ''}
        </span>
      </div>

      {confirming ? (
        <div className='flex items-center gap-2'>
          <span className='whitespace-nowrap text-xs text-muted-foreground'>
            {isActive ? 'Revoke — nothing will replace it' : `Roll back to v${version.version}?`}
          </span>
          <Button
            size='sm'
            variant='destructive'
            loading={isPending}
            onClick={() => (isActive ? revokeMutation.mutate() : rollbackMutation.mutate())}
            trackId={isActive ? 'secrets_revoke_confirm' : 'secrets_rollback_confirm'}
          >
            Confirm
          </Button>
          <Button
            size='sm'
            variant='outline'
            onClick={() => setConfirming(false)}
            trackId='secrets_version_action_cancel'
          >
            Cancel
          </Button>
        </div>
      ) : isActive ? (
        <Button
          size='sm'
          variant='destructive'
          onClick={() => setConfirming(true)}
          trackId='secrets_revoke_open'
        >
          Force revoke
        </Button>
      ) : (
        <Button
          size='sm'
          variant='outline'
          onClick={() => setConfirming(true)}
          trackId='secrets_rollback_open'
        >
          Roll back to this
        </Button>
      )}
    </div>
  );
}

function RotateForm({ name }: { name: string }): ReactElement {
  const [value, setValue] = useState('');
  const queryClient = useQueryClient();

  const rotateMutation = useMutation({
    mutationFn: () => secretsVaultApi.rotateSecret(name, value),
    onSuccess: result => {
      toast.success(`Rotated "${name}" — version v${result.version} is now active`);
      setValue('');
      void queryClient.invalidateQueries({ queryKey: SECRETS_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: versionsQueryKey(name) });
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Rotation failed');
    },
  });

  return (
    <form
      className='flex flex-col gap-2'
      onSubmit={event => {
        event.preventDefault();
        if (value.trim()) rotateMutation.mutate();
      }}
    >
      <label htmlFor={`rotate-value-${name}`} className='text-sm font-medium'>
        Rotate to a new value
      </label>
      <textarea
        id={`rotate-value-${name}`}
        className='min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/10 focus-visible:ring-[2px]'
        placeholder='Paste the new key/credential value — it will be verified before going live'
        value={value}
        onChange={e => setValue(e.target.value)}
        data-track-category='SECRETS'
        data-track-name='SECRET_ROTATE_VALUE_INPUT'
      />
      <div>
        <Button
          type='submit'
          size='sm'
          disabled={!value.trim()}
          loading={rotateMutation.isPending}
          trackId='secrets_rotate_submit'
        >
          Rotate
        </Button>
      </div>
    </form>
  );
}

export function SecretDetailDialog({ name }: { name: string }): ReactElement {
  const [open, setOpen] = useState(false);

  const { data: versions, isLoading } = useQuery({
    queryKey: versionsQueryKey(name),
    queryFn: () => secretsVaultApi.listVersions(name),
    enabled: open,
  });

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title={`Manage ${name}`}
      trigger={
        <Button size='sm' variant='outline' trackId='secrets_manage_open'>
          Manage
        </Button>
      }
      className='max-w-2xl'
    >
      <div className='flex flex-col gap-4 p-6'>
        <h2 className='text-base font-semibold'>{name}</h2>

        <div>
          <h3 className='mb-1 text-sm font-medium'>Version history</h3>
          {isLoading ? (
            <p className='text-sm text-muted-foreground'>Loading…</p>
          ) : !versions || versions.length === 0 ? (
            <p className='text-sm text-muted-foreground'>No versions yet.</p>
          ) : (
            <div className='flex flex-col'>
              {versions.map(version => (
                <VersionRow key={version.version} name={name} version={version} />
              ))}
            </div>
          )}
        </div>

        <div className='border-t border-border pt-4'>
          <RotateForm name={name} />
        </div>
      </div>
    </Dialog>
  );
}
