import { ReactElement, useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, GitBranch, Lock, RefreshCw } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '../../components/ui/Button';
import { apiInstance } from '../../services/clients/apiClient';

interface Capability {
  capability?: string;
  state?: string;
  detail?: string;
}

interface ProjectRepository {
  id: string;
  name: string;
  url: string;
  provider: string;
  visibility: string | null;
  configuredBaseBranch: string | null;
  accessJobStatus: string;
  accessCapabilities: unknown;
  accessJobErrorMessage: string | null;
  setupExecution: { status: string } | null;
}

export function ProjectRepositoriesSection(props: {
  projectId: string;
  refreshKey: number;
  onAdd: () => void;
}): ReactElement {
  const navigate = useNavigate();
  const { workspaceId } = useParams<{ workspaceId?: string }>();
  const [repositories, setRepositories] = useState<ProjectRepository[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState<string | null>(null);

  const load = useCallback(
    async (quiet = false): Promise<void> => {
      if (!quiet) setLoading(true);
      try {
        const response = await apiInstance.get<{ repositories: ProjectRepository[] }>(
          `/sdlc/projects/${encodeURIComponent(props.projectId)}/repositories`,
        );
        setRepositories(response.data.repositories);
        setError(null);
      } catch {
        setError('Could not load project repositories');
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [props.projectId],
  );

  useEffect(() => {
    void load();
  }, [load, props.refreshKey]);

  const check = async (repoId: string): Promise<void> => {
    setChecking(repoId);
    try {
      const response = await apiInstance.post<{ status: string; errorMessage: string | null }>(
        `/sdlc/repositories/${repoId}/access-check`,
        { force: true },
      );
      if (response.data.status === 'READY') toast.success('Repository access is ready');
      else toast.error(response.data.errorMessage || 'Repository access is not available');
      await load(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not run access check');
    } finally {
      setChecking(null);
    }
  };

  if (loading)
    return <p className='py-10 text-center text-sm text-muted-foreground'>Loading repositories…</p>;
  if (error) {
    return (
      <div className='rounded-lg border border-destructive/30 p-6 text-center'>
        <p className='text-sm text-destructive'>{error}</p>
        <Button
          className='mt-3'
          variant='outline'
          onClick={() => void load()}
          data-track-category='ProjectRepos'
          data-track-name='RetryLoadRepositories'
        >
          Retry
        </Button>
      </div>
    );
  }
  if (repositories.length === 0) {
    return (
      <div className='rounded-lg border border-dashed p-10 text-center'>
        <GitBranch className='mx-auto h-8 w-8 text-muted-foreground' />
        <h3 className='mt-3 font-semibold'>No repositories attached</h3>
        <p className='mt-1 text-sm text-muted-foreground'>
          Attach a public or private GitHub.com repository.
        </p>
        <Button
          className='mt-4'
          onClick={props.onAdd}
          data-track-category='ProjectRepos'
          data-track-name='AddRepositoryClicked'
        >
          Add Repository
        </Button>
      </div>
    );
  }

  return (
    <div className='space-y-3'>
      {repositories.map(repo => (
        <RepositoryCard
          key={repo.id}
          repository={repo}
          checking={checking === repo.id}
          onCheck={() => void check(repo.id)}
          onSettings={() =>
            void navigate(
              workspaceId
                ? `/${workspaceId}/workspace-management?tab=repository-credentials`
                : '/workspace-management?tab=repository-credentials',
            )
          }
        />
      ))}
    </div>
  );
}

function RepositoryCard(props: {
  repository: ProjectRepository;
  checking: boolean;
  onCheck: () => void;
  onSettings: () => void;
}): ReactElement {
  const repo = props.repository;
  const capabilities = useMemo<Capability[]>(
    () => (Array.isArray(repo.accessCapabilities) ? (repo.accessCapabilities as Capability[]) : []),
    [repo.accessCapabilities],
  );
  return (
    <article className='rounded-lg border border-border p-5'>
      <div className='flex flex-wrap items-start justify-between gap-4'>
        <div>
          <div className='flex items-center gap-2'>
            <h3 className='font-semibold'>{repo.name}</h3>
            {repo.visibility === 'PRIVATE' && (
              <Lock className='h-3.5 w-3.5 text-muted-foreground' />
            )}
            <Status status={repo.accessJobStatus} />
          </div>
          <p className='mt-1 text-sm text-muted-foreground'>
            {repo.provider || 'GitHub'} · {repo.visibility?.toLowerCase() || 'visibility pending'} ·{' '}
            {repo.configuredBaseBranch || 'branch pending'}
          </p>
          <p className='mt-1 text-xs text-muted-foreground'>
            {props.checking
              ? 'Checking…'
              : repo.accessJobStatus === 'READY'
                ? 'Access ready'
                : 'Access check pending'}
          </p>
        </div>
        <div className='flex flex-wrap gap-2'>
          <Button
            variant='outline'
            loading={props.checking}
            onClick={props.onCheck}
            data-track-category='ProjectRepos'
            data-track-name='RunAccessCheck'
          >
            <RefreshCw className='h-4 w-4' /> Refresh now
          </Button>
        </div>
      </div>
      {capabilities.length > 0 && (
        <div className='mt-4 flex flex-wrap gap-2'>
          {capabilities.map(capability => (
            <span
              key={capability.capability}
              title={capability.detail}
              className='rounded-full border px-2 py-1 text-xs'
            >
              {capability.capability?.replaceAll('_', ' ')} · {capability.state?.toLowerCase()}
            </span>
          ))}
        </div>
      )}
      {repo.accessJobErrorMessage && (
        <div className='mt-4 flex items-start justify-between gap-3 rounded-md bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200'>
          <span className='flex gap-2'>
            <AlertCircle className='mt-0.5 h-4 w-4 shrink-0' />
            {repo.accessJobErrorMessage}
          </span>
          <button
            className='shrink-0 underline'
            onClick={props.onSettings}
            data-track-category='ProjectRepos'
            data-track-name='CredentialSettingsOpened'
          >
            Credential settings
          </button>
        </div>
      )}
    </article>
  );
}

function Status({ status }: { status: string }): ReactElement {
  const ready = status === 'READY';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${ready ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-muted text-muted-foreground'}`}
    >
      {ready ? <CheckCircle2 className='h-3 w-3' /> : null}
      {status.toLowerCase().replaceAll('_', ' ')}
    </span>
  );
}
