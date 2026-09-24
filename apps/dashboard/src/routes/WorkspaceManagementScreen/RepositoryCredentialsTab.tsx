import { ReactElement, useCallback, useEffect, useId, useState } from 'react';
import { CheckCircle2, GitBranch, Github, KeyRound, Plus, ShieldAlert, Trash2 } from 'lucide-react';
import { WorkspaceRole } from '@xyne/shared';
import { toast } from 'sonner';
import { Button } from '../../components/ui/Button/Button';
import Input from '../../components/ui/Input/Input';
import { SegmentedToggle } from '../../components/ui/SegmentedToggle';
import { useSelf } from '../../hooks/useUsers';
import { apiInstance } from '../../services/clients/apiClient';

type Provider = 'GITHUB' | 'BITBUCKET_SERVER';

interface CredentialMetadata {
  id: string;
  name: string;
  provider: Provider;
  host: string;
  status: string;
  identityLogin: string | null;
  accountName: string | null;
  accountEmail: string | null;
  linkedRepositoryCount: number;
  repositoryCount: number | null;
  validationStatus: string;
  validatedAt: string | null;
  validationErrorMessage: string | null;
}

const PROVIDER_LABEL: Record<Provider, string> = {
  GITHUB: 'GitHub',
  BITBUCKET_SERVER: 'Bitbucket',
};

function errorMessage(error: unknown, fallback: string): string {
  const response = (error as { response?: { data?: { error?: string; message?: string } } })
    ?.response?.data;
  return (
    response?.error || response?.message || (error instanceof Error ? error.message : fallback)
  );
}

export function RepositoryCredentialsTab({ isActive }: { isActive: boolean }): ReactElement {
  const self = useSelf();
  const [credentials, setCredentials] = useState<CredentialMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const canManage = self?.role === WorkspaceRole.OWNER || self?.role === WorkspaceRole.ADMIN;

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const response = await apiInstance.get<{ credentials: CredentialMetadata[] }>(
        '/sdlc/vcs/credentials',
      );
      setCredentials(response.data.credentials);
    } catch {
      toast.error('Could not load repository credential settings');
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
          <h2 className='text-lg font-semibold text-foreground'>Repository credentials</h2>
          <p className='text-sm text-muted-foreground'>
            Each repository uses one credential for clone, push and pull requests. Commits are made
            as the credential&apos;s account.
          </p>
        </div>
        {canManage && !adding && (
          <Button
            variant='outline'
            onClick={() => setAdding(true)}
            data-track-category='workspace-management'
            data-track-name='ADD_REPOSITORY_CREDENTIAL'
          >
            <Plus className='h-4 w-4' /> Add credential
          </Button>
        )}
      </div>

      {adding && (
        <AddCredentialForm
          onCancel={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            void load();
          }}
        />
      )}

      {loading ? (
        <p className='text-sm text-muted-foreground'>Loading credentials…</p>
      ) : credentials.length === 0 ? (
        <div className='rounded-lg border border-dashed p-4 text-sm text-muted-foreground'>
          {canManage
            ? 'No repository credentials yet. Add one for GitHub or a Bitbucket host.'
            : 'No repository credentials yet. Ask a workspace admin to add one.'}
        </div>
      ) : (
        credentials.map(credential => (
          <CredentialCard
            key={credential.id}
            credential={credential}
            canManage={canManage}
            onChanged={() => void load()}
          />
        ))
      )}
    </div>
  );
}

function CredentialCard(props: {
  credential: CredentialMetadata;
  canManage: boolean;
  onChanged: () => void;
}): ReactElement {
  const { credential } = props;
  const [replacing, setReplacing] = useState(false);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const valid = credential.status === 'CONNECTED' && credential.validationStatus === 'VALID';
  const Icon = credential.provider === 'GITHUB' ? Github : GitBranch;
  const tokenId = useId();

  const replace = async (): Promise<void> => {
    setBusy('replace');
    try {
      await apiInstance.patch(`/sdlc/vcs/credentials/${credential.id}`, { token: token.trim() });
      toast.success('Token validated and replaced');
      setToken('');
      setReplacing(false);
      props.onChanged();
    } catch (error) {
      toast.error(errorMessage(error, 'Token validation failed'));
    } finally {
      setBusy(null);
    }
  };

  const revalidate = async (): Promise<void> => {
    setBusy('validate');
    try {
      await apiInstance.post(`/sdlc/vcs/credentials/${credential.id}/validate`);
      toast.success('Credential is valid');
    } catch (error) {
      toast.error(errorMessage(error, 'Credential validation failed'));
    } finally {
      setBusy(null);
      props.onChanged();
    }
  };

  const remove = async (): Promise<void> => {
    const linked = credential.linkedRepositoryCount;
    if (
      !window.confirm(
        `Delete "${credential.name}"?${linked > 0 ? ` ${linked} repositor${linked === 1 ? 'y loses' : 'ies lose'} private access until a credential for ${credential.host} is added.` : ''}`,
      )
    )
      return;
    setBusy('delete');
    try {
      await apiInstance.delete(`/sdlc/vcs/credentials/${credential.id}`);
      toast.success('Credential deleted');
      props.onChanged();
    } catch (error) {
      toast.error(errorMessage(error, 'Could not delete credential'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className='rounded-xl border border-border bg-card p-6 shadow-sm'>
      <div className='flex items-start justify-between gap-4'>
        <div className='flex items-start gap-3'>
          <div className='rounded-lg bg-muted p-2'>
            <Icon className='h-5 w-5' />
          </div>
          <div>
            <h3 className='font-semibold'>{credential.name}</h3>
            <p className='text-sm text-muted-foreground'>
              {PROVIDER_LABEL[credential.provider]} · {credential.host}
            </p>
          </div>
        </div>
        <span
          className={
            valid
              ? 'inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
              : 'inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-1 text-xs font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-300'
          }
        >
          <CheckCircle2 className='h-3.5 w-3.5' />
          {valid ? 'Connected' : 'Replace token'}
        </span>
      </div>

      <dl className='mt-6 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3'>
        <Metadata
          label='Commits as'
          value={
            credential.accountName
              ? `${credential.accountName} <${credential.accountEmail ?? 'no email'}>`
              : credential.identityLogin || 'Resolved on first use'
          }
        />
        <Metadata
          label='Repos it can access'
          value={credential.repositoryCount?.toString() ?? 'Unknown'}
        />
        <Metadata label='Linked repositories' value={String(credential.linkedRepositoryCount)} />
      </dl>

      {credential.validationErrorMessage && (
        <div className='mt-4 flex gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200'>
          <ShieldAlert className='mt-0.5 h-4 w-4 shrink-0' />
          {credential.validationErrorMessage}
        </div>
      )}

      {props.canManage &&
        (replacing ? (
          <form
            className='mt-4 flex flex-wrap items-end gap-2'
            onSubmit={event => {
              event.preventDefault();
              void replace();
            }}
          >
            <label htmlFor={tokenId} className='min-w-64 flex-1 text-sm font-medium'>
              New token
              <Input
                id={tokenId}
                className='mt-2'
                type='password'
                value={token}
                onChange={event => setToken(event.target.value)}
                autoComplete='new-password'
                required
              />
            </label>
            <Button type='submit' loading={busy === 'replace'} disabled={!token.trim()}>
              Validate and replace
            </Button>
            <Button type='button' variant='outline' onClick={() => setReplacing(false)}>
              Cancel
            </Button>
          </form>
        ) : (
          <div className='mt-4 flex flex-wrap gap-2'>
            <Button
              variant='outline'
              onClick={() => setReplacing(true)}
              data-track-category='workspace-management'
              data-track-name='REPLACE_REPOSITORY_CREDENTIAL'
            >
              <KeyRound className='h-4 w-4' /> Replace token
            </Button>
            <Button
              variant='outline'
              loading={busy === 'validate'}
              onClick={() => void revalidate()}
              data-track-category='workspace-management'
              data-track-name='VALIDATE_REPOSITORY_CREDENTIAL'
            >
              <CheckCircle2 className='h-4 w-4' /> Revalidate
            </Button>
            <Button
              variant='outline'
              loading={busy === 'delete'}
              onClick={() => void remove()}
              data-track-category='workspace-management'
              data-track-name='DELETE_REPOSITORY_CREDENTIAL'
            >
              <Trash2 className='h-4 w-4' /> Delete
            </Button>
          </div>
        ))}
    </div>
  );
}

function AddCredentialForm(props: { onCancel: () => void; onSaved: () => void }): ReactElement {
  const [provider, setProvider] = useState<Provider>('GITHUB');
  const [name, setName] = useState('');
  const [host, setHost] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const fieldId = useId();

  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      await apiInstance.post('/sdlc/vcs/credentials', {
        provider,
        name: name.trim(),
        token: token.trim(),
        ...(provider === 'BITBUCKET_SERVER' ? { host: host.trim() } : {}),
      });
      toast.success(`${PROVIDER_LABEL[provider]} credential validated and saved`);
      props.onSaved();
    } catch (error) {
      toast.error(errorMessage(error, 'Credential validation failed'));
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
      <SegmentedToggle<Provider>
        options={[
          { value: 'GITHUB', label: 'GitHub' },
          { value: 'BITBUCKET_SERVER', label: 'Bitbucket' },
        ]}
        value={provider}
        onChange={setProvider}
      />
      <div className='rounded-lg bg-muted p-4 text-sm text-muted-foreground'>
        {provider === 'GITHUB' ? (
          <>
            Paste a fine-grained PAT. Grant repository <strong>Contents: read/write</strong>,{' '}
            <strong>Pull requests: read/write</strong>, and <strong>Workflows: read/write</strong>.
            Do not grant administration or branch-protection bypass.
          </>
        ) : (
          <>
            Paste a <strong>personal</strong> HTTP access token with{' '}
            <strong>Repository write</strong> permission. Project and repository tokens are rejected
            because commits need a real account with an email.
          </>
        )}
      </div>
      <div className='grid gap-4 sm:grid-cols-2'>
        <label htmlFor={`${fieldId}-name`} className='text-sm font-medium'>
          Name
          <Input
            id={`${fieldId}-name`}
            className='mt-2'
            value={name}
            onChange={event => setName(event.target.value)}
            placeholder={provider === 'GITHUB' ? 'GitHub bot' : 'Bitbucket LP team'}
            required
          />
        </label>
        {provider === 'BITBUCKET_SERVER' && (
          <label htmlFor={`${fieldId}-host`} className='text-sm font-medium'>
            Host
            <Input
              id={`${fieldId}-host`}
              className='mt-2'
              value={host}
              onChange={event => setHost(event.target.value)}
              placeholder='bitbucket.juspay.net'
              required
            />
          </label>
        )}
        <label htmlFor={`${fieldId}-token`} className='text-sm font-medium sm:col-span-2'>
          Token
          <Input
            id={`${fieldId}-token`}
            className='mt-2'
            type='password'
            value={token}
            onChange={event => setToken(event.target.value)}
            placeholder={provider === 'GITHUB' ? 'github_pat_••••••••' : '••••••••'}
            autoComplete='new-password'
            required
          />
        </label>
      </div>
      <div className='flex gap-2'>
        <Button
          type='submit'
          loading={busy}
          disabled={
            !name.trim() || !token.trim() || (provider === 'BITBUCKET_SERVER' && !host.trim())
          }
          data-track-category='workspace-management'
          data-track-name='SAVE_REPOSITORY_CREDENTIAL'
        >
          Validate and save
        </Button>
        <Button type='button' variant='outline' onClick={props.onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function Metadata({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div>
      <dt className='text-muted-foreground'>{label}</dt>
      <dd className='mt-1 break-all font-medium'>{value}</dd>
    </div>
  );
}
