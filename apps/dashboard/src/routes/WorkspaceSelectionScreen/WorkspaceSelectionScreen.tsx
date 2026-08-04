import { ReactElement, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Cookies from 'js-cookie';
import { AxiosError } from 'axios';
import { ArrowRight, Building2, Loader2, LogOut, Plus, Users, X } from 'lucide-react';
import { apiInstance } from '../../services/clients/apiClient';
import { useAuth } from '../../hooks/useAuth';
import type { Workspace } from '../../machines/authMachine';

interface WorkspaceWithMeta extends Workspace {
  isApprovedRequest?: boolean;
}

interface WorkspaceSelectionState {
  workspaces?: WorkspaceWithMeta[];
  email?: string;
  name?: string;
  picture?: string;
}

const WORKSPACE_COLORS = [
  'bg-[#fd6b6b]',
  'bg-[#57ab02]',
  'bg-[#27699d]',
  'bg-[#f49b35]',
  'bg-[#8b5cf6]',
  'bg-[#14b8a6]',
];

const getWorkspaceColor = (name: string): string => {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % WORKSPACE_COLORS.length;
  return WORKSPACE_COLORS[index]!;
};

const getInitials = (name: string): string => {
  const cleaned = name.trim();
  if (!cleaned) return 'W';
  const parts = cleaned.split(/\s+/).filter(Boolean);
  const first = parts[0]?.charAt(0).toUpperCase() ?? '';
  const second = parts[1]?.charAt(0).toUpperCase() ?? '';
  return first + second || first || 'W';
};

export const WorkspaceSelectionScreen = (): ReactElement => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();

  const [workspaces, setWorkspaces] = useState<WorkspaceWithMeta[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string>('');
  const [switchingToId, setSwitchingToId] = useState<string | null>(null);

  const [isCreating, setIsCreating] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const [createError, setCreateError] = useState('');

  const routeState = location.state as WorkspaceSelectionState | null;

  const email = user?.email || routeState?.email || '';
  const name = user?.name || routeState?.name || '';
  const picture = user?.picture || routeState?.picture || '';

  useEffect(() => {
    if (routeState?.workspaces?.length) {
      setWorkspaces(routeState.workspaces);
      setIsLoading(false);
      return;
    }

    const loadWorkspaces = async (): Promise<void> => {
      try {
        const response = await apiInstance.get<{ workspaces: WorkspaceWithMeta[] }>(
          '/auth/workspaces',
        );
        setWorkspaces(response.data.workspaces || []);
      } catch (err) {
        if (err instanceof AxiosError && err.response?.status === 401) {
          void navigate('/auth', { replace: true });
          return;
        }
        setError('Failed to load workspaces. Please try again.');
      } finally {
        setIsLoading(false);
      }
    };

    void loadWorkspaces();
  }, [navigate, routeState]);

  const sortedWorkspaces = useMemo(() => {
    return [...workspaces].sort((a, b) => {
      if (a.isApprovedRequest && !b.isApprovedRequest) return 1;
      if (!a.isApprovedRequest && b.isApprovedRequest) return -1;
      return a.name.localeCompare(b.name);
    });
  }, [workspaces]);

  const handleSelectWorkspace = async (workspaceId: string): Promise<void> => {
    setSwitchingToId(workspaceId);
    setError('');
    try {
      const response = await apiInstance.post<{
        user?: { id: string; workspaceId?: string };
        selfDmChannelId?: string | null;
      }>('/auth/login-workspace', { workspaceId });

      const targetWorkspaceId = response.data.user?.workspaceId || workspaceId;
      localStorage.setItem('user_id', response.data.user?.id ?? '');
      window.location.href = `/${targetWorkspaceId}/chat/dir`;
    } catch (err) {
      if (err instanceof AxiosError) {
        const msg = (err.response?.data as { message?: string } | undefined)?.message;
        setError(msg ?? 'Failed to switch workspace.');
      } else {
        setError('Failed to switch workspace.');
      }
      setSwitchingToId(null);
    }
  };

  const handleCreateWorkspace = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!newWorkspaceName.trim()) return;

    setIsCreating(true);
    setCreateError('');
    try {
      const response = await apiInstance.post<{ user: { workspaceId: string; id: string } }>(
        '/auth/create-workspace-pending',
        { workspaceName: newWorkspaceName.trim(), workspaceType: 'ENTERPRISE' },
      );
      const newWorkspaceId = response.data.user.workspaceId;
      localStorage.setItem('user_id', response.data.user.id);
      window.location.href = `/${newWorkspaceId}/chat/dir`;
    } catch (err) {
      if (err instanceof AxiosError) {
        const msg = (err.response?.data as { message?: string } | undefined)?.message;
        setCreateError(msg ?? 'Failed to create workspace.');
      } else {
        setCreateError('Failed to create workspace.');
      }
    } finally {
      setIsCreating(false);
    }
  };

  const handleTryDifferentAccount = (): void => {
    Cookies.remove('user_data');
    Cookies.remove('user_name');
    Cookies.remove('user_email');
    Cookies.remove('user_session_id');
    localStorage.clear();
    logout();
    window.location.href = '/auth';
  };

  const formatMemberCount = (count?: number): string => {
    if (count === undefined || count === null) return '';
    return count === 1 ? '1 member' : `${count} members`;
  };

  if (isLoading) {
    return (
      <div className='min-h-screen flex items-center justify-center bg-background/60 backdrop-blur-sm'>
        <div className='flex flex-col items-center gap-3'>
          <Loader2 className='w-8 h-8 animate-spin text-[hsl(var(--primary))]' />
          <p className='text-sm text-muted-foreground'>Loading your workspaces...</p>
        </div>
      </div>
    );
  }

  return (
    <div className='min-h-screen w-full flex items-center justify-center p-4 sm:p-6 lg:p-8'>
      <div className='w-full max-w-2xl'>
        <div
          className='rounded-3xl border border-border/80 bg-card/95 shadow-[0_24px_80px_-16px_rgba(0,0,0,0.12)] backdrop-blur-xl overflow-hidden'
          style={{
            boxShadow:
              '0 24px 80px -16px rgba(0,0,0,0.12), 0 8px 24px -8px rgba(0,0,0,0.08), inset 0 1px 0 0 rgba(255,255,255,0.6)',
          }}
        >
          {/* Header */}
          <div className='relative px-8 pt-10 pb-8 border-b border-border/60 bg-gradient-to-b from-muted/40 to-transparent'>
            <div className='flex flex-col items-center text-center'>
              <div className='mb-5 relative'>
                <div className='absolute inset-0 rounded-2xl bg-[hsl(var(--primary))]/20 blur-2xl transform translate-y-2' />
                <img
                  src='/svgs/xyne.svg'
                  alt='Xyne Spaces'
                  className='relative h-10 w-auto drop-shadow-sm'
                />
              </div>
              <h1 className='text-2xl sm:text-3xl font-semibold tracking-tight text-foreground'>
                Welcome back{name ? `, ${name.split(' ')[0]}` : ''}
              </h1>
              <p className='mt-2 text-sm text-muted-foreground'>
                Choose a workspace to get started
              </p>
            </div>
          </div>

          {/* Body */}
          <div className='px-6 py-8 sm:px-8'>
            {error ? (
              <div className='mb-6 rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-center text-sm text-destructive'>
                {error}
              </div>
            ) : null}

            {sortedWorkspaces.length === 0 ? (
              <div className='text-center py-10'>
                <div className='mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-muted'>
                  <Building2 className='h-6 w-6 text-muted-foreground' />
                </div>
                <h3 className='text-base font-medium text-foreground'>No workspaces found</h3>
                <p className='mt-1 text-sm text-muted-foreground'>
                  Create a new workspace to get started.
                </p>
              </div>
            ) : (
              <div className='flex flex-col gap-3'>
                {sortedWorkspaces.map(workspace => {
                  const colorClass = getWorkspaceColor(workspace.name);
                  const isSwitching = switchingToId === workspace.id;

                  return (
                    <button
                      key={workspace.id}
                      type='button'
                      disabled={isSwitching || Boolean(switchingToId)}
                      data-track-category='WORKSPACE_SELECTION'
                      data-track-name='SelectWorkspace'
                      onClick={() => {
                        void handleSelectWorkspace(workspace.id);
                      }}
                      className='group relative flex items-center gap-4 w-full rounded-2xl border border-border/70 bg-background/60 p-4 text-left transition-all duration-200 hover:border-[hsl(var(--primary))]/40 hover:bg-accent/60 hover:shadow-[0_8px_24px_-8px_rgba(0,0,0,0.08)] hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-60 disabled:cursor-not-allowed'
                    >
                      <div
                        className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${colorClass} text-white text-sm font-bold shadow-sm`}
                      >
                        {getInitials(workspace.name)}
                      </div>

                      <div className='min-w-0 flex-1'>
                        <div className='flex items-center gap-2'>
                          <h3 className='truncate text-base font-semibold text-foreground'>
                            {workspace.name}
                          </h3>
                          {workspace.isApprovedRequest ? (
                            <span className='inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-700'>
                              Approved
                            </span>
                          ) : null}
                        </div>
                        <p className='mt-0.5 flex items-center gap-2 text-xs text-muted-foreground'>
                          <Building2 className='h-3 w-3' />
                          <span className='truncate'>
                            {workspace.orgName || 'Your organization'}
                          </span>
                          {workspace.memberCount !== undefined && workspace.memberCount > 0 ? (
                            <>
                              <span className='text-border'>·</span>
                              <Users className='h-3 w-3' />
                              <span>{formatMemberCount(workspace.memberCount)}</span>
                            </>
                          ) : null}
                        </p>
                      </div>

                      <div className='flex items-center gap-3'>
                        <span className='hidden sm:inline-flex items-center rounded-full bg-muted px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground'>
                          {workspace.role}
                        </span>
                        {isSwitching ? (
                          <Loader2 className='h-5 w-5 animate-spin text-muted-foreground' />
                        ) : (
                          <ArrowRight className='h-5 w-5 text-muted-foreground/50 transition-all duration-200 group-hover:text-[hsl(var(--primary))] group-hover:translate-x-0.5' />
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Create workspace section */}
            <div className='mt-8 pt-6 border-t border-border/60'>
              {showCreateForm ? (
                <form
                  onSubmit={e => {
                    void handleCreateWorkspace(e);
                  }}
                  className='animate-in fade-in slide-in-from-top-2 duration-200'
                >
                  {createError ? (
                    <div className='mb-3 rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive'>
                      {createError}
                    </div>
                  ) : null}
                  <label
                    htmlFor='newWorkspaceName'
                    className='block text-sm font-medium text-foreground mb-2'
                  >
                    Create a new workspace
                  </label>
                  <div className='flex gap-2'>
                    <input
                      id='newWorkspaceName'
                      type='text'
                      data-track-category='WORKSPACE_SELECTION'
                      data-track-name='EnterWorkspaceName'
                      value={newWorkspaceName}
                      onChange={e => setNewWorkspaceName(e.target.value)}
                      placeholder='e.g. Engineering, Design, Sales'
                      className='flex-1 rounded-xl border border-border bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/30 focus:border-[hsl(var(--primary))]/40'
                      disabled={isCreating}
                      autoFocus
                    />
                    <button
                      type='submit'
                      disabled={isCreating || !newWorkspaceName.trim()}
                      className='inline-flex items-center gap-1.5 rounded-xl bg-[hsl(var(--foreground))] px-4 py-2.5 text-sm font-medium text-[hsl(var(--background))] hover:bg-[hsl(var(--foreground))]/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors'
                    >
                      {isCreating ? (
                        <Loader2 className='h-4 w-4 animate-spin' />
                      ) : (
                        <Plus className='h-4 w-4' />
                      )}
                      Create
                    </button>
                    <button
                      type='button'
                      data-track-category='WORKSPACE_SELECTION'
                      data-track-name='CancelCreateWorkspace'
                      onClick={() => {
                        setShowCreateForm(false);
                        setNewWorkspaceName('');
                        setCreateError('');
                      }}
                      disabled={isCreating}
                      className='inline-flex items-center justify-center rounded-xl border border-border p-2.5 text-muted-foreground hover:bg-accent disabled:opacity-50'
                      aria-label='Cancel'
                    >
                      <X className='h-4 w-4' />
                    </button>
                  </div>
                </form>
              ) : (
                <button
                  type='button'
                  data-track-category='WORKSPACE_SELECTION'
                  data-track-name='ShowCreateWorkspaceForm'
                  onClick={() => setShowCreateForm(true)}
                  className='group flex w-full items-center gap-3 rounded-2xl border border-dashed border-border bg-transparent p-4 text-left transition-colors hover:border-[hsl(var(--primary))]/40 hover:bg-accent/40'
                >
                  <div className='flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-border bg-background text-muted-foreground group-hover:border-[hsl(var(--primary))]/30 group-hover:text-[hsl(var(--primary))]'>
                    <Plus className='h-5 w-5' />
                  </div>
                  <div className='flex-1'>
                    <p className='text-sm font-medium text-foreground'>Create a new workspace</p>
                    <p className='text-xs text-muted-foreground'>
                      Start a new team within your organization
                    </p>
                  </div>
                  <ArrowRight className='h-5 w-5 text-muted-foreground/50 group-hover:text-[hsl(var(--primary))] group-hover:translate-x-0.5 transition-all' />
                </button>
              )}
            </div>

            {/* Footer */}
            <div className='mt-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-center sm:text-left'>
              <div className='flex items-center gap-3'>
                {picture ? (
                  <img
                    src={picture}
                    alt=''
                    className='h-9 w-9 rounded-full border border-border object-cover'
                  />
                ) : (
                  <div className='flex h-9 w-9 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground'>
                    {getInitials(name || email)}
                  </div>
                )}
                <div className='min-w-0'>
                  <p className='text-xs text-muted-foreground'>Signed in as</p>
                  <p className='truncate text-sm font-medium text-foreground'>{email}</p>
                </div>
              </div>

              <button
                type='button'
                data-track-category='WORKSPACE_SELECTION'
                data-track-name='TryDifferentAccount'
                onClick={handleTryDifferentAccount}
                className='inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors'
              >
                <LogOut className='h-4 w-4' />
                Try a different account
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default WorkspaceSelectionScreen;
