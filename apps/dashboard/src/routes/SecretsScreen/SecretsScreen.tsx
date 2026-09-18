import { ReactElement, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import Input from '../../components/ui/Input';
import { Table } from '../../components/ui/Table';
import type { ColumnDef } from '../../components/ui/Table/Table.types';
import { secretsVaultApi, type SecretSummary } from '../../api/secretsVaultApi';

const SECRETS_QUERY_KEY = ['secrets-vault'];

function AddSecretDialog(): ReactElement {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const queryClient = useQueryClient();

  const createMutation = useMutation({
    mutationFn: () => secretsVaultApi.createSecret(name.trim(), value),
    onSuccess: () => {
      toast.success(`Secret "${name.trim()}" created`);
      setOpen(false);
      setName('');
      setValue('');
      void queryClient.invalidateQueries({ queryKey: SECRETS_QUERY_KEY });
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : 'Failed to create secret';
      toast.error(message);
    },
  });

  const canSubmit = name.trim().length > 0 && value.trim().length > 0;

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title='Add secret'
      trigger={<Button trackId='secrets_add_open'>Add secret</Button>}
    >
      <form
        className='flex flex-col gap-4 p-6'
        onSubmit={event => {
          event.preventDefault();
          if (canSubmit) createMutation.mutate();
        }}
      >
        <div className='flex flex-col gap-1.5'>
          <label htmlFor='secret-name' className='text-sm font-medium'>
            Name
          </label>
          <Input
            id='secret-name'
            placeholder='e.g. cloudpulse-reader'
            value={name}
            onChange={e => setName(e.target.value)}
            autoComplete='off'
          />
          <p className='text-xs text-muted-foreground'>
            Must already be registered in the secretConfig registry.
          </p>
        </div>
        <div className='flex flex-col gap-1.5'>
          <label htmlFor='secret-value' className='text-sm font-medium'>
            Value
          </label>
          <textarea
            id='secret-value'
            className='min-h-24 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/10 focus-visible:ring-[2px]'
            placeholder='Paste the current key/credential value'
            value={value}
            onChange={e => setValue(e.target.value)}
            data-track-category='SECRETS'
            data-track-name='SECRET_VALUE_INPUT'
          />
        </div>
        <div className='flex justify-end gap-2'>
          <Button
            type='button'
            variant='outline'
            onClick={() => setOpen(false)}
            trackId='secrets_add_cancel'
          >
            Cancel
          </Button>
          <Button
            type='submit'
            disabled={!canSubmit}
            loading={createMutation.isPending}
            trackId='secrets_add_submit'
          >
            Create
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

const columns: ColumnDef<SecretSummary>[] = [
  { field: 'name', header: 'Name' },
  { field: 'rotationState', header: 'Rotation state' },
  {
    field: 'liveVersion',
    header: 'Live version',
    renderCell: (_value, row) => (row.liveVersion ? `v${row.liveVersion.version}` : '—'),
  },
  {
    field: 'liveVersion',
    header: 'Encryption',
    renderCell: (_value, row) => row.liveVersion?.encryptionImpl ?? '—',
  },
  {
    field: 'createdAt',
    header: 'Created',
    renderCell: (_value, row) => new Date(row.createdAt).toLocaleString(),
  },
  { field: 'createdBy', header: 'Created by' },
];

const SecretsScreen = (): ReactElement => {
  const { data, isLoading, isError } = useQuery({
    queryKey: SECRETS_QUERY_KEY,
    queryFn: secretsVaultApi.listSecrets,
  });

  return (
    <div className='flex flex-col gap-4 p-6'>
      <div className='flex items-center justify-between'>
        <div>
          <h1 className='text-lg font-semibold'>Secrets</h1>
          <p className='text-sm text-muted-foreground'>
            s2s / service credentials. Values are never shown here — this is metadata only.
          </p>
        </div>
        <AddSecretDialog />
      </div>

      <Table<SecretSummary>
        data={data ?? []}
        columns={columns}
        idField='id'
        isLoading={isLoading}
        errorState={isError ? <span>Failed to load secrets.</span> : undefined}
        emptyState={<span>No secrets yet.</span>}
        variant='bordered'
      />
    </div>
  );
};

export default SecretsScreen;
