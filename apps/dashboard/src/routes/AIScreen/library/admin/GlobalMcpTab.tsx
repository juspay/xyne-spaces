import { useState, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { DeleteDustbin01, KeySlant } from '@xyne/icons';
import { Pill } from '../shared/primitives/Pill';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Skeleton } from '@/components/ui/Skeleton';
import { Switch } from '@/components/ui/Switch';
import { ConfirmDialog } from '@/components/ClawAgents/ConfirmDialog';
import { clawErrorText } from '@/services/claw/clawRequest';
import {
  deleteMcpGlobalCredentials,
  getMcpGlobalCredentials,
  listAdminMcpServers,
  listCredentialFields,
  setMcpGlobalCredentials,
  setMcpGlobalFallback,
} from '@/services/claw/clawAdminService';
import type { AdminMcpServerSummary, CredentialField } from '@/services/claw/clawAdminTypes';
import { TabMessage } from './components/TabMessage';
import { AdminToolbarPortal } from './components/AdminToolbarSlot';
import { AdminSearchField } from './components/AdminSearchField';
import { HighlightMatch } from './components/HighlightMatch';
import { credentialFieldsKey, globalMcpKey } from './hooks/adminQueryKeys';

function CredentialsForm({
  userId,
  server,
  fields,
  onSaved,
  onCancel,
}: {
  userId: string;
  server: AdminMcpServerSummary;
  fields: readonly CredentialField[];
  onSaved: () => void;
  onCancel: () => void;
}): ReactElement {
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState('');

  const { data: existing } = useQuery({
    queryKey: [...globalMcpKey(), 'creds', server.type],
    queryFn: () => getMcpGlobalCredentials(userId, server.type),
    enabled: Boolean(userId),
  });

  const save = useMutation({
    mutationFn: () => setMcpGlobalCredentials(userId, server.type, values),
    onSuccess: () => {
      toast.success('Global credentials saved');
      onSaved();
    },
    onError: err => setError(clawErrorText(err, 'Could not save credentials')),
  });

  const submit = (): void => {
    const missing = fields.filter(field => !field.optional && !values[field.name]?.trim());
    if (missing.length > 0) {
      setError(`Required: ${missing.map(field => field.label).join(', ')}`);
      return;
    }
    setError('');
    save.mutate();
  };

  const existingKeys = existing?.credentialKeys ?? [];

  return (
    <div className='border-t border-border bg-muted/40 px-1 py-4'>
      {fields.length === 0 ? (
        <p className='text-xs text-muted-foreground'>
          No connector definition found for <span className='font-mono'>{server.type}</span> —
          credential schema is unavailable on this server.
        </p>
      ) : (
        <>
          {existingKeys.length > 0 && (
            <p className='mb-3 px-3 text-xs text-muted-foreground'>
              Replacing existing creds:{' '}
              <span className='font-mono text-foreground'>{existingKeys.join(', ')}</span>. Saving
              overwrites all fields.
            </p>
          )}
          <div className='flex flex-col gap-3'>
            {fields.map(field => (
              <label key={field.name} className='flex flex-col gap-2'>
                <span className='px-3 text-xs font-medium text-foreground'>
                  {field.label}
                  {!field.optional && <span className='text-destructive'> *</span>}
                </span>
                <Input
                  type={field.type === 'password' ? 'password' : 'text'}
                  placeholder={field.placeholder}
                  value={values[field.name] ?? ''}
                  onChange={event =>
                    setValues(current => ({ ...current, [field.name]: event.target.value }))
                  }
                  spellCheck={false}
                  autoComplete={field.type === 'password' ? 'new-password' : 'off'}
                  data-1p-ignore
                  data-lpignore='true'
                  data-bwignore='true'
                />
              </label>
            ))}
          </div>
        </>
      )}

      {error && <p className='mt-3 px-3 text-xs text-destructive'>{error}</p>}

      <div className='mt-4 flex items-center justify-end gap-2'>
        <Button
          type='button'
          variant='ghost'
          disabled={save.isPending}
          onClick={onCancel}
          data-track-category='Claw Admin'
          data-track-name='Cancel global MCP credentials'
        >
          Cancel
        </Button>
        <Button
          type='button'
          disabled={save.isPending || fields.length === 0}
          onClick={submit}
          data-track-category='Claw Admin'
          data-track-name='Save global MCP credentials'
        >
          Save credentials
        </Button>
      </div>
    </div>
  );
}

export function GlobalMcpTab({ userId }: { userId: string }): ReactElement {
  const queryClient = useQueryClient();
  const [openForm, setOpenForm] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminMcpServerSummary | null>(null);
  const [query, setQuery] = useState('');

  const {
    data: servers,
    isPending,
    isError,
  } = useQuery({
    queryKey: globalMcpKey(),
    queryFn: () => listAdminMcpServers(userId),
    enabled: Boolean(userId),
  });

  const { data: fieldsByType } = useQuery({
    queryKey: credentialFieldsKey(),
    queryFn: () => listCredentialFields(),
    staleTime: 5 * 60 * 1000,
  });

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: globalMcpKey() });
  };

  const toggleFallback = useMutation({
    mutationFn: ({ type, allow }: { type: string; allow: boolean }) =>
      setMcpGlobalFallback(userId, type, allow),
    onSuccess: refresh,
    onError: error => toast.error(clawErrorText(error, 'Could not update fallback')),
  });

  const deleteCreds = useMutation({
    mutationFn: (type: string) => deleteMcpGlobalCredentials(userId, type),
    onSuccess: () => {
      toast.success('Global credentials removed');
      setDeleteTarget(null);
      refresh();
    },
    onError: error => toast.error(clawErrorText(error, 'Could not remove credentials')),
  });

  const searchBar = (
    <AdminToolbarPortal>
      <AdminSearchField
        value={query}
        onChange={setQuery}
        placeholder='Search MCP servers'
        ariaLabel='Search MCP servers'
        trackName='Admin: search global MCP servers'
        className='w-full'
      />
    </AdminToolbarPortal>
  );

  if (isPending)
    return (
      <>
        {searchBar}
        <Skeleton className='mt-4 h-32 w-full' />
      </>
    );
  if (isError)
    return (
      <>
        {searchBar}
        <TabMessage>Couldn’t load MCP servers.</TabMessage>
      </>
    );
  if (!servers || servers.length === 0)
    return (
      <>
        {searchBar}
        <TabMessage>No MCP servers registered.</TabMessage>
      </>
    );

  const needle = query.trim().toLowerCase();
  const visibleServers = needle
    ? servers.filter((server: AdminMcpServerSummary) =>
        `${server.name} ${server.type}`.toLowerCase().includes(needle),
      )
    : servers;

  return (
    <div className='flex min-h-0 flex-1 flex-col gap-6 overflow-auto'>
      {searchBar}

      {visibleServers.length === 0 ? (
        <TabMessage>No MCP servers match your search.</TabMessage>
      ) : (
        <ul className='flex flex-col'>
          {visibleServers.map((server: AdminMcpServerSummary) => {
            const fields = fieldsByType?.[server.type] ?? [];
            const formOpen = openForm === server.type;

            return (
              <li key={server.id} className='border-b border-border last:border-b-0'>
                <div className='flex items-center justify-between gap-3 px-1 py-4'>
                  <div className='flex min-w-0 flex-1 items-center gap-3'>
                    <div className='flex min-w-0 flex-wrap items-center gap-2'>
                      <span className='truncate text-sm font-medium text-foreground'>
                        <HighlightMatch text={server.name} query={query} />
                      </span>
                      <Pill tone={server.hasGlobalCredentials ? 'success' : 'neutral'}>
                        {server.hasGlobalCredentials ? 'Creds set' : 'No creds'}
                      </Pill>
                    </div>
                  </div>

                  <div className='flex shrink-0 items-center gap-2'>
                    <Switch
                      checked={server.allowGlobalFallback}
                      onCheckedChange={allow => toggleFallback.mutate({ type: server.type, allow })}
                      aria-label={`Allow fallback for ${server.name}`}
                    />
                    <span className='text-xs text-muted-foreground'>Allow fallback</span>
                  </div>

                  <Button
                    type='button'
                    variant='ghost'
                    size='sm'
                    className='text-muted-foreground hover:text-foreground focus-visible:bg-muted focus-visible:ring-0'
                    onClick={() => setOpenForm(formOpen ? null : server.type)}
                    data-track-category='Claw Admin'
                    data-track-name='Toggle global MCP credentials form'
                  >
                    <KeySlant className='size-4' />
                    {server.hasGlobalCredentials ? 'Update creds' : 'Set creds'}
                  </Button>

                  {server.hasGlobalCredentials && (
                    <Button
                      type='button'
                      variant='ghost'
                      size='sm'
                      aria-label='Delete global credentials'
                      className='text-muted-foreground hover:text-foreground focus-visible:bg-muted focus-visible:ring-0'
                      onClick={() => setDeleteTarget(server)}
                      data-track-category='Claw Admin'
                      data-track-name='Delete global MCP credentials'
                    >
                      <DeleteDustbin01 className='size-4' />
                      Delete creds
                    </Button>
                  )}
                </div>

                {formOpen && (
                  <CredentialsForm
                    userId={userId}
                    server={server}
                    fields={fields}
                    onSaved={() => {
                      setOpenForm(null);
                      refresh();
                    }}
                    onCancel={() => setOpenForm(null)}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={open => {
          if (!open) setDeleteTarget(null);
        }}
        title='Remove global credentials?'
        description={
          deleteTarget ? `${deleteTarget.name} will fall back to per-user auth only.` : undefined
        }
        confirmLabel='Remove'
        danger
        loading={deleteCreds.isPending}
        onConfirm={() => {
          if (deleteTarget) deleteCreds.mutate(deleteTarget.type);
        }}
      />
    </div>
  );
}
