import { logger, Event as LogEvent } from '../../utils/logger';
import React, { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import { Plus, Check, Loader2, LogIn, ChevronDown, ChevronRight } from 'lucide-react';
import { WorkspaceType } from '@xyne/shared';
import { API_BASE_URL } from '../../config';
import {
  getLastActiveWorkspaceId,
  getLastActiveWorkspaceName,
  setLastActiveWorkspaceName,
  setLastActiveWorkspaceId,
} from '../../machines/authMachine';
import { queryClient } from '../../services/clients/queryClient';
import { useCanCreateWorkspace } from '../../hooks/usePermissions';
import { confirmRecordingInterrupt } from '../Recording/RecordingInterruptGuard/RecordingInterruptGuard';

type CreateWorkspaceType = (typeof WorkspaceType)[keyof typeof WorkspaceType];

interface WorkspaceItem {
  id: string;
  name: string;
  role: string;
  orgName: string;
}

interface WorkspacesResponse {
  workspaces: WorkspaceItem[];
}

interface WorkspaceCountItem {
  workspaceId: string;
  userId: string;
  count: number;
}

interface WorkspaceCountsResponse {
  counts: WorkspaceCountItem[];
}

interface CreateWorkspaceResponse {
  workspace: { id: string; name: string };
  user: { id: string; email: string; name: string; workspaceId: string };
}

export const WorkspaceSwitcher: React.FC = () => {
  const { workspaceId } = useParams<{ workspaceId?: string }>();
  const canCreateWorkspace = useCanCreateWorkspace();

  // Read initial name from user-bound localStorage so the button renders immediately without an API call
  const [localWorkspaceName, setLocalWorkspaceName] = useState<string>(() => {
    const email = localStorage.getItem('user_email');
    return email ? (getLastActiveWorkspaceName(email) ?? '') : '';
  });

  const [isOpen, setIsOpen] = useState(false);
  const [workspaces, setWorkspaces] = useState<WorkspaceItem[]>([]);
  const [activityCounts, setActivityCounts] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showSignInList, setShowSignInList] = useState(false);
  const [workspaceName, setWorkspaceName] = useState('');
  const [createWorkspaceType, setCreateWorkspaceType] = useState<CreateWorkspaceType>(
    WorkspaceType.ENTERPRISE,
  );
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const popoverRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const currentWorkspace = workspaces.find(w => w.id === workspaceId);

  // Keep localWorkspaceName in sync once workspaces are loaded
  useEffect(() => {
    if (currentWorkspace) {
      setLocalWorkspaceName(currentWorkspace.name);
      const email = localStorage.getItem('user_email');
      if (email) {
        setLastActiveWorkspaceName(email, currentWorkspace.name);
      }
    }
  }, [currentWorkspace]);

  const fetchWorkspaces = async (): Promise<void> => {
    setLoading(true);
    try {
      const res = await axios.get<WorkspacesResponse>(`${API_BASE_URL}/auth/workspaces`, {
        withCredentials: true,
      });
      setWorkspaces(res.data.workspaces);
    } catch {
      // silently ignore — user can retry by closing and reopening
    } finally {
      setLoading(false);
    }
  };

  const fetchActivityCounts = async (): Promise<void> => {
    try {
      const res = await axios.get<WorkspaceCountsResponse>(
        `${API_BASE_URL}/activity/workspace-counts`,
        { withCredentials: true },
      );
      const counts = new Map<string, number>();

      for (const item of res.data.counts) {
        counts.set(item.workspaceId, item.count);
      }

      setActivityCounts(counts);
    } catch {
      // silently ignore
    }
  };

  // Force fetch when the URL's workspaceId no longer matches the cached one —
  // handles external redirects (e.g. cross-workspace notification click) that
  // change the URL without going through the switcher's own update path.
  useEffect(() => {
    if (!workspaceId) return;
    const email = localStorage.getItem('user_email');
    const cachedId = email ? getLastActiveWorkspaceId(email) : null;
    const idMismatch = !!cachedId && cachedId !== workspaceId;
    if (localWorkspaceName && !idMismatch) return;
    void (async () => {
      try {
        const res = await axios.get<WorkspacesResponse>(`${API_BASE_URL}/auth/workspaces`, {
          withCredentials: true,
        });
        const match = res.data.workspaces.find(w => w.id === workspaceId);
        if (match) {
          setLocalWorkspaceName(match.name);
          if (email) {
            setLastActiveWorkspaceName(email, match.name);
            setLastActiveWorkspaceId(email, match.id);
          }
          setWorkspaces(res.data.workspaces);
        }
      } catch {
        // ignore
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (isOpen) {
      void fetchWorkspaces();
      void fetchActivityCounts();
    } else {
      setShowCreateForm(false);
      setShowSignInList(false);
      setWorkspaceName('');
      setCreateWorkspaceType(WorkspaceType.ENTERPRISE);
      setError(null);
    }
  }, [isOpen]);

  // Fetch activity counts on mount so badge is visible immediately
  useEffect(() => {
    void fetchActivityCounts();
  }, []);

  // Poll activity counts every 30s to keep badge fresh
  useEffect(() => {
    const interval = setInterval(() => {
      void fetchActivityCounts();
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (e: MouseEvent): void => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isOpen]);

  const handleSwitch = async (targetWorkspaceId: string): Promise<void> => {
    if (targetWorkspaceId === workspaceId) {
      setIsOpen(false);
      return;
    }
    if (!(await confirmRecordingInterrupt('workspaceSwitch'))) return;
    setSwitching(targetWorkspaceId);
    try {
      // NEW: Call switch-workspace API instead of logout
      await axios.post(
        `${API_BASE_URL}/auth/switch-workspace`,
        { workspaceId: targetWorkspaceId },
        { withCredentials: true },
      );

      // Store the target workspace in localStorage (user-bound)
      const email = localStorage.getItem('user_email');
      if (email) {
        setLastActiveWorkspaceId(email, targetWorkspaceId);
        const switchedWs = workspaces.find(w => w.id === targetWorkspaceId);
        if (switchedWs) setLastActiveWorkspaceName(email, switchedWs.name);
      }

      setIsOpen(false);
      // Clear query cache to prevent stale data from previous workspace
      queryClient.clear();
      // Navigate to new workspace
      window.location.href = `/${targetWorkspaceId}/chat/dir`;
    } catch (err) {
      setError('Failed to switch workspace. Please try again.');
      logger.error(LogEvent.FRONTEND_ERROR, {
        type: 'migrated_console_error',
        message: String('[WorkspaceSwitcher] Switch failed:'),
        error: err,
      });
    } finally {
      setSwitching(null);
    }
  };

  const handleCreate = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!workspaceName.trim()) return;
    if (!(await confirmRecordingInterrupt('workspaceSwitch'))) return;
    setCreating(true);
    setError(null);
    try {
      const res = await axios.post<CreateWorkspaceResponse>(
        `${API_BASE_URL}/auth/create-workspace`,
        { workspaceName: workspaceName.trim(), workspaceType: createWorkspaceType },
        { withCredentials: true },
      );
      const newWorkspaceId = res.data.user.workspaceId;
      const email = res.data.user.email;
      // Store user-bound workspace data
      if (email) {
        setLastActiveWorkspaceId(email, newWorkspaceId);
        setLastActiveWorkspaceName(email, workspaceName.trim());
      }
      localStorage.setItem('user_id', res.data.user.id);
      setIsOpen(false);
      window.location.href = `/${newWorkspaceId}/chat/dir`;
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const msg = (err.response?.data as { message?: string } | undefined)?.message;
        setError(msg ?? 'Failed to create workspace.');
      } else {
        setError('Failed to create workspace.');
      }
    } finally {
      setCreating(false);
    }
  };

  // Deterministic color from workspace name
  const getInitialColor = (name: string): string => {
    const colors = [
      '#e05d44',
      '#e07b44',
      '#c0a030',
      '#4caf50',
      '#2196f3',
      '#9c27b0',
      '#e91e63',
      '#00bcd4',
      '#ff5722',
      '#607d8b',
    ];
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length]!;
  };

  // Use loaded workspace name first, fall back to localStorage value
  const displayName = currentWorkspace?.name ?? localWorkspaceName;
  const initial = displayName?.[0]?.toUpperCase() ?? '?';
  const bgColor = displayName ? getInitialColor(displayName) : '#607d8b';

  // Show only the active workspace's unread count on the switcher trigger.
  const totalUnread = workspaceId ? (activityCounts.get(workspaceId) ?? 0) : 0;
  const createLabel = 'Create enterprise workspace';

  return (
    <div className='relative'>
      {/* Trigger: shows initials with deterministic color */}
      <button
        ref={triggerRef}
        onClick={() => setIsOpen(prev => !prev)}
        className='size-8 rounded-lg flex items-center justify-center text-white text-xs font-bold cursor-pointer hover:opacity-85 transition-opacity relative'
        style={{ backgroundColor: bgColor }}
        aria-label='Switch workspace'
        data-testid='workspace-switcher-trigger'
        data-track-category='Workspace_Switcher'
        data-track-name='Open_Switcher'
        title={displayName || 'Workspace'}
      >
        {initial}
        {totalUnread > 0 && (
          <span className='absolute -top-1 -right-1 min-w-[16px] h-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1'>
            {totalUnread > 99 ? '99+' : totalUnread}
          </span>
        )}
      </button>

      {isOpen && (
        <div
          ref={popoverRef}
          className='absolute left-full top-0 ml-2 z-[60] w-64 rounded-xl border border-border bg-background shadow-xl'
        >
          {/* Header */}
          <div className='px-3 pt-3 pb-1'>
            <p className='text-xs font-semibold text-muted-foreground uppercase tracking-wider'>
              Workspaces
            </p>
          </div>

          {/* Workspace list */}
          <div className='max-h-56 overflow-y-auto py-1'>
            {loading ? (
              <div className='flex items-center justify-center py-4'>
                <Loader2 size={16} className='animate-spin text-muted-foreground' />
              </div>
            ) : workspaces.length === 0 ? (
              <p className='text-xs text-muted-foreground px-3 py-2'>No workspaces found.</p>
            ) : (
              workspaces.map(ws => {
                const isActive = ws.id === workspaceId;
                const isSwitching = switching === ws.id;
                const count = activityCounts.get(ws.id) || 0;
                return (
                  <button
                    key={ws.id}
                    onClick={() => void handleSwitch(ws.id)}
                    data-ph-capture-attribute-track-id='switch_workspace'
                    disabled={isSwitching}
                    data-track-category='Workspace_Switcher'
                    data-track-name='Switch_Workspace'
                    className='h-auto w-full flex items-center justify-start gap-2.5 px-3 py-2 rounded-none hover:bg-muted transition-colors text-left disabled:opacity-60'
                  >
                    {/* Workspace icon with deterministic color */}
                    <div
                      className='size-7 rounded-md flex items-center justify-center text-white text-xs font-bold shrink-0'
                      style={{ backgroundColor: getInitialColor(ws.name) }}
                    >
                      {ws.name[0]?.toUpperCase() ?? '?'}
                    </div>
                    <div className='flex-1 min-w-0'>
                      <p className='text-sm font-medium text-foreground truncate'>{ws.name}</p>
                      <p className='text-xs text-muted-foreground truncate'>{ws.orgName}</p>
                    </div>
                    <div className='flex items-center gap-1.5 shrink-0'>
                      {count > 0 && (
                        <span className='min-w-[18px] h-[18px] bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1'>
                          {count > 99 ? '99+' : count}
                        </span>
                      )}
                      {isSwitching ? (
                        <Loader2 size={14} className='animate-spin text-muted-foreground' />
                      ) : isActive ? (
                        <Check size={14} className='text-green-500' />
                      ) : null}
                    </div>
                  </button>
                );
              })
            )}
          </div>

          <div className='border-t border-border' />

          {/* Add a workspace — hidden for members without create permission */}
          {canCreateWorkspace && (
            <div className='py-1'>
              <p className='px-3 pt-2 pb-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider'>
                Add a workspace
              </p>

              {/* Sign in to another workspace — expands list of user's workspaces */}
              <button
                onClick={() => setShowSignInList(prev => !prev)}
                data-track-category='Workspace_Switcher'
                data-track-name='Sign_In_Another_Workspace'
                className='w-full flex items-center gap-3 px-3 py-2.5 hover:bg-muted transition-colors text-left'
              >
                <div className='size-7 rounded-md flex items-center justify-center bg-muted shrink-0'>
                  <LogIn size={14} className='text-foreground' />
                </div>
                <span className='text-sm text-foreground flex-1'>Sign in to another workspace</span>
                {showSignInList ? (
                  <ChevronDown size={14} className='text-muted-foreground shrink-0' />
                ) : (
                  <ChevronRight size={14} className='text-muted-foreground shrink-0' />
                )}
              </button>

              {showSignInList && (
                <div className='ml-4 border-l border-border pl-2 pb-1'>
                  {loading ? (
                    <div className='flex items-center justify-center py-3'>
                      <Loader2 size={14} className='animate-spin text-muted-foreground' />
                    </div>
                  ) : workspaces.length === 0 ? (
                    <p className='text-xs text-muted-foreground px-2 py-2'>
                      No other workspaces found.
                    </p>
                  ) : (
                    workspaces.map(ws => {
                      const isActive = ws.id === workspaceId;
                      const isSwitching = switching === ws.id;
                      const count = activityCounts.get(ws.id) || 0;
                      return (
                        <button
                          key={ws.id}
                          onClick={() => void handleSwitch(ws.id)}
                          data-ph-capture-attribute-track-id='switch_workspace_signin'
                          disabled={isSwitching}
                          data-track-category='Workspace_Switcher'
                          data-track-name='Switch_Workspace_SignIn'
                          className='h-auto w-full flex items-center justify-start gap-2 px-2 py-1.5 hover:bg-muted transition-colors text-left rounded-md disabled:opacity-60'
                        >
                          <div
                            className='size-6 rounded flex items-center justify-center text-white text-xs font-bold shrink-0'
                            style={{ backgroundColor: getInitialColor(ws.name) }}
                          >
                            {ws.name[0]?.toUpperCase() ?? '?'}
                          </div>
                          <div className='flex-1 min-w-0'>
                            <p className='text-xs font-medium text-foreground truncate'>
                              {ws.name}
                            </p>
                            <p className='text-xs text-muted-foreground truncate'>{ws.orgName}</p>
                          </div>
                          <div className='flex items-center gap-1 shrink-0'>
                            {count > 0 && (
                              <span className='min-w-[16px] h-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1'>
                                {count > 99 ? '99+' : count}
                              </span>
                            )}
                            {isSwitching ? (
                              <Loader2 size={12} className='animate-spin text-muted-foreground' />
                            ) : isActive ? (
                              <Check size={12} className='text-green-500' />
                            ) : null}
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              )}

              {/* Create a new workspace */}
              {showCreateForm ? (
                <form
                  onSubmit={e => void handleCreate(e)}
                  className='px-3 pb-3 pt-1 flex flex-col gap-2'
                >
                  {error && <p className='text-xs text-red-500'>{error}</p>}
                  <p className='text-xs font-medium text-foreground'>{createLabel}</p>
                  <input
                    type='text'
                    placeholder='Workspace name'
                    value={workspaceName}
                    onChange={e => setWorkspaceName(e.target.value)}
                    data-track-category='Workspace_Switcher'
                    data-track-name='Workspace_Name_Input'
                    className='w-full px-2 py-1.5 text-sm border border-border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-ring'
                    required
                    // eslint-disable-next-line jsx-a11y/no-autofocus
                    autoFocus
                  />
                  <div className='flex gap-2'>
                    <button
                      type='submit'
                      data-ph-capture-attribute-track-id='create_workspace'
                      disabled={creating || !workspaceName.trim()}
                      data-track-category='Workspace_Switcher'
                      data-track-name='Create_Workspace'
                      className='h-auto flex-1 py-1.5 text-xs font-medium bg-primary text-primary-foreground rounded-md disabled:opacity-50 hover:bg-primary hover:opacity-90'
                    >
                      {creating ? 'Creating…' : 'Create'}
                    </button>
                    <button
                      type='button'
                      onClick={() => {
                        setShowCreateForm(false);
                        setCreateWorkspaceType(WorkspaceType.ENTERPRISE);
                        setError(null);
                      }}
                      data-track-category='Workspace_Switcher'
                      data-track-name='Cancel_Create_Workspace'
                      className='flex-1 py-1.5 text-xs font-medium border border-border rounded-md hover:bg-muted'
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <div className='flex flex-col'>
                  <button
                    onClick={() => {
                      setCreateWorkspaceType(WorkspaceType.ENTERPRISE);
                      setShowCreateForm(true);
                    }}
                    data-track-category='Workspace_Switcher'
                    data-track-name='Show_Create_Workspace_Form'
                    className='w-full flex items-center gap-3 px-3 py-2.5 hover:bg-muted transition-colors text-left'
                  >
                    <div className='size-7 rounded-md flex items-center justify-center bg-muted shrink-0'>
                      <Plus size={14} className='text-foreground' />
                    </div>
                    <span className='text-sm text-foreground'>Create enterprise workspace</span>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
