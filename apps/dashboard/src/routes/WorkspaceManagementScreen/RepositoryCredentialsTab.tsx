import { ReactElement, useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Github, KeyRound, ShieldAlert, Unplug } from 'lucide-react';
import { WorkspaceRole } from '@xyne/shared';
import { toast } from 'sonner';
import { Button } from '../../components/ui/Button/Button';
import Input from '../../components/ui/Input/Input';
import { useSelf } from '../../hooks/useUsers';
import { apiInstance } from '../../services/clients/apiClient';

interface CredentialMetadata {
  provider: 'GITHUB';
  status: string;
  revision: number;
  identityLogin: string | null;
  resourceOwner: string | null;
  fingerprint: string | null;
  validationStatus: string;
  validatedAt: string | null;
  validationErrorCode: string | null;
  validationErrorMessage: string | null;
  attachedRepositoryCount: number;
  canManage: boolean;
}

export function RepositoryCredentialsTab({ isActive }: { isActive: boolean }): ReactElement {
  const self = useSelf();
  const [credential, setCredential] = useState<CredentialMetadata | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [token, setToken] = useState('');
  const [resourceOwner, setResourceOwner] = useState('');
  const canManage = self?.role === WorkspaceRole.OWNER || self?.role === WorkspaceRole.ADMIN;

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const response = await apiInstance.get<{ credentials: CredentialMetadata[] }>(
        '/sdlc/vcs/credentials',
      );
      setCredential(response.data.credentials.find(item => item.provider === 'GITHUB') ?? null);
    } catch {
      toast.error('Could not load repository credential settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isActive) void load();
  }, [isActive, load]);

  const save = async (): Promise<void> => {
    if (!token.trim() || !resourceOwner.trim()) return;
    setBusy('save');
    try {
      await apiInstance.put('/sdlc/vcs/credentials/github', {
        token: token.trim(),
        resourceOwner: resourceOwner.trim(),
      });
      setToken('');
      toast.success('GitHub credential validated and saved');
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'GitHub credential validation failed');
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async (): Promise<void> => {
    if (
      !window.confirm(
        'Disconnect the workspace GitHub credential? Private repository access and Start Work will be blocked until another credential is validated.',
      )
    )
      return;
    setBusy('disconnect');
    try {
      await apiInstance.delete('/sdlc/vcs/credentials/github');
      toast.success('GitHub credential disconnected');
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not disconnect credential');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className='space-y-4'>
      <div>
        <h2 className='text-lg font-semibold text-foreground'>Repository credentials</h2>
        <p className='text-sm text-muted-foreground'>
          One workspace credential powers private repository checks, clone, feature-branch push, and
          draft pull requests.
        </p>
      </div>

      <div className='rounded-xl border border-border bg-card p-6 shadow-sm'>
        <div className='flex items-start justify-between gap-4'>
          <div className='flex items-start gap-3'>
            <div className='rounded-lg bg-muted p-2'>
              <Github className='h-5 w-5' />
            </div>
            <div>
              <h3 className='font-semibold'>GitHub.com</h3>
              <p className='text-sm text-muted-foreground'>Fine-grained personal access token</p>
            </div>
          </div>
          {credential?.status === 'CONNECTED' && (
            <span
              className={
                credential.validationStatus === 'VALID'
                  ? 'inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                  : 'inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-1 text-xs font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-300'
              }
            >
              <CheckCircle2 className='h-3.5 w-3.5' />
              {credential.validationStatus === 'VALID' ? 'Connected' : 'Replace key'}
            </span>
          )}
        </div>

        {loading ? (
          <p className='mt-6 text-sm text-muted-foreground'>Loading credential status…</p>
        ) : credential?.status === 'CONNECTED' ? (
          <div className='mt-6 space-y-4'>
            <dl className='grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4'>
              <Metadata label='Identity' value={credential.identityLogin || 'Unknown'} />
              <Metadata label='Resource owner' value={credential.resourceOwner || 'Unknown'} />
              <Metadata label='Fingerprint' value={credential.fingerprint || 'Unavailable'} />
              <Metadata label='Attached repos' value={String(credential.attachedRepositoryCount)} />
            </dl>
            <p className='text-xs text-muted-foreground'>
              {credential.validationStatus === 'VALID'
                ? 'Validated once and active until GitHub rejects it, it is replaced, or it is disconnected'
                : `Validation: ${credential.validationStatus.toLowerCase()}`}
              {credential.validatedAt
                ? ` · ${new Date(credential.validatedAt).toLocaleString()}`
                : ''}
            </p>
            {credential.validationErrorMessage && (
              <div className='flex gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200'>
                <ShieldAlert className='mt-0.5 h-4 w-4 shrink-0' />
                {credential.validationErrorMessage}
              </div>
            )}
            {canManage ? (
              <div className='flex flex-wrap gap-2'>
                <Button
                  variant='outline'
                  onClick={() => setCredential({ ...credential, status: 'REPLACING' })}
                  data-track-category='workspace-management'
                  data-track-name='REPLACE_GITHUB_CREDENTIAL'
                >
                  <KeyRound className='h-4 w-4' /> Replace
                </Button>
                <Button
                  variant='outline'
                  loading={busy === 'disconnect'}
                  onClick={() => void disconnect()}
                  data-track-category='workspace-management'
                  data-track-name='DISCONNECT_GITHUB_CREDENTIAL'
                >
                  <Unplug className='h-4 w-4' /> Disconnect
                </Button>
              </div>
            ) : (
              <p className='text-sm text-muted-foreground'>
                Ask a workspace admin to replace this credential.
              </p>
            )}
          </div>
        ) : canManage ? (
          <CredentialForm
            token={token}
            resourceOwner={resourceOwner}
            replacing={credential?.status === 'REPLACING'}
            busy={busy === 'save'}
            onToken={setToken}
            onOwner={setResourceOwner}
            onSubmit={() => void save()}
          />
        ) : (
          <div className='mt-6 rounded-lg border border-dashed p-4 text-sm text-muted-foreground'>
            No GitHub credential connected. Ask a workspace admin to configure one here.
          </div>
        )}
      </div>
    </div>
  );
}

function CredentialForm(props: {
  token: string;
  resourceOwner: string;
  replacing: boolean;
  busy: boolean;
  onToken: (value: string) => void;
  onOwner: (value: string) => void;
  onSubmit: () => void;
}): ReactElement {
  return (
    <form
      className='mt-6 space-y-4'
      onSubmit={event => {
        event.preventDefault();
        props.onSubmit();
      }}
    >
      <div className='rounded-lg bg-muted p-4 text-sm text-muted-foreground'>
        Create one fine-grained PAT for one GitHub resource owner. Grant repository{' '}
        <strong>Contents: read/write</strong>, <strong>Pull requests: read/write</strong>, and{' '}
        <strong>Workflows: read/write</strong>. GitHub requires Workflows permission when a task
        changes files under <code>.github/workflows</code>. Metadata read access is added
        automatically. Do not grant administration or branch-protection bypass.
      </div>
      <div className='grid gap-4 sm:grid-cols-2'>
        <label className='text-sm font-medium' htmlFor='sdlc-vcs-resource-owner'>
          Resource owner
          <Input
            id='sdlc-vcs-resource-owner'
            className='mt-2'
            value={props.resourceOwner}
            onChange={event => props.onOwner(event.target.value)}
            placeholder='github-org-or-user'
            data-track-category='workspace-management'
            data-track-name='EDIT_GITHUB_RESOURCE_OWNER'
            required
          />
        </label>
        <label className='text-sm font-medium' htmlFor='sdlc-vcs-token'>
          Fine-grained PAT
          <Input
            id='sdlc-vcs-token'
            className='mt-2'
            type='password'
            value={props.token}
            onChange={event => props.onToken(event.target.value)}
            placeholder='github_pat_••••••••'
            autoComplete='new-password'
            required
          />
        </label>
      </div>
      <Button
        type='submit'
        loading={props.busy}
        disabled={!props.token.trim() || !props.resourceOwner.trim()}
        data-track-category='workspace-management'
        data-track-name='SAVE_GITHUB_CREDENTIAL'
      >
        Validate and save
      </Button>
      {props.replacing && (
        <p className='text-xs text-muted-foreground'>
          Existing credential stays active unless replacement validates.
        </p>
      )}
    </form>
  );
}

function Metadata({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div>
      <dt className='text-muted-foreground'>{label}</dt>
      <dd className='mt-1 font-medium'>{value}</dd>
    </div>
  );
}
