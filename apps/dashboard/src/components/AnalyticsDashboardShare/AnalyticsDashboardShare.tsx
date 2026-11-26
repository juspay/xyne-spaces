import { useMemo, useState, type ReactElement } from 'react';
import { toast } from 'sonner';
import * as Select from '@radix-ui/react-select';
import { Check, ChevronDown, Crown, Globe, Hash, Lock, X } from 'lucide-react';
import {
  ChannelScopeType,
  DashboardSharePrincipal,
  DashboardShareRole,
  type DashboardShare,
  type User,
} from '@xyne/shared';
import { useAuth } from '../../hooks/useAuth';
import { useUsers } from '../../hooks/useUsers';
import { useAllChannels } from '../../hooks/useChannels';
import { useHasResourceAccess } from '../../hooks/usePermissions';
import { usePlatform } from '../../hooks/usePlatform';
import {
  addDashboardShares,
  removeDashboardShare,
  updateDashboardShareRole,
  type ShareInput,
} from '../../services/AnalyticsDashboard/dashboardSharesService';
import { getApiErrorMessage } from '../../utils/apiError';
import Avatar from '../ui/Avatar/Avatar';
import { Button } from '../ui/Button';
import { SearchChannel, type SearchChannelItem } from '../ui/SearchChannel/SearchChannel';
import { SearchUser } from '../ui/SearchUser/SearchUser';
import type { AnalyticsDashboardShareProps } from './AnalyticsDashboardShare.types';
import { canEditDashboard, roleLabel, sortShares } from './AnalyticsDashboardShare.utils';

/**
 * Who an analytics dashboard is shared with: people (can edit / can view), channels (their
 * members can view) and, for analytics admins, the whole workspace. Shown to owners and editors.
 * The list updates through Zero after each change.
 */
export const AnalyticsDashboardShare = ({
  dashboard,
  shares,
  role,
}: AnalyticsDashboardShareProps): ReactElement => {
  const { user: currentUser } = useAuth();
  const { isMobile } = usePlatform();
  const isAnalyticsAdmin = useHasResourceAccess('ANALYTICS');
  const allUsers = useUsers();
  const allChannels = useAllChannels();
  const [selectedUsers, setSelectedUsers] = useState<User[]>([]);
  const [selectedChannels, setSelectedChannels] = useState<SearchChannelItem[]>([]);
  const [busy, setBusy] = useState(false);

  const canManage = canEditDashboard(role);

  const usersById = useMemo(() => new Map(allUsers.map(u => [u.id, u])), [allUsers]);
  const channelsById = useMemo(() => new Map(allChannels.map(c => [c.id, c])), [allChannels]);

  // Channels the sharer can see themselves; the server checks the same.
  const shareableChannels = useMemo(
    () =>
      allChannels
        .filter(
          c =>
            !c.isArchived &&
            c.scopeType !== ChannelScopeType.DM &&
            c.scopeType !== ChannelScopeType.GROUP_DM,
        )
        .map(c => ({ id: c.id, name: c.name, scopeType: c.scopeType })),
    [allChannels],
  );

  const sorted = useMemo(() => sortShares(shares), [shares]);
  const workspaceShare = shares.find(s => s.principalType === DashboardSharePrincipal.WORKSPACE);
  const sharedUserIds = shares
    .filter(s => s.principalType === DashboardSharePrincipal.USER)
    .map(s => s.principalId);
  const sharedChannelIds = shares
    .filter(s => s.principalType === DashboardSharePrincipal.CHANNEL)
    .map(s => s.principalId);

  const run = async (
    action: () => Promise<void>,
    failure: string,
    success?: string,
  ): Promise<boolean> => {
    setBusy(true);
    try {
      await action();
      if (success) toast.success(success);
      return true;
    } catch (err) {
      toast.error(failure, { description: getApiErrorMessage(err) });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const handleAdd = async (shareRole: DashboardShareRole): Promise<void> => {
    const inputs: ShareInput[] = [
      ...selectedUsers.map(u => ({
        principalType: DashboardSharePrincipal.USER,
        principalId: u.id,
        role: shareRole,
      })),
      // Channels can only view.
      ...selectedChannels.map(c => ({
        principalType: DashboardSharePrincipal.CHANNEL,
        principalId: c.id,
        role: DashboardShareRole.VIEWER,
      })),
    ];
    if (inputs.length === 0) return;
    const ok = await run(
      () => addDashboardShares(dashboard.id, inputs),
      'Could not share the dashboard',
      'Dashboard shared',
    );
    if (ok) {
      setSelectedUsers([]);
      setSelectedChannels([]);
    }
  };

  const handleWorkspaceToggle = (): void => {
    void run(
      () =>
        workspaceShare
          ? removeDashboardShare(dashboard.id, workspaceShare.id)
          : addDashboardShares(dashboard.id, [
              { principalType: DashboardSharePrincipal.WORKSPACE, role: DashboardShareRole.VIEWER },
            ]),
      'Could not change workspace access',
    );
  };

  const shareTitle = (s: DashboardShare): { name: string; detail: string; icon: ReactElement } => {
    if (s.principalType === DashboardSharePrincipal.WORKSPACE) {
      return { name: 'Everyone in the workspace', detail: '', icon: <Globe className='w-4 h-4' /> };
    }
    if (s.principalType === DashboardSharePrincipal.CHANNEL) {
      const channel = channelsById.get(s.principalId);
      // A private channel the viewer isn't in is not named.
      return channel
        ? {
            name: `#${channel.name}`,
            detail: 'Channel members',
            icon: <Hash className='w-4 h-4' />,
          }
        : {
            name: 'Private channel',
            detail: 'Channel members',
            icon: <Lock className='w-4 h-4' />,
          };
    }
    const u = usersById.get(s.principalId);
    return {
      name: u?.name ?? 'Unknown user',
      detail: u?.email ?? '',
      icon: <Avatar userId={s.principalId} size='md' />,
    };
  };

  const hasSelection = selectedUsers.length > 0 || selectedChannels.length > 0;
  const owner = usersById.get(dashboard.createdBy);

  return (
    <div className='w-full max-w-md p-6 space-y-4'>
      {canManage && (
        <div className='space-y-2'>
          <SearchUser
            excludeUserIds={[dashboard.createdBy, ...sharedUserIds]}
            selectedUsers={selectedUsers}
            onUsersChange={setSelectedUsers}
            placeholder='Add people...'
            label=''
            hintText=''
            autoFocus={!isMobile}
          />
          <SearchChannel
            channels={shareableChannels}
            mode='channel'
            excludeChannelIds={sharedChannelIds}
            selectedChannels={selectedChannels}
            onChannelsChange={setSelectedChannels}
            placeholder='Add channels...'
            label=''
            hintText=''
          />
          {hasSelection && (
            <div className='flex items-center flex-wrap gap-2'>
              <span className='text-sm text-muted-foreground'>Share as:</span>
              <Button
                size='sm'
                variant='secondary'
                disabled={busy}
                onClick={() => void handleAdd(DashboardShareRole.VIEWER)}
                data-track-category='ANALYTICS'
                data-track-name='Share_Dashboard_Viewer'
              >
                Can view
              </Button>
              {selectedChannels.length === 0 && (
                <Button
                  size='sm'
                  variant='secondary'
                  disabled={busy}
                  onClick={() => void handleAdd(DashboardShareRole.EDITOR)}
                  data-track-category='ANALYTICS'
                  data-track-name='Share_Dashboard_Editor'
                >
                  Can edit
                </Button>
              )}
              {selectedChannels.length > 0 && (
                <span className='text-xs text-muted-foreground'>Channels can only view</span>
              )}
            </div>
          )}
        </div>
      )}

      {isAnalyticsAdmin && canManage && (
        <div className='flex items-center justify-between py-2 border-y border-border'>
          <div className='flex items-center gap-3'>
            <Globe size={18} className='text-muted-foreground' />
            <span className='text-sm font-medium text-foreground'>
              Everyone in the workspace can view
            </span>
          </div>
          <button
            role='switch'
            aria-checked={Boolean(workspaceShare)}
            aria-label='Everyone in the workspace can view'
            disabled={busy}
            onClick={handleWorkspaceToggle}
            className={`relative w-12 h-6 rounded-full transition-colors duration-200 ${
              workspaceShare ? 'bg-green-500' : 'bg-muted'
            } ${busy ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
            data-track-category='ANALYTICS'
            data-track-name='Toggle_Dashboard_Workspace_Share'
          >
            <span
              aria-hidden='true'
              className={`absolute top-1 w-4 h-4 bg-background rounded-full shadow transition-[left] duration-200 ${
                workspaceShare ? 'left-7' : 'left-1'
              }`}
            />
          </button>
        </div>
      )}

      <div>
        <span className='text-xs text-muted-foreground uppercase tracking-wider'>
          Who has access
        </span>
        <div className='mt-2 max-h-72 overflow-y-auto space-y-1'>
          <div className='flex items-center justify-between py-2 px-2 rounded-lg'>
            <div className='flex items-center gap-3 min-w-0'>
              <Avatar userId={dashboard.createdBy} size='md' />
              <p className='text-sm font-medium text-foreground truncate'>
                {owner?.name ?? 'Unknown user'}
                {dashboard.createdBy === currentUser?.id && (
                  <span className='ml-2 text-xs text-muted-foreground'>(You)</span>
                )}
              </p>
            </div>
            <div className='flex items-center gap-1 text-sm text-muted-foreground'>
              <Crown className='w-4 h-4 text-yellow-500' />
              <span>Owner</span>
            </div>
          </div>

          {sorted.map(s => {
            const { name, detail, icon } = shareTitle(s);
            const isSelf =
              s.principalType === DashboardSharePrincipal.USER && s.principalId === currentUser?.id;
            const canChangeRole =
              canManage && s.principalType === DashboardSharePrincipal.USER && !isSelf;
            return (
              <div
                key={s.id}
                className='flex items-center justify-between py-2 px-2 hover:bg-accent rounded-lg'
              >
                <div className='flex items-center gap-3 flex-1 min-w-0'>
                  <span className='flex items-center justify-center w-8 h-8 text-muted-foreground'>
                    {icon}
                  </span>
                  <div className='min-w-0'>
                    <p className='text-sm font-medium text-foreground truncate'>
                      {name}
                      {isSelf && <span className='ml-2 text-xs text-muted-foreground'>(You)</span>}
                    </p>
                    {detail && <p className='text-xs text-muted-foreground truncate'>{detail}</p>}
                  </div>
                </div>
                <div className='flex items-center gap-2 ml-2'>
                  {canChangeRole ? (
                    <Select.Root
                      value={s.role}
                      onValueChange={value => {
                        void run(
                          () =>
                            updateDashboardShareRole(
                              dashboard.id,
                              s.id,
                              value as DashboardShareRole,
                            ),
                          'Could not change access',
                        );
                      }}
                    >
                      <Select.Trigger
                        className='w-[100px] h-8 text-xs flex items-center justify-between px-2 border border-border rounded bg-background'
                        aria-label={`Access for ${name}`}
                        data-track-category='ANALYTICS'
                        data-track-name='Open_Dashboard_Share_Role'
                      >
                        <Select.Value />
                        <Select.Icon>
                          <ChevronDown className='size-3 opacity-50' />
                        </Select.Icon>
                      </Select.Trigger>
                      <Select.Portal>
                        <Select.Content className='bg-background rounded border border-border shadow-md z-[60] overflow-hidden'>
                          <Select.Viewport className='p-1'>
                            {[DashboardShareRole.VIEWER, DashboardShareRole.EDITOR].map(r => (
                              <Select.Item
                                key={r}
                                value={r}
                                className='relative flex items-center px-6 py-1.5 text-xs rounded-sm cursor-pointer hover:bg-accent outline-none select-none data-[highlighted]:bg-accent'
                              >
                                <Select.ItemText>{roleLabel(r)}</Select.ItemText>
                                <Select.ItemIndicator className='absolute left-1.5'>
                                  <Check className='size-3' />
                                </Select.ItemIndicator>
                              </Select.Item>
                            ))}
                          </Select.Viewport>
                        </Select.Content>
                      </Select.Portal>
                    </Select.Root>
                  ) : (
                    <span className='text-sm text-muted-foreground'>{roleLabel(s.role)}</span>
                  )}
                  {canManage &&
                    !isSelf &&
                    s.principalType !== DashboardSharePrincipal.WORKSPACE && (
                      <button
                        onClick={() => {
                          void run(
                            () => removeDashboardShare(dashboard.id, s.id),
                            'Could not remove access',
                          );
                        }}
                        disabled={busy}
                        className='p-1 hover:bg-red-100 rounded text-red-600'
                        title='Remove access'
                        aria-label={`Remove access for ${name}`}
                        data-track-category='ANALYTICS'
                        data-track-name='Remove_Dashboard_Share'
                      >
                        <X className='w-4 h-4' />
                      </button>
                    )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
