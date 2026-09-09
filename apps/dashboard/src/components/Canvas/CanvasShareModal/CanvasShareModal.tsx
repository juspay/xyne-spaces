import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { CanvasVisibility, CanvasRole, ChannelScopeType } from '@xyne/shared';
import type { Canvas, CanvasParticipant } from '../Canvas.types';
import type { User } from '@xyne/shared';
import {
  Crown,
  Shield,
  Eye,
  Link2,
  UsersRound,
  Hash,
  Lock,
  Globe,
  ChevronDown,
  Check,
  X,
  Search,
  Send,
  Loader2,
} from 'lucide-react';
import { useZero } from '../../../hooks/useZero';
import { useShareableOrigin } from '../../../hooks/useShareableOrigin';
import { queries } from '../../../zero/queries';
import { useAuth } from '../../../hooks/useAuth';
import Avatar from '../../ui/Avatar/Avatar';
import { Button } from '../../ui/Button';
import { Tooltip } from '../../ui/Tooltip/Tooltip';
import * as Select from '@radix-ui/react-select';
import { mutators } from '../../../zero/mutators';
import { useUsers, useActiveUsers, searchUsers } from '../../../hooks/useUsers';
import { useGuestInvite } from '../../../hooks/useGuestInvite';
import Input from '../../ui/Input/Input';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { useAllVisibleChannels } from '../../../hooks/useChannels';
import { v4 as uuidv4 } from 'uuid';
import { usePlatform } from '../../../hooks/usePlatform';
import { useUserGroups } from '@/hooks/useUserGroup';
import { getUserDisplayName } from '../../../utils/userDisplayName';
import { canvasService, CanvasAccessRequest } from '../../../services/Canvas/canvasService';

export interface CanvasShareModalProps {
  canvas: Canvas;
  isOwner: boolean;
  isEditor: boolean;
  channelId?: string;
  participants?: CanvasParticipant[] | undefined;
  /** Close the surrounding Dialog (header ✕ and the Done button). */
  onClose?: () => void;
}

type AddKind = 'user' | 'group' | 'channel';

interface AddCandidate {
  kind: AddKind;
  id: string;
  name: string;
  sub: string;
  user?: User;
}

const REMOVE_ACCESS_SELECT_VALUE = '__canvas_share_remove_access__';

const ROLE_RANK: Record<CanvasRole, number> = {
  [CanvasRole.OWNER]: 3,
  [CanvasRole.EDITOR]: 2,
  [CanvasRole.VIEWER]: 1,
};

export const CanvasShareModal: React.FC<CanvasShareModalProps> = ({
  canvas,
  isOwner,
  isEditor,
  participants: preloadedParticipants,
  onClose,
}) => {
  const { user: currentUser } = useAuth();
  const z = useZero();
  const shareableOrigin = useShareableOrigin();
  const { isMobile } = usePlatform();
  const guestInvite = useGuestInvite({ entityType: 'CANVAS', entityId: canvas.id });

  const [query, setQuery] = useState('');
  const [pendingAdds, setPendingAdds] = useState<AddCandidate[]>([]);
  const [addRole, setAddRole] = useState<CanvasRole>(CanvasRole.EDITOR);
  const [localVisibility, setLocalVisibility] = useState(canvas.visibility);
  const [pendingRoles, setPendingRoles] = useState<Record<string, CanvasRole>>({});
  const searchInputRef = useRef<HTMLInputElement>(null);

  const [queriedParticipants, queriedParticipantsDetails] = useCachedQuery(
    queries.canvasParticipants({ canvasId: canvas.id }),
  );
  const participants =
    queriedParticipantsDetails.type === 'complete'
      ? (queriedParticipants ?? [])
      : preloadedParticipants?.length
        ? preloadedParticipants
        : (queriedParticipants ?? []);

  const allVisibleChannels = useAllVisibleChannels();
  const allUserGroups = useUserGroups();
  const allUsers = useUsers();
  const activeUsers = useActiveUsers();

  const usersById = useMemo(() => {
    const map = new Map<string, User>();
    for (const u of allUsers) map.set(u.id, u);
    return map;
  }, [allUsers]);
  const groupsById = useMemo(() => {
    const map = new Map<string, { id: string; name: string }>();
    for (const g of allUserGroups) map.set(g.id, { id: g.id, name: g.name });
    return map;
  }, [allUserGroups]);
  const channelsById = useMemo(() => {
    const map = new Map<string, { name: string; scopeType: ChannelScopeType }>();
    for (const ch of allVisibleChannels) {
      if (!ch?.id) continue;
      map.set(ch.id, { name: ch.name ?? '', scopeType: ch.scopeType });
    }
    return map;
  }, [allVisibleChannels]);

  const canManage = isOwner || isEditor;

  // Pending edit-access requests, fetched canvas-wide via REST (late-added
  // owners see them too); the viewer's own Zero-synced request rows only act
  // as a live refresh signal.
  const [pendingRequestSignal] = useCachedQuery(
    queries.canvasPendingAccessRequests({ canvasId: canvas.id }),
    { enabled: canManage },
  );
  const [accessRequests, setAccessRequests] = useState<CanvasAccessRequest[]>([]);
  const [actingRequesterId, setActingRequesterId] = useState<string | null>(null);
  const refreshAccessRequests = useCallback(async (): Promise<void> => {
    if (!canManage) return;
    try {
      setAccessRequests(await canvasService.listAccessRequests(canvas.id));
    } catch {
      // Non-fatal: the section just keeps its last state.
    }
  }, [canManage, canvas.id]);
  useEffect(() => {
    void refreshAccessRequests();
  }, [refreshAccessRequests, pendingRequestSignal?.length]);
  const resolveAccessRequest = async (requesterId: string, approve: boolean): Promise<void> => {
    if (actingRequesterId) return;
    setActingRequesterId(requesterId);
    try {
      await canvasService.resolveAccessRequest(
        canvas.id,
        requesterId,
        approve ? 'approve' : 'decline',
      );
      if (approve) {
        toast.success('Edit access granted', { duration: 2000 });
      }
      await refreshAccessRequests();
    } catch {
      toast.error(approve ? 'Failed to grant access' : 'Failed to reject request');
    } finally {
      setActingRequesterId(null);
    }
  };
  const canInviteGuests = currentUser?.role === 'ADMIN' || currentUser?.role === 'OWNER';
  const isPublic = localVisibility === CanvasVisibility.PUBLIC;

  // ---- Already-shared / pending exclusions -------------------------------
  const sharedUserIds = useMemo(
    () => new Set((participants ?? []).map(p => p.userId).filter(Boolean) as string[]),
    [participants],
  );
  const sharedGroupIds = useMemo(
    () => new Set((participants ?? []).map(p => p.userGroupId).filter(Boolean) as string[]),
    [participants],
  );
  const sharedChannelIds = useMemo(
    () => new Set((participants ?? []).map(p => p.channelId).filter(Boolean) as string[]),
    [participants],
  );
  const pendingIds = useMemo(
    () => new Set(pendingAdds.map(p => `${p.kind}:${p.id}`)),
    [pendingAdds],
  );

  // ---- Combined search across people / groups / channels -----------------
  const results = useMemo((): AddCandidate[] => {
    const q = query.trim();
    if (!q) return [];
    const ql = q.toLowerCase();

    const addableUsers = activeUsers.filter(
      u => u.id !== currentUser?.id && !sharedUserIds.has(u.id) && !pendingIds.has(`user:${u.id}`),
    );
    const users: AddCandidate[] = searchUsers(addableUsers, q, 6).map(u => ({
      kind: 'user',
      id: u.id,
      name: getUserDisplayName(u),
      sub: u.email ?? '',
      user: u,
    }));

    const groups: AddCandidate[] = allUserGroups
      .filter(
        g =>
          !sharedGroupIds.has(g.id) &&
          !pendingIds.has(`group:${g.id}`) &&
          (g.name.toLowerCase().includes(ql) || (g.alias?.toLowerCase().includes(ql) ?? false)),
      )
      .slice(0, 4)
      .map(g => ({ kind: 'group', id: g.id, name: g.name, sub: 'Group' }));

    const channels: AddCandidate[] = allVisibleChannels
      .filter(
        ch =>
          ch?.id &&
          ch.scopeType !== ChannelScopeType.DM &&
          ch.scopeType !== ChannelScopeType.GROUP_DM &&
          !sharedChannelIds.has(ch.id) &&
          !pendingIds.has(`channel:${ch.id}`) &&
          (ch.name ?? '').toLowerCase().includes(ql),
      )
      .slice(0, 4)
      .map(ch => ({ kind: 'channel', id: ch.id, name: ch.name ?? '', sub: 'Channel' }));

    return [...users, ...groups, ...channels];
  }, [
    query,
    activeUsers,
    allUserGroups,
    allVisibleChannels,
    sharedUserIds,
    sharedGroupIds,
    sharedChannelIds,
    pendingIds,
    currentUser?.id,
  ]);

  const focusSearch = (): void => {
    if (isMobile) return;
    requestAnimationFrame(() => searchInputRef.current?.focus());
  };

  const addCandidate = (c: AddCandidate): void => {
    setPendingAdds(prev => [...prev, c]);
    setQuery('');
    focusSearch();
  };
  const removePending = (c: AddCandidate): void =>
    setPendingAdds(prev => prev.filter(p => !(p.kind === c.kind && p.id === c.id)));

  // ---- Commit pending adds (called from Done) ----------------------------
  const commitPendingAdds = (): void => {
    if (!z || pendingAdds.length === 0) return;
    const ts = Date.now();
    const userAdds = pendingAdds.filter(p => p.kind === 'user');
    if (userAdds.length) {
      const participantIds = userAdds.reduce<Record<string, string>>((acc, u) => {
        acc[u.id] = uuidv4();
        return acc;
      }, {});
      z.mutate(
        mutators.canvas.addParticipants({
          canvasId: canvas.id,
          userIds: userAdds.map(u => u.id),
          role: addRole,
          timestamp: ts,
          participantIds,
        }),
      );
    }
    for (const g of pendingAdds.filter(p => p.kind === 'group')) {
      z.mutate(
        mutators.canvas.addGroupParticipant({
          canvasId: canvas.id,
          userGroupId: g.id,
          role: addRole,
          participantId: uuidv4(),
          timestamp: ts,
        }),
      );
    }
    for (const ch of pendingAdds.filter(p => p.kind === 'channel')) {
      z.mutate(
        mutators.canvas.addChannelParticipant({
          canvasId: canvas.id,
          channelId: ch.id,
          role: addRole,
          participantId: uuidv4(),
          timestamp: ts,
        }),
      );
    }
  };

  // ---- Role change / remove / re-add (Undo) ------------------------------
  const applyRole = (
    participant: Pick<CanvasParticipant, 'userId' | 'userGroupId' | 'channelId'>,
    role: CanvasRole,
  ): void => {
    if (!z) return;
    try {
      if (participant.userId) {
        z.mutate(
          mutators.canvas.updateParticipantRole({
            canvasId: canvas.id,
            userId: participant.userId,
            role,
            timestamp: Date.now(),
          }),
        );
      } else if (participant.userGroupId) {
        z.mutate(
          mutators.canvas.updateGroupParticipantRole({
            canvasId: canvas.id,
            userGroupId: participant.userGroupId,
            role,
            timestamp: Date.now(),
          }),
        );
      } else if (participant.channelId) {
        z.mutate(
          mutators.canvas.updateChannelParticipantRole({
            canvasId: canvas.id,
            channelId: participant.channelId,
            role,
            timestamp: Date.now(),
          }),
        );
      }
    } catch {
      toast.error('Failed to update role', { duration: 2000 });
    }
  };

  const readd = (participant: CanvasParticipant): void => {
    if (!z) return;
    const ts = Date.now();
    if (participant.userId) {
      z.mutate(
        mutators.canvas.addParticipants({
          canvasId: canvas.id,
          userIds: [participant.userId],
          role: participant.role,
          timestamp: ts,
          participantIds: { [participant.userId]: uuidv4() },
        }),
      );
    } else if (participant.userGroupId) {
      z.mutate(
        mutators.canvas.addGroupParticipant({
          canvasId: canvas.id,
          userGroupId: participant.userGroupId,
          role: participant.role,
          participantId: uuidv4(),
          timestamp: ts,
        }),
      );
    } else if (participant.channelId) {
      z.mutate(
        mutators.canvas.addChannelParticipant({
          canvasId: canvas.id,
          channelId: participant.channelId,
          role: participant.role,
          participantId: uuidv4(),
          timestamp: ts,
        }),
      );
    }
  };

  const removeAccess = (participant: CanvasParticipant, name: string): void => {
    if (!z) return;
    try {
      if (participant.userId) {
        z.mutate(
          mutators.canvas.removeParticipant({ canvasId: canvas.id, userId: participant.userId }),
        );
      } else if (participant.userGroupId) {
        z.mutate(
          mutators.canvas.removeGroupParticipant({
            canvasId: canvas.id,
            userGroupId: participant.userGroupId,
          }),
        );
      } else if (participant.channelId) {
        z.mutate(
          mutators.canvas.removeChannelParticipant({
            canvasId: canvas.id,
            channelId: participant.channelId,
          }),
        );
      }
      toast.success(`Removed ${name}`, {
        duration: 4000,
        action: { label: 'Undo', onClick: () => readd(participant) },
      });
    } catch {
      toast.error('Failed to remove access', { duration: 2000 });
    }
  };

  // Role changes are staged (not applied) until Done. Remove stays immediate (has Undo).
  const onRoleSelect = (participant: CanvasParticipant, value: string, name: string): void => {
    if (value === REMOVE_ACCESS_SELECT_VALUE) {
      removeAccess(participant, name);
      return;
    }
    setPendingRoles(prev => ({ ...prev, [participant.id]: value as CanvasRole }));
  };

  // ---- General access (visibility) — staged, applied on Done -------------
  const setVisibility = (v: CanvasVisibility): void => {
    if (!isOwner) return;
    setLocalVisibility(v);
  };

  // ---- Commit staged changes on Done -------------------------------------
  const hasPendingChanges =
    pendingAdds.length > 0 ||
    Object.keys(pendingRoles).length > 0 ||
    localVisibility !== canvas.visibility;

  const handleDone = (): void => {
    commitPendingAdds();
    for (const [participantId, role] of Object.entries(pendingRoles)) {
      const participant = participants?.find(p => p.id === participantId);
      if (participant && role !== participant.role) {
        applyRole(participant, role);
      }
    }
    if (isOwner && z && localVisibility !== canvas.visibility) {
      try {
        z.mutate(
          mutators.canvas.update({
            id: canvas.id,
            visibility: localVisibility,
            timestamp: Date.now(),
          }),
        );
      } catch {
        toast.error('Failed to update access', { duration: 2000 });
      }
    }
    setPendingAdds([]);
    setPendingRoles({});
    onClose?.();
  };

  const handleCopyLink = (): void => {
    void navigator.clipboard.writeText(`${shareableOrigin}/chat/canvas/${canvas.id}`);
    toast.success('Link copied', {
      description: 'The canvas link is on your clipboard.',
      duration: 2000,
    });
  };

  // ---- Display helpers ----------------------------------------------------
  const roleName = (role: CanvasRole): string =>
    role === CanvasRole.OWNER ? 'Owner' : role === CanvasRole.EDITOR ? 'Editor' : 'Viewer';
  const roleIcon = (role: CanvasRole): React.ReactNode =>
    role === CanvasRole.OWNER ? (
      <Crown className='w-3.5 h-3.5 text-yellow-500' />
    ) : role === CanvasRole.EDITOR ? (
      <Shield className='w-3.5 h-3.5 text-blue-500' />
    ) : (
      <Eye className='w-3.5 h-3.5 text-muted-foreground' />
    );

  const resolveParticipant = (
    p: CanvasParticipant,
  ): { kind: AddKind; name: string; sub: string } => {
    if (p.userId) {
      const u = usersById.get(p.userId);
      return { kind: 'user', name: getUserDisplayName(u), sub: u?.email ?? '' };
    }
    if (p.userGroupId) {
      return {
        kind: 'group',
        name: groupsById.get(p.userGroupId)?.name || p.userGroupId || 'Group',
        sub: 'Group',
      };
    }
    const meta = p.channelId ? channelsById.get(p.channelId) : undefined;
    return { kind: 'channel', name: meta?.name || p.channelId || 'Channel', sub: 'Channel' };
  };

  const accessList = useMemo(() => {
    const list = (participants ?? []).filter(p => {
      if (!p.channelId) return true;
      const meta = channelsById.get(p.channelId);
      return (
        !meta ||
        (meta.scopeType !== ChannelScopeType.DM && meta.scopeType !== ChannelScopeType.GROUP_DM)
      );
    });
    return list.sort((a, b) => {
      const aYou = a.userId === currentUser?.id ? 1 : 0;
      const bYou = b.userId === currentUser?.id ? 1 : 0;
      if (aYou !== bYou) return bYou - aYou;
      const rank = ROLE_RANK[b.role] - ROLE_RANK[a.role];
      if (rank !== 0) return rank;
      return resolveParticipant(a).name.localeCompare(resolveParticipant(b).name);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [participants, currentUser?.id, usersById, groupsById, channelsById]);

  useEffect(() => {
    focusSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const kindIcon = (kind: AddKind): React.ReactNode =>
    kind === 'group' ? (
      <UsersRound className='w-4 h-4 text-muted-foreground' />
    ) : (
      <Hash className='w-4 h-4 text-muted-foreground' />
    );

  return (
    <div className='w-full flex flex-col' data-testid='canvas-share-modal'>
      {/* Header */}
      <div className='flex items-center justify-between gap-2 px-5 pt-5 pb-3'>
        <h2 className='flex min-w-0 items-baseline gap-1.5 text-base font-semibold'>
          <span className='shrink-0'>Share</span>
          <Tooltip
            content={canvas.title || 'Untitled Canvas'}
            side='bottom'
            align='start'
            className='max-w-xs break-words'
          >
            <span className='truncate text-muted-foreground'>
              “{canvas.title || 'Untitled Canvas'}”
            </span>
          </Tooltip>
        </h2>
        {onClose ? (
          <button
            type='button'
            onClick={onClose}
            aria-label='Close'
            className='shrink-0 w-8 h-8 grid place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground'
            data-track-category='CANVAS'
            data-track-name='CLOSE_SHARE_MODAL'
          >
            <X className='w-4 h-4' />
          </button>
        ) : null}
      </div>

      <div className='px-5 pb-4 flex flex-col gap-4'>
        {/* Add row */}
        {canManage ? (
          <div className='relative'>
            <div className='flex flex-wrap items-center gap-1.5 rounded-lg border border-input bg-background px-2.5 py-1.5 focus-within:border-ring focus-within:ring-1 focus-within:ring-ring'>
              <Search className='w-4 h-4 text-muted-foreground shrink-0' />
              {pendingAdds.map(c => (
                <span
                  key={`${c.kind}:${c.id}`}
                  className='inline-flex items-center gap-1.5 rounded-full bg-accent pl-1 pr-1.5 py-0.5 text-xs font-medium'
                >
                  {c.kind === 'user' ? (
                    <Avatar userId={c.id} size='xs' />
                  ) : (
                    <span className='w-4 h-4 grid place-items-center'>{kindIcon(c.kind)}</span>
                  )}
                  <span className='max-w-[140px] truncate'>{c.name}</span>
                  <button
                    type='button'
                    onClick={() => removePending(c)}
                    aria-label={`Remove ${c.name}`}
                    className='opacity-70 hover:opacity-100'
                    data-track-category='CANVAS'
                    data-track-name='REMOVE_PENDING_SHARE_ADD'
                  >
                    <X className='w-3 h-3' />
                  </button>
                </span>
              ))}
              <input
                ref={searchInputRef}
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => {
                  const top = results[0];
                  if (e.key === 'Enter' && top) {
                    e.preventDefault();
                    addCandidate(top);
                  } else if (e.key === 'Backspace' && !query && pendingAdds.length) {
                    const last = pendingAdds[pendingAdds.length - 1];
                    if (last) removePending(last);
                  }
                }}
                placeholder={pendingAdds.length ? 'Add more…' : 'Add people, groups, or channels'}
                data-testid='canvas-user-search-input'
                data-track-category='CANVAS'
                data-track-name='SHARE_SEARCH_INPUT'
                className='flex-1 min-w-[120px] bg-transparent outline-none text-sm py-1'
              />
            </div>

            {/* Results dropdown */}
            {query.trim() && results.length > 0 ? (
              <div className='absolute left-0 right-0 top-[calc(100%+4px)] z-[60] max-h-64 overflow-y-auto rounded-lg border border-border bg-popover shadow-md p-1'>
                {results.map(c => (
                  <button
                    key={`${c.kind}:${c.id}`}
                    type='button'
                    onMouseDown={e => {
                      e.preventDefault();
                      addCandidate(c);
                    }}
                    className='w-full flex items-center gap-3 px-2 py-1.5 rounded-md text-left hover:bg-accent'
                  >
                    {c.kind === 'user' ? (
                      <Avatar userId={c.id} size='md' />
                    ) : (
                      <span className='w-8 h-8 rounded-full bg-muted grid place-items-center shrink-0'>
                        {kindIcon(c.kind)}
                      </span>
                    )}
                    <span className='min-w-0 flex-1'>
                      <span className='block text-sm font-medium truncate'>{c.name}</span>
                      <span className='block text-xs text-muted-foreground truncate'>{c.sub}</span>
                    </span>
                  </button>
                ))}
              </div>
            ) : query.trim() ? (
              <div className='absolute left-0 right-0 top-[calc(100%+4px)] z-[60] rounded-lg border border-border bg-popover shadow-md px-3 py-2.5 text-sm text-muted-foreground'>
                No people, groups, or channels found
              </div>
            ) : null}

            {pendingAdds.length > 0 ? (
              <div className='flex items-center justify-end gap-2 mt-2.5'>
                <span className='text-xs text-muted-foreground'>Add as</span>
                <RoleSelect
                  value={addRole}
                  allowOwner={isOwner}
                  onChange={r => setAddRole(r as CanvasRole)}
                />
              </div>
            ) : null}
          </div>
        ) : null}

        {/* Invite external user */}
        {canManage && canInviteGuests ? (
          <div>
            <div className='text-xs font-semibold text-foreground mb-1.5'>Invite External User</div>
            <div className='flex gap-2'>
              <Input
                type='email'
                placeholder='Enter email address...'
                value={guestInvite.email}
                onChange={e => guestInvite.setEmail(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !guestInvite.isLoading) {
                    void guestInvite.sendInvite();
                  }
                }}
                data-testid='canvas-external-email-input'
                className='flex-1'
              />
              <Button
                size='sm'
                disabled={guestInvite.isLoading || !guestInvite.email.trim()}
                onClick={() => void guestInvite.sendInvite()}
                data-track-category='CANVAS'
                data-track-name='SEND_CANVAS_GUEST_INVITE'
                className='gap-2'
              >
                {guestInvite.isLoading ? (
                  <Loader2 className='w-4 h-4 animate-spin' />
                ) : (
                  <Send className='w-4 h-4' />
                )}
                {guestInvite.isLoading ? 'Sending...' : 'Invite'}
              </Button>
            </div>
          </div>
        ) : null}

        {/* Pending edit-access requests */}
        {canManage && accessRequests.length > 0 ? (
          <div>
            <div className='text-xs font-semibold text-foreground mb-1.5'>
              Pending requests ({accessRequests.length})
            </div>
            <div className='max-h-40 overflow-y-auto -mx-1 pr-0.5'>
              {accessRequests.map(request => {
                const isActing = actingRequesterId === request.requesterId;
                return (
                  <div
                    key={request.requesterId}
                    className='flex items-center gap-3 px-2 py-1.5 rounded-lg hover:bg-accent/60'
                  >
                    <Avatar userId={request.requesterId} size='md' />
                    <div className='min-w-0 flex-1'>
                      <p className='text-sm font-medium truncate'>{request.requesterName}</p>
                      <p className='text-xs text-muted-foreground truncate'>
                        Requested edit access
                      </p>
                    </div>
                    <Button
                      size='sm'
                      disabled={!!actingRequesterId}
                      onClick={() => void resolveAccessRequest(request.requesterId, true)}
                      data-track-category='CANVAS'
                      data-track-name='Approve_Edit_Access_Request'
                      data-track-metadata={JSON.stringify({ canvasId: canvas.id })}
                    >
                      {isActing ? 'Approving…' : 'Approve'}
                    </Button>
                    <Button
                      size='sm'
                      variant='outline'
                      disabled={!!actingRequesterId}
                      onClick={() => void resolveAccessRequest(request.requesterId, false)}
                      data-track-category='CANVAS'
                      data-track-name='Reject_Edit_Access_Request'
                      data-track-metadata={JSON.stringify({ canvasId: canvas.id })}
                    >
                      Reject
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        {/* People with access */}
        <div>
          <div className='text-xs font-semibold text-foreground mb-1.5'>Who has access</div>
          <div className='max-h-64 overflow-y-auto -mx-1 pr-0.5'>
            {accessList.length === 0 ? (
              <p className='text-sm text-muted-foreground px-2 py-2'>Only you have access</p>
            ) : null}
            {accessList.map(p => {
              const info = resolveParticipant(p);
              const isYou = p.userId === currentUser?.id;
              const isCreator = p.userId === canvas.createdBy;
              const editorLocked = isEditor && !isOwner && p.role === CanvasRole.OWNER;
              const locked = isYou || isCreator || editorLocked || !canManage;
              const displayRole = pendingRoles[p.id] ?? p.role;

              return (
                <div
                  key={p.id}
                  className='flex items-center gap-3 px-2 py-1.5 rounded-lg hover:bg-accent/60'
                >
                  {info.kind === 'user' && p.userId ? (
                    <Avatar userId={p.userId} size='md' />
                  ) : (
                    <span className='w-8 h-8 rounded-full bg-muted grid place-items-center shrink-0'>
                      {kindIcon(info.kind)}
                    </span>
                  )}
                  <div className='min-w-0 flex-1'>
                    <p className='text-sm font-medium truncate'>
                      {info.name}
                      {isYou ? (
                        <span className='ml-1.5 text-xs text-muted-foreground'>You</span>
                      ) : null}
                    </p>
                    <p className='text-xs text-muted-foreground truncate'>{info.sub}</p>
                  </div>
                  {locked ? (
                    <span className='flex items-center gap-1.5 text-sm text-muted-foreground pr-1'>
                      {roleIcon(p.role)}
                      {roleName(p.role)}
                      {isCreator ? <span className='text-xs'>(Creator)</span> : null}
                    </span>
                  ) : (
                    <RoleSelect
                      value={displayRole}
                      allowOwner={isOwner}
                      allowRemove
                      onChange={role => onRoleSelect(p, role, info.name)}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* General access */}
        <div>
          <div className='text-xs font-semibold text-foreground mb-1.5'>General access</div>
          <div className='flex items-center gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2.5'>
            <span className='w-9 h-9 rounded-full bg-background border border-border grid place-items-center shrink-0 text-muted-foreground'>
              {isPublic ? <Globe className='w-4 h-4' /> : <Lock className='w-4 h-4' />}
            </span>
            <div className='min-w-0 flex-1'>
              {isOwner ? (
                <GeneralAccessSelect value={localVisibility} onChange={setVisibility} />
              ) : (
                <div className='text-sm font-medium'>
                  {isPublic ? 'Anyone with the link' : 'Restricted'}
                </div>
              )}
              <div className='text-xs text-muted-foreground mt-0.5'>
                {isPublic
                  ? 'Anyone in the workspace with the link can view'
                  : 'Only people with access can open'}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className='flex items-center justify-between gap-3 px-5 py-3.5 border-t border-border'>
        <button
          type='button'
          onClick={handleCopyLink}
          className='inline-flex items-center gap-2 text-sm font-medium text-foreground rounded-md px-2.5 py-1.5 -ml-2.5 transition-colors hover:bg-accent hover:text-primary'
          data-testid='canvas-copy-link-button'
          data-track-category='CANVAS'
          data-track-name='COPY_CANVAS_LINK'
        >
          <Link2 className='w-4 h-4' />
          Copy link
        </button>
        <div className='flex items-center gap-3'>
          {hasPendingChanges ? (
            <span className='text-xs italic text-muted-foreground'>Unsaved changes</span>
          ) : null}
          <Button
            size='sm'
            onClick={handleDone}
            data-track-category='CANVAS'
            data-track-name='DONE_CANVAS_SHARE'
          >
            {hasPendingChanges ? 'Share' : 'Done'}
          </Button>
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Secondary role dropdown (Viewer / Editor / Owner [+ Remove access])
// ---------------------------------------------------------------------------
interface RoleSelectProps {
  value: CanvasRole;
  allowOwner: boolean;
  allowRemove?: boolean;
  onChange: (role: string) => void;
}

const RoleSelect: React.FC<RoleSelectProps> = ({ value, allowOwner, allowRemove, onChange }) => {
  const label =
    value === CanvasRole.OWNER ? 'Owner' : value === CanvasRole.EDITOR ? 'Editor' : 'Viewer';
  const roles: CanvasRole[] = [
    CanvasRole.VIEWER,
    CanvasRole.EDITOR,
    ...(allowOwner ? [CanvasRole.OWNER] : []),
  ];
  return (
    <Select.Root value={value} onValueChange={onChange}>
      <Select.Trigger
        className='inline-flex items-center gap-1 h-8 px-2 rounded-md text-sm text-foreground border border-transparent outline-none hover:border-input hover:bg-background data-[state=open]:border-input focus-visible:border-ring'
        aria-label='Change role'
      >
        <Select.Value>{label}</Select.Value>
        <Select.Icon>
          <ChevronDown className='size-3.5 opacity-50' />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content
          position='popper'
          sideOffset={4}
          align='end'
          className='z-[70] min-w-[180px] overflow-hidden rounded-lg border border-border bg-popover shadow-md'
        >
          <Select.Viewport className='p-1'>
            {roles.map(role => (
              <Select.Item
                key={role}
                value={role}
                className='relative flex items-center pl-7 pr-2 py-1.5 text-sm rounded-md cursor-pointer outline-none select-none data-[highlighted]:bg-accent'
              >
                <Select.ItemIndicator className='absolute left-1.5'>
                  <Check className='size-3.5' />
                </Select.ItemIndicator>
                <Select.ItemText>
                  {role === CanvasRole.OWNER
                    ? 'Owner'
                    : role === CanvasRole.EDITOR
                      ? 'Editor'
                      : 'Viewer'}
                </Select.ItemText>
              </Select.Item>
            ))}
            {allowRemove ? (
              <>
                <div className='h-px bg-border my-1' role='separator' aria-hidden='true' />
                <Select.Item
                  value={REMOVE_ACCESS_SELECT_VALUE}
                  className='relative flex items-center pl-7 pr-2 py-1.5 text-sm rounded-md cursor-pointer text-red-600 outline-none select-none data-[highlighted]:bg-red-50 dark:data-[highlighted]:bg-red-950/40'
                >
                  <Select.ItemText>Remove access</Select.ItemText>
                </Select.Item>
              </>
            ) : null}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
};

// ---------------------------------------------------------------------------
// General access dropdown (Restricted / Anyone in workspace with the link)
// ---------------------------------------------------------------------------
interface GeneralAccessSelectProps {
  value: CanvasVisibility;
  onChange: (v: CanvasVisibility) => void;
}

const GeneralAccessSelect: React.FC<GeneralAccessSelectProps> = ({ value, onChange }) => {
  const label = value === CanvasVisibility.PUBLIC ? 'Anyone with the link' : 'Restricted';
  return (
    <Select.Root value={value} onValueChange={v => onChange(v as CanvasVisibility)}>
      <Select.Trigger
        className='inline-flex items-center gap-1 -ml-1.5 px-1.5 py-0.5 rounded-md text-sm font-medium text-foreground outline-none hover:bg-background data-[state=open]:bg-background'
        data-testid='canvas-visibility-select'
        aria-label='General access'
      >
        <Select.Value>{label}</Select.Value>
        <Select.Icon>
          <ChevronDown className='size-3.5 opacity-50' />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content
          position='popper'
          sideOffset={4}
          align='start'
          className='z-[70] min-w-[280px] overflow-hidden rounded-lg border border-border bg-popover shadow-md'
        >
          <Select.Viewport className='p-1'>
            <Select.Item
              value={CanvasVisibility.PRIVATE}
              className='relative flex items-start gap-2 pl-7 pr-2 py-2 text-sm rounded-md cursor-pointer outline-none select-none data-[highlighted]:bg-accent'
            >
              <Select.ItemIndicator className='absolute left-1.5 top-2.5'>
                <Check className='size-3.5' />
              </Select.ItemIndicator>
              <Lock className='w-4 h-4 mt-0.5 text-muted-foreground shrink-0' />
              <span>
                <Select.ItemText>Restricted</Select.ItemText>
                <span className='block text-xs text-muted-foreground'>
                  Only people with access can open
                </span>
              </span>
            </Select.Item>
            <Select.Item
              value={CanvasVisibility.PUBLIC}
              className='relative flex items-start gap-2 pl-7 pr-2 py-2 text-sm rounded-md cursor-pointer outline-none select-none data-[highlighted]:bg-accent'
            >
              <Select.ItemIndicator className='absolute left-1.5 top-2.5'>
                <Check className='size-3.5' />
              </Select.ItemIndicator>
              <Globe className='w-4 h-4 mt-0.5 text-muted-foreground shrink-0' />
              <span>
                <Select.ItemText>Anyone with the link</Select.ItemText>
                <span className='block text-xs text-muted-foreground'>
                  Anyone in the workspace can view
                </span>
              </span>
            </Select.Item>
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
};
