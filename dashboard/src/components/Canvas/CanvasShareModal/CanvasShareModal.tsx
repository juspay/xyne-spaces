import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { CanvasVisibility, CanvasRole, ChannelScopeType } from '@xyne/shared';
import type { Canvas, CanvasParticipant } from '../Canvas.types';
import type { User } from '@xyne/shared';
import { Crown, Shield, Eye, Link2, Users, UsersRound, Hash } from 'lucide-react';
import * as Tabs from '@radix-ui/react-tabs';
import { useZero } from '../../../hooks/useZero';
import { useShareableOrigin } from '../../../hooks/useShareableOrigin';
import { queries } from '../../../zero/queries';
import { useAuth } from '../../../hooks/useAuth';
import { SearchUser } from '../../ui/SearchUser/SearchUser';
import { SearchUserGroups } from '../../ui/SearchUserGroups/SearchUserGroups';
import { SearchChannel, type SearchChannelCandidate } from '../../ui/SearchChannel/SearchChannel';
import Avatar from '../../ui/Avatar/Avatar';
import { Dialog } from '../../ui/Dialog';
import { Button } from '../../ui/Button';
import * as Select from '@radix-ui/react-select';
import { ChevronDown, Check } from 'lucide-react';
import { mutators } from '../../../zero/mutators';
import { useUsers } from '../../../hooks/useUsers';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { useAllVisibleChannels } from '../../../hooks/useChannels';
import { v4 as uuidv4 } from 'uuid';
import { usePlatform } from '../../../hooks/usePlatform';
import { useUserGroups } from '@/hooks/useUserGroup';
import { cn } from '../../../utils/classNames';

export interface CanvasShareModalProps {
  canvas: Canvas;
  isOwner: boolean;
  isEditor: boolean;
  channelId?: string;
  participants?: CanvasParticipant[] | undefined;
}

type ShareTab = 'users' | 'groups' | 'channels';

type RemoveTarget =
  | { kind: 'user'; userId: string }
  | { kind: 'group'; userGroupId: string }
  | { kind: 'channel'; channelId: string };

const REMOVE_ACCESS_SELECT_VALUE = '__canvas_share_remove_access__';
interface RoleActionButtonsProps {
  count: number;
  isOwner: boolean;
  isAdding: boolean;
  onAdd: (role: CanvasRole) => void;
  trackNamePrefix: string;
  trackCountKey: 'userCount' | 'groupCount' | 'channelCount';
  canvasId: string;
}

const RoleActionButtons: React.FC<RoleActionButtonsProps> = ({
  count,
  isOwner,
  isAdding,
  onAdd,
  trackNamePrefix,
  trackCountKey,
  canvasId,
}) => {
  return (
    <div className='flex items-center flex-wrap gap-2'>
      <span className='text-sm text-muted-foreground'>Add as:</span>
      <Button
        size='sm'
        variant='secondary'
        disabled={isAdding}
        onClick={() => onAdd(CanvasRole.VIEWER)}
        data-track-category='CANVAS'
        data-track-name={`${trackNamePrefix}_VIEWER`}
        data-track-metadata={JSON.stringify({
          canvasId,
          [trackCountKey]: count,
        })}
      >
        <Eye className='w-3 h-3' />
        Viewer
      </Button>
      <Button
        size='sm'
        variant='secondary'
        disabled={isAdding}
        onClick={() => onAdd(CanvasRole.EDITOR)}
        data-track-category='CANVAS'
        data-track-name={`${trackNamePrefix}_EDITOR`}
        data-track-metadata={JSON.stringify({
          canvasId,
          [trackCountKey]: count,
        })}
      >
        <Shield className='w-3 h-3' />
        Editor
      </Button>
      {isOwner ? (
        <Button
          size='sm'
          variant='secondary'
          disabled={isAdding}
          onClick={() => onAdd(CanvasRole.OWNER)}
          data-track-category='CANVAS'
          data-track-name={`${trackNamePrefix}_OWNER`}
          data-track-metadata={JSON.stringify({
            canvasId,
            [trackCountKey]: count,
          })}
        >
          <Crown className='w-3 h-3' />
          Owner
        </Button>
      ) : null}
    </div>
  );
};

export const CanvasShareModal: React.FC<CanvasShareModalProps> = ({
  canvas,
  isOwner,
  isEditor,
  channelId,
  participants: preloadedParticipants,
}) => {
  const { user: currentUser } = useAuth();
  const z = useZero();
  const shareableOrigin = useShareableOrigin();
  const [shareTab, setShareTab] = useState<ShareTab>('users');
  const [selectedUsers, setSelectedUsers] = useState<User[]>([]);
  const [isAddingParticipant, setIsAddingParticipant] = useState(false);
  const { isMobile } = usePlatform();
  const [localVisibility, setLocalVisibility] = useState(canvas.visibility);
  const [selectedGroups, setSelectedGroups] = useState<{ id: string; name: string }[]>([]);
  const [selectedChannels, setSelectedChannels] = useState<{ id: string; name: string }[]>([]);
  const [confirmationModal, setConfirmationModal] = useState<{
    isOpen: boolean;
    target: RemoveTarget | null;
  }>({ isOpen: false, target: null });

  const [queriedParticipants] = useCachedQuery(
    queries.canvasParticipants({ canvasId: canvas.id }),
    {
      enabled: !preloadedParticipants,
    },
  );
  const participants = preloadedParticipants ?? queriedParticipants;
  const participantUserIds = participants
    ? participants.map(p => p.userId).filter((userId): userId is string => Boolean(userId))
    : [];

  const allVisibleChannels = useAllVisibleChannels();
  const allUserGroups = useUserGroups();
  const allUsers = useUsers();
  const usersById = useMemo(() => {
    const map = new Map<string, User>();
    for (const u of allUsers) {
      map.set(u.id, u);
    }
    return map;
  }, [allUsers]);
  const groupsById = useMemo(() => {
    const map = new Map<string, { id: string; name: string }>();
    for (const group of allUserGroups) {
      map.set(group.id, { id: group.id, name: group.name });
    }
    return map;
  }, [allUserGroups]);
  const channelsById = useMemo(() => {
    const map = new Map<string, { name: string; scopeType: ChannelScopeType }>();
    for (const ch of allVisibleChannels) {
      if (!ch?.id) continue;
      map.set(ch.id, {
        name: ch.name ?? '',
        scopeType: ch.scopeType,
      });
    }
    return map;
  }, [allVisibleChannels]);

  const flatChannelCandidates = useMemo((): SearchChannelCandidate[] => {
    const list: SearchChannelCandidate[] = [];
    for (const [id, meta] of channelsById) {
      list.push({
        id,
        name: meta.name || id,
        scopeType: meta.scopeType,
      });
    }
    return list;
  }, [channelsById]);

  const sharedGroupIds = useMemo(
    () =>
      new Set(
        participants?.filter(p => Boolean(p.userGroupId)).map(p => p.userGroupId as string) ?? [],
      ),
    [participants],
  );

  const sharedChannelIds = useMemo(
    () =>
      new Set(
        participants?.filter(p => Boolean(p.channelId)).map(p => p.channelId as string) ?? [],
      ),
    [participants],
  );

  const participantsForTab = useMemo(() => {
    if (!participants?.length) return [];
    if (!isOwner && !isEditor) return participants;
    switch (shareTab) {
      case 'users':
        return participants.filter(p => Boolean(p.userId));
      case 'groups':
        return participants.filter(p => Boolean(p.userGroupId));
      case 'channels':
        return participants.filter(p => {
          if (!p.channelId) return false;
          const meta = channelsById.get(p.channelId);
          if (!meta) return true;
          return (
            meta.scopeType !== ChannelScopeType.DM && meta.scopeType !== ChannelScopeType.GROUP_DM
          );
        });
      default:
        return participants;
    }
  }, [participants, shareTab, channelsById, isOwner, isEditor]);

  const emptyParticipantsMessage = useMemo((): string => {
    if (!(isOwner || isEditor)) return 'No one with access';
    const messages: Record<ShareTab, string> = {
      users: 'No users with access',
      groups: 'No user groups with access',
      channels: 'No channels with access',
    };
    return messages[shareTab];
  }, [isOwner, isEditor, shareTab]);

  const handleVisibilityToggle = (): void => {
    if (!isOwner || !z) return;
    const newVisibility =
      localVisibility === CanvasVisibility.PUBLIC
        ? CanvasVisibility.PRIVATE
        : CanvasVisibility.PUBLIC;
    setLocalVisibility(newVisibility);

    try {
      z.mutate(
        mutators.canvas.update({
          id: canvas.id,
          visibility: newVisibility,
          timestamp: Date.now(),
        }),
      );
    } catch {
      setLocalVisibility(localVisibility);
      toast.error('Error', {
        description: 'Failed to update visibility',
        duration: 2000,
      });
    }
  };

  const handleCopyLink = (): void => {
    const viewLink = canvas.viewAccessId
      ? `${shareableOrigin}/chat/canvas/${canvas.viewAccessId}`
      : `${shareableOrigin}/chat/canvas/${canvas.id}`;
    void navigator.clipboard.writeText(viewLink);
    toast.success('Link Copied', {
      description: 'The link has been copied to your clipboard.',
      duration: 2000,
    });
  };

  const handleAddParticipants = (role: CanvasRole): void => {
    if (!z || selectedUsers.length === 0) return;

    setIsAddingParticipant(true);
    try {
      const participantIds = selectedUsers.reduce(
        (acc, user) => {
          acc[user.id] = uuidv4();
          return acc;
        },
        {} as Record<string, string>,
      );

      z.mutate(
        mutators.canvas.addParticipants({
          canvasId: canvas.id,
          userIds: selectedUsers.map(u => u.id),
          role,
          timestamp: Date.now(),
          participantIds,
        }),
      );
      const count = selectedUsers.length;
      setSelectedUsers([]);
      focusCurrentTabInput();
      toast.success('Participants Added', {
        description: `${count} user(s) have been added to the canvas`,
        duration: 2000,
      });
    } catch {
      toast.error('Failed to Add Participants', {
        description: 'Could not add participants. Please try again.',
        duration: 2000,
      });
    } finally {
      setIsAddingParticipant(false);
    }
  };

  const handleAddGroup = (role: CanvasRole): void => {
    if (!z || selectedGroups.length === 0) return;
    setIsAddingParticipant(true);
    try {
      const ts = Date.now();
      for (const g of selectedGroups) {
        z.mutate(
          mutators.canvas.addGroupParticipant({
            canvasId: canvas.id,
            userGroupId: g.id,
            role,
            participantId: uuidv4(),
            timestamp: ts,
          }),
        );
      }
      const count = selectedGroups.length;
      setSelectedGroups([]);
      focusCurrentTabInput();
      toast.success(count === 1 ? 'Group added' : 'Groups added', {
        description:
          count === 1
            ? 'The user group can now access this canvas.'
            : `${count} user groups can now access this canvas.`,
        duration: 2000,
      });
    } catch {
      toast.error('Failed to add group', {
        description: 'Could not add the user group(s). Please try again.',
        duration: 2000,
      });
    } finally {
      setIsAddingParticipant(false);
    }
  };

  const handleAddChannelParticipant = (role: CanvasRole): void => {
    if (!z || selectedChannels.length === 0) return;
    setIsAddingParticipant(true);
    try {
      const ts = Date.now();
      for (const ch of selectedChannels) {
        z.mutate(
          mutators.canvas.addChannelParticipant({
            canvasId: canvas.id,
            channelId: ch.id,
            role,
            participantId: uuidv4(),
            timestamp: ts,
          }),
        );
      }
      const count = selectedChannels.length;
      setSelectedChannels([]);
      focusCurrentTabInput();
      toast.success(count === 1 ? 'Channel added' : 'Conversations added', {
        description: 'Members can now access the canvas.',
        duration: 2000,
      });
    } catch {
      toast.error('Failed to add channel', {
        description: 'You must be a member of that channel, or the channel may be invalid.',
        duration: 2500,
      });
    } finally {
      setIsAddingParticipant(false);
    }
  };

  const handleRemoveParticipant = (target: RemoveTarget): void => {
    if (!z) return;
    setConfirmationModal({ isOpen: true, target });
  };

  const confirmRemoveParticipant = (): void => {
    if (!z || !confirmationModal.target) return;

    try {
      const t = confirmationModal.target;
      if (t.kind === 'user') {
        z.mutate(
          mutators.canvas.removeParticipant({
            canvasId: canvas.id,
            userId: t.userId,
          }),
        );
      } else if (t.kind === 'group') {
        z.mutate(
          mutators.canvas.removeGroupParticipant({
            canvasId: canvas.id,
            userGroupId: t.userGroupId,
          }),
        );
      } else {
        z.mutate(
          mutators.canvas.removeChannelParticipant({
            canvasId: canvas.id,
            channelId: t.channelId,
          }),
        );
      }
      toast.success('Participant Removed', {
        description: 'Participant has been removed from the canvas',
        duration: 2000,
      });
    } catch {
      toast.error('Failed to Remove Participant', {
        description: 'Could not remove participant. Please try again.',
        duration: 2000,
      });
    } finally {
      setConfirmationModal({ isOpen: false, target: null });
      focusCurrentTabInput();
    }
  };

  const handleUpdateRole = (
    newRole: CanvasRole,
    participant: Pick<CanvasParticipant, 'userId' | 'userGroupId' | 'channelId'>,
  ): void => {
    if (!z) return;

    try {
      if (participant.userId) {
        z.mutate(
          mutators.canvas.updateParticipantRole({
            canvasId: canvas.id,
            userId: participant.userId,
            role: newRole,
            timestamp: Date.now(),
          }),
        );
      } else if (participant.userGroupId) {
        z.mutate(
          mutators.canvas.updateGroupParticipantRole({
            canvasId: canvas.id,
            userGroupId: participant.userGroupId,
            role: newRole,
            timestamp: Date.now(),
          }),
        );
      } else if (participant.channelId) {
        z.mutate(
          mutators.canvas.updateChannelParticipantRole({
            canvasId: canvas.id,
            channelId: participant.channelId,
            role: newRole,
            timestamp: Date.now(),
          }),
        );
      }
      toast.success('Role Updated', {
        description: 'Participant role has been updated successfully',
        duration: 2000,
      });
    } catch {
      toast.error('Failed to Update Role', {
        description: 'Could not update participant role. Please try again.',
        duration: 2000,
      });
    }
  };

  const getRoleIcon = (role: CanvasRole): React.ReactNode => {
    switch (role) {
      case CanvasRole.OWNER:
        return <Crown className='w-4 h-4 text-yellow-500' />;
      case CanvasRole.EDITOR:
        return <Shield className='w-4 h-4 text-blue-500' />;
      case CanvasRole.VIEWER:
        return <Eye className='w-4 h-4 text-muted-foreground' />;
      default:
        return null;
    }
  };

  const getRoleName = (role: CanvasRole): string => {
    switch (role) {
      case CanvasRole.OWNER:
        return 'Owner';
      case CanvasRole.EDITOR:
        return 'Editor';
      case CanvasRole.VIEWER:
        return 'Viewer';
      default:
        return 'Unknown';
    }
  };

  const isPublic = localVisibility === CanvasVisibility.PUBLIC;
  const canManageParticipants = isOwner || isEditor;

  const tabTriggerClass = (active: boolean): string =>
    cn(
      'px-3 py-2 text-xs sm:text-sm transition-all duration-100 border-b-2 shrink-0',
      active
        ? 'border-primary text-primary'
        : 'border-transparent text-muted-foreground hover:text-foreground',
    );

  const inputTestIdByTab: Record<ShareTab, string> = {
    users: 'user-search-input',
    groups: 'canvas-group-search-input',
    channels: 'canvas-channel-search-input',
  };

  const focusCurrentTabInput = (): void => {
    if (isMobile || !canManageParticipants) return;
    const inputTestId = inputTestIdByTab[shareTab];
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLInputElement>(`[data-testid="${inputTestId}"]`);
      el?.focus();
    });
  };

  // Focus management for input box on tab change
  useEffect(() => {
    if (isMobile || !canManageParticipants) return;

    const inputTestId = inputTestIdByTab[shareTab];
    let raf1 = 0;
    let raf2 = 0;

    // Delay focus to run after Radix tab/content focus management settles.
    raf1 = window.requestAnimationFrame(() => {
      raf2 = window.requestAnimationFrame(() => {
        const el = document.querySelector<HTMLInputElement>(`[data-testid="${inputTestId}"]`);
        el?.focus();
      });
    });

    return () => {
      window.cancelAnimationFrame(raf1);
      window.cancelAnimationFrame(raf2);
    };
  }, [shareTab, isMobile, canManageParticipants]);

  return (
    <>
      <div className='w-full max-w-lg p-6 flex flex-col' data-testid='canvas-share-modal'>
        {canManageParticipants ? (
          <Tabs.Root
            value={shareTab}
            onValueChange={v => {
              setShareTab(v as ShareTab);
              setSelectedUsers([]);
              setSelectedGroups([]);
              setSelectedChannels([]);
            }}
            className='flex flex-col min-h-0'
          >
            <Tabs.List className='flex flex-wrap items-center gap-1 border-b border-border -mx-1 px-1'>
              <Tabs.Trigger value='users' className={tabTriggerClass(shareTab === 'users')}>
                <span className='inline-flex items-center gap-1.5'>
                  <Users className='w-3.5 h-3.5' />
                  Users
                </span>
              </Tabs.Trigger>
              <Tabs.Trigger value='groups' className={tabTriggerClass(shareTab === 'groups')}>
                <span className='inline-flex items-center gap-1.5'>
                  <UsersRound className='w-3.5 h-3.5' />
                  Groups
                </span>
              </Tabs.Trigger>
              <Tabs.Trigger value='channels' className={tabTriggerClass(shareTab === 'channels')}>
                <span className='inline-flex items-center gap-1.5'>
                  <Hash className='w-3.5 h-3.5' />
                  Channels
                </span>
              </Tabs.Trigger>
            </Tabs.List>

            <Tabs.Content value='users' className='outline-none pt-3'>
              <SearchUser
                excludeUserIds={participantUserIds}
                selectedUsers={selectedUsers}
                onUsersChange={setSelectedUsers}
                placeholder='Search users to add...'
                label=''
                hintText=''
                {...(channelId && { channelId })}
                data-testid='canvas-user-search-input'
                autoFocus={!isMobile}
              />
              {selectedUsers.length > 0 ? (
                <div className='mt-2'>
                  <RoleActionButtons
                    count={selectedUsers.length}
                    isOwner={isOwner}
                    isAdding={isAddingParticipant}
                    onAdd={role => void handleAddParticipants(role)}
                    trackNamePrefix='ADD_PARTICIPANT'
                    trackCountKey='userCount'
                    canvasId={canvas.id}
                  />
                </div>
              ) : null}
            </Tabs.Content>

            <Tabs.Content value='groups' className='outline-none pt-3 space-y-2'>
              <SearchUserGroups
                excludeGroupIds={[...sharedGroupIds]}
                selectedGroups={selectedGroups}
                onGroupsChange={setSelectedGroups}
                placeholder='Search user groups to add...'
                label=''
                hintText=''
                inputTestId='canvas-group-search-input'
                trackMetadata={{ canvasId: canvas.id }}
                autoFocus={!isMobile}
              />
              {selectedGroups.length > 0 ? (
                <RoleActionButtons
                  count={selectedGroups.length}
                  isOwner={isOwner}
                  isAdding={isAddingParticipant}
                  onAdd={role => void handleAddGroup(role)}
                  trackNamePrefix='ADD_GROUP'
                  trackCountKey='groupCount'
                  canvasId={canvas.id}
                />
              ) : null}
            </Tabs.Content>

            <Tabs.Content value='channels' className='outline-none pt-3 space-y-2'>
              <SearchChannel
                channels={flatChannelCandidates}
                mode='channel'
                excludeChannelIds={[...sharedChannelIds]}
                selectedChannels={shareTab === 'channels' ? selectedChannels : []}
                onChannelsChange={setSelectedChannels}
                placeholder='Search channels to add...'
                label=''
                hintText=''
                inputTestId='canvas-channel-search-input'
                trackMetadata={{ canvasId: canvas.id }}
                autoFocus={!isMobile}
              />
              {shareTab === 'channels' && selectedChannels.length > 0 ? (
                <RoleActionButtons
                  count={selectedChannels.length}
                  isOwner={isOwner}
                  isAdding={isAddingParticipant}
                  onAdd={role => void handleAddChannelParticipant(role)}
                  trackNamePrefix='ADD_CHANNEL'
                  trackCountKey='channelCount'
                  canvasId={canvas.id}
                />
              ) : null}
            </Tabs.Content>
          </Tabs.Root>
        ) : null}

        <div className='border-t border-border my-4' />

        <div className='mb-2'>
          {canManageParticipants ? (
            <span className='text-xs text-muted-foreground uppercase tracking-wider'>
              {shareTab === 'users'
                ? 'Users with access'
                : shareTab === 'groups'
                  ? 'User groups with access'
                  : 'Channels with access'}
            </span>
          ) : (
            <span className='text-xs text-muted-foreground uppercase tracking-wider'>
              Everyone with access
            </span>
          )}
        </div>

        <div className='max-h-60 overflow-y-auto space-y-1 mb-4'>
          {participantsForTab.length === 0 && (
            <p className='text-sm text-muted-foreground py-2 px-2'>{emptyParticipantsMessage}</p>
          )}
          {participantsForTab.map(participant => {
            const isUser = Boolean(participant.userId);
            const isGroup = Boolean(participant.userGroupId);
            const chMeta = participant.channelId
              ? channelsById.get(participant.channelId)
              : undefined;
            const editorLocked = isEditor && !isOwner && participant.role === CanvasRole.OWNER;
            const displayName = isUser
              ? usersById.get(participant.userId as string)?.name || 'Unknown User'
              : isGroup
                ? groupsById.get(participant.userGroupId || '')?.name ||
                  participant.userGroupId ||
                  'Unknown Group'
                : chMeta?.name || participant.channelId || 'Channel';
            const subtitle = isUser
              ? usersById.get(participant.userId as string)?.email || ''
              : isGroup
                ? 'User group'
                : 'Channel';

            return (
              <div
                key={participant.id}
                className='flex items-center justify-between py-2 px-2 hover:bg-accent rounded-lg'
              >
                <div className='flex items-center gap-3 flex-1 min-w-0'>
                  {isUser ? (
                    <Avatar userId={participant.userId as string} size='md' />
                  ) : (
                    <div className='w-8 h-8 rounded-full bg-muted flex items-center justify-center shrink-0'>
                      {isGroup ? (
                        <UsersRound className='w-4 h-4 text-muted-foreground' />
                      ) : (
                        <Hash className='w-4 h-4 text-muted-foreground' />
                      )}
                    </div>
                  )}
                  <div className='flex-1 min-w-0'>
                    <p className='text-sm font-medium text-foreground truncate'>
                      {displayName}
                      {participant.userId === currentUser?.id ? (
                        <span className='ml-2 text-xs text-muted-foreground'>(You)</span>
                      ) : null}
                    </p>
                    <p className='text-xs text-muted-foreground truncate'>{subtitle}</p>
                  </div>
                </div>

                <div className='flex items-center gap-2 ml-2'>
                  {canManageParticipants &&
                  !editorLocked &&
                  participant.userId !== currentUser?.id &&
                  participant.userId !== canvas.createdBy ? (
                    <Select.Root
                      value={participant.role}
                      onValueChange={value => {
                        if (value === REMOVE_ACCESS_SELECT_VALUE) {
                          if (participant.userId) {
                            handleRemoveParticipant({
                              kind: 'user',
                              userId: participant.userId,
                            });
                          } else if (participant.userGroupId) {
                            handleRemoveParticipant({
                              kind: 'group',
                              userGroupId: participant.userGroupId,
                            });
                          } else if (participant.channelId) {
                            handleRemoveParticipant({
                              kind: 'channel',
                              channelId: participant.channelId,
                            });
                          }
                          return;
                        }
                        void handleUpdateRole(value as CanvasRole, participant);
                      }}
                    >
                      <Select.Trigger className='h-8 text-xs flex items-center justify-between px-2 rounded bg-background'>
                        <Select.Value />
                        <Select.Icon>
                          <ChevronDown className='ml-3 size-3 opacity-50' />
                        </Select.Icon>
                      </Select.Trigger>
                      <Select.Portal>
                        <Select.Content className='bg-background rounded border border-border shadow-md z-[60] overflow-hidden min-w-[var(--radix-select-trigger-width)]'>
                          <Select.Viewport className='p-1'>
                            {[
                              CanvasRole.VIEWER,
                              CanvasRole.EDITOR,
                              ...(isOwner ? [CanvasRole.OWNER] : []),
                            ].map(role => (
                              <Select.Item
                                key={role}
                                value={role}
                                className='relative flex items-center px-6 py-1.5 text-xs rounded-sm cursor-pointer hover:bg-accent outline-none select-none data-[highlighted]:bg-accent'
                              >
                                <Select.ItemText>{getRoleName(role)}</Select.ItemText>
                                <Select.ItemIndicator className='absolute left-1.5'>
                                  <Check className='size-3' />
                                </Select.ItemIndicator>
                              </Select.Item>
                            ))}
                            <div
                              className='h-px bg-border my-1'
                              role='separator'
                              aria-hidden='true'
                            />
                            <Select.Item
                              value={REMOVE_ACCESS_SELECT_VALUE}
                              className='relative flex items-center px-6 py-1.5 text-xs rounded-sm cursor-pointer text-red-600 outline-none select-none data-[highlighted]:bg-red-50 data-[highlighted]:text-red-700'
                              data-track-category='CANVAS'
                              data-track-name='REMOVE_PARTICIPANT'
                              data-track-metadata={JSON.stringify({
                                canvasId: canvas.id,
                                userId: participant.userId,
                                userGroupId: participant.userGroupId,
                                channelId: participant.channelId,
                                role: participant.role,
                              })}
                            >
                              <Select.ItemText>Remove access</Select.ItemText>
                            </Select.Item>
                          </Select.Viewport>
                        </Select.Content>
                      </Select.Portal>
                    </Select.Root>
                  ) : (
                    <div className='flex items-center gap-1 text-sm text-muted-foreground'>
                      {getRoleIcon(participant.role)}
                      <span>{getRoleName(participant.role)}</span>
                      {participant.userId === canvas.createdBy ? (
                        <span className='text-xs text-muted-foreground'>(Creator)</span>
                      ) : null}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className='flex items-center justify-between gap-4 border-t border-border pt-4 mt-auto'>
          <button
            type='button'
            onClick={handleCopyLink}
            className='inline-flex items-center gap-2 text-sm font-medium text-foreground hover:text-primary'
            data-testid='canvas-copy-link-button'
            data-track-category='CANVAS'
            data-track-name='COPY_CANVAS_LINK'
            data-track-metadata={JSON.stringify({
              canvasId: canvas.id,
              visibility: localVisibility,
            })}
          >
            <Link2 className='w-4 h-4' />
            Copy link
          </button>
          {isOwner && z ? (
            <Button
              type='button'
              variant={isPublic ? 'secondary' : 'default'}
              onClick={handleVisibilityToggle}
              data-testid='canvas-visibility-public-button'
              data-track-category='CANVAS'
              data-track-name='TOGGLE_CANVAS_VISIBILITY'
              data-track-metadata={JSON.stringify({ isPublic: !isPublic, canvasId: canvas.id })}
            >
              {isPublic ? 'Make canvas private' : 'Make canvas public'}
            </Button>
          ) : null}
        </div>
      </div>

      {confirmationModal.isOpen ? (
        <Dialog
          open={confirmationModal.isOpen}
          onOpenChange={open => {
            if (!open) {
              setConfirmationModal({ isOpen: false, target: null });
              focusCurrentTabInput();
            }
          }}
          title='Remove Participant'
        >
          <div className='p-6'>
            <p className='text-muted-foreground mb-6'>
              Are you sure you want to remove this participant from the canvas?
            </p>
            <div className='flex justify-end gap-3'>
              <Button
                variant='secondary'
                onClick={() => {
                  setConfirmationModal({ isOpen: false, target: null });
                  focusCurrentTabInput();
                }}
                data-track-category='CANVAS'
                data-track-name='Cancel_Remove_Participant'
                data-track-metadata={JSON.stringify({ canvasId: canvas.id })}
              >
                Cancel
              </Button>
              <Button
                variant='default'
                onClick={() => void confirmRemoveParticipant()}
                data-track-category='CANVAS'
                data-track-name='Confirm_Remove_Participant'
                data-track-metadata={JSON.stringify({
                  canvasId: canvas.id,
                  target: confirmationModal.target,
                })}
              >
                Remove
              </Button>
            </div>
          </div>
        </Dialog>
      ) : null}
    </>
  );
};
