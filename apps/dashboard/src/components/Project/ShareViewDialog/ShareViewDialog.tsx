import { ReactElement, useCallback, useEffect, useMemo, useState } from 'react';
import { Search, Check, Share2, Link2, X, Crown } from 'lucide-react';
import { toast } from 'sonner';
import { v4 as uuidv4 } from 'uuid';
import { Dialog } from '../../ui/Dialog';
import Button from '../../ui/Button';
import Input from '../../ui/Input';
import Avatar from '../../ui/Avatar/Avatar';
import { ViewAccessEntityType } from '@xyne/shared';
import { useUsers } from '../../../hooks/useUsers';
import { useZero } from '../../../hooks/useZero';
import { useAuth } from '../../../hooks/useAuth';
import { useShareableOrigin } from '../../../hooks/useShareableOrigin';
import { mutators } from '../../../zero/mutators';
import { apiInstance } from '../../../services/clients/apiClient';
import { cn } from '../../../utils/classNames';

interface ShareViewDialogProps {
  isOpen: boolean;
  onClose: () => void;
  viewId: string;
  viewName: string;
}

interface UserOption {
  id: string;
  name: string;
  email?: string;
}

interface ViewGrant {
  id: string;
  entityType: ViewAccessEntityType;
  entityId: string;
  sharedBy: string;
}

interface ViewAccessResponse {
  ownerId: string;
  grants: ViewGrant[];
}

export const ShareViewDialog = ({
  isOpen,
  onClose,
  viewId,
  viewName,
}: ShareViewDialogProps): ReactElement => {
  const zero = useZero();
  const { user } = useAuth();
  const allUsers = useUsers();
  const shareableOrigin = useShareableOrigin();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set());
  const [isSharing, setIsSharing] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  // Owner + full grant list come from a REST endpoint. Zero only syncs view_access rows
  // where entityId = self, so the owner can't read the grants they created over Zero;
  // the endpoint returns the complete list after an authorization check.
  const [access, setAccess] = useState<ViewAccessResponse | null>(null);
  const ownerId = access?.ownerId;
  const grants = access?.grants;

  const fetchAccess = useCallback(async (): Promise<void> => {
    try {
      const res = await apiInstance.get<ViewAccessResponse>(`/views/${viewId}/access`);
      setAccess(res.data);
    } catch {
      // A user without access to the view simply sees no list.
      setAccess(null);
    }
  }, [viewId]);

  useEffect(() => {
    if (isOpen) void fetchAccess();
  }, [isOpen, fetchAccess]);

  const usersById = useMemo(() => {
    const map = new Map<string, UserOption>();
    for (const u of allUsers ?? []) {
      map.set(u.id, { id: u.id, name: u.name || u.email || u.id, email: u.email });
    }
    return map;
  }, [allUsers]);

  // Users the view is already shared with (USER grants only).
  const sharedGrants = useMemo(
    () =>
      (grants ?? [])
        .filter(g => g.entityType === ViewAccessEntityType.USER)
        .map(g => ({ grantId: g.id, user: usersById.get(g.entityId), userId: g.entityId })),
    [grants, usersById],
  );
  const sharedUserIds = useMemo(() => new Set(sharedGrants.map(g => g.userId)), [sharedGrants]);

  const userOptions = useMemo(() => {
    const options: UserOption[] = (allUsers ?? [])
      .filter(u => u.id !== user?.id && u.id !== ownerId && !sharedUserIds.has(u.id))
      .map(u => ({
        id: u.id,
        name: u.name || u.email || u.id,
        email: u.email,
      }));
    if (!searchQuery.trim()) return options;
    const lower = searchQuery.toLowerCase();
    return options.filter(
      o => o.name.toLowerCase().includes(lower) || o.email?.toLowerCase().includes(lower),
    );
  }, [allUsers, user?.id, ownerId, searchQuery, sharedUserIds]);

  const ownerUser = ownerId ? usersById.get(ownerId) : undefined;

  const toggleUser = (userId: string): void => {
    setSelectedUserIds(prev => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const handleCopyLink = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(`${shareableOrigin}/projects/views/${viewId}`);
      toast.success('Link copied. Only people you share the view with can open it.');
    } catch {
      toast.error('Failed to copy link');
    }
  };

  const handleShare = async (): Promise<void> => {
    if (selectedUserIds.size === 0) return;
    setIsSharing(true);
    try {
      const timestamp = Date.now();
      for (const userId of selectedUserIds) {
        const res = await zero.mutate(
          mutators.viewAccess.grant({
            id: uuidv4(),
            viewId,
            entityType: ViewAccessEntityType.USER,
            entityId: userId,
            timestamp,
          }),
        ).server;
        if (res.type === 'error') {
          toast.error(res.error?.message ?? `Failed to share with a user`);
          return;
        }
      }
      toast.success(
        `View shared with ${selectedUserIds.size} user${selectedUserIds.size !== 1 ? 's' : ''}`,
      );
      setSelectedUserIds(new Set());
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to share view');
    } finally {
      setIsSharing(false);
    }
  };

  const handleRevoke = async (grantId: string): Promise<void> => {
    setRevokingId(grantId);
    try {
      const res = await zero.mutate(mutators.viewAccess.revoke({ id: grantId })).server;
      if (res.type === 'error') {
        toast.error(res.error?.message ?? 'Failed to remove access');
        return;
      }
      toast.success('Access removed');
      await fetchAccess();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove access');
    } finally {
      setRevokingId(null);
    }
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={open => {
        if (!open) {
          setSelectedUserIds(new Set());
          onClose();
        }
      }}
      title='Share view'
      description={`Share "${viewName}" with other users in your workspace.`}
      className='max-w-md rounded-2xl'
    >
      <div className='flex flex-col gap-4 p-5'>
        <div className='relative'>
          <Search className='absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none' />
          <Input
            autoFocus
            type='text'
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder='Search users…'
            className='pl-9 h-9'
          />
        </div>

        <div className='max-h-52 overflow-y-auto space-y-0.5'>
          {userOptions.length === 0 ? (
            <div className='p-6 text-center text-sm text-muted-foreground'>No users found</div>
          ) : (
            userOptions.map(u => {
              const isSelected = selectedUserIds.has(u.id);
              return (
                <button
                  key={u.id}
                  type='button'
                  onClick={() => toggleUser(u.id)}
                  className={cn(
                    'w-full flex items-center gap-3 px-3 py-2 rounded-md transition-all outline-none text-left',
                    isSelected
                      ? 'bg-accent text-accent-foreground'
                      : 'hover:bg-muted text-foreground',
                  )}
                  data-track-category='Projects'
                  data-track-name='ToggleShareViewUser'
                  data-track-metadata={JSON.stringify({ userId: u.id, selected: !isSelected })}
                >
                  <Avatar userId={u.id} size='md' rounded />
                  <div className='flex-1 min-w-0'>
                    <div className='text-sm font-medium truncate'>{u.name}</div>
                    {u.email && (
                      <div className='text-xs text-muted-foreground truncate'>{u.email}</div>
                    )}
                  </div>
                  {isSelected && <Check className='w-4 h-4 text-primary shrink-0' />}
                </button>
              );
            })
          )}
        </div>

        <div className='flex flex-col gap-2 border-t border-border pt-3'>
          <div className='text-xs font-medium text-muted-foreground'>Who has access</div>
          <div className='max-h-44 overflow-y-auto space-y-0.5'>
            {/* Owner (view creator) — always shown, never removable. */}
            {ownerId && (
              <div className='w-full flex items-center gap-3 px-3 py-2 rounded-md'>
                <Avatar userId={ownerId} size='md' rounded />
                <div className='flex-1 min-w-0'>
                  <div className='text-sm font-medium truncate'>
                    {ownerUser?.name ?? ownerId}
                    {ownerId === user?.id && (
                      <span className='ml-1.5 text-xs text-muted-foreground'>You</span>
                    )}
                  </div>
                  {ownerUser?.email && (
                    <div className='text-xs text-muted-foreground truncate'>{ownerUser.email}</div>
                  )}
                </div>
                <span className='flex items-center gap-1 text-xs text-muted-foreground pr-1 shrink-0'>
                  <Crown className='w-3.5 h-3.5 text-yellow-500' />
                  Owner
                </span>
              </div>
            )}

            {sharedGrants.map(({ grantId, user: sharedUser, userId }) => (
              <div
                key={grantId}
                className='w-full flex items-center gap-3 px-3 py-2 rounded-md hover:bg-muted'
              >
                <Avatar userId={userId} size='md' rounded />
                <div className='flex-1 min-w-0'>
                  <div className='text-sm font-medium truncate'>
                    {sharedUser?.name ?? userId}
                    {userId === user?.id && (
                      <span className='ml-1.5 text-xs text-muted-foreground'>You</span>
                    )}
                  </div>
                  {sharedUser?.email && (
                    <div className='text-xs text-muted-foreground truncate'>{sharedUser.email}</div>
                  )}
                </div>
                <button
                  type='button'
                  onClick={() => void handleRevoke(grantId)}
                  disabled={revokingId === grantId}
                  className='p-1 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors shrink-0 disabled:opacity-50'
                  aria-label='Remove access'
                  title='Remove access'
                  data-track-category='Projects'
                  data-track-name='RevokeShareViewUser'
                  data-track-metadata={JSON.stringify({ viewId, userId })}
                >
                  <X className='w-4 h-4' />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className='flex items-center justify-between gap-2'>
          <Button variant='ghost' size='sm' onClick={() => void handleCopyLink()}>
            <Link2 className='w-4 h-4 mr-1.5' />
            Copy link
          </Button>
          <div className='flex gap-2'>
            <Button variant='ghost' size='sm' onClick={onClose}>
              Cancel
            </Button>
            <Button
              size='sm'
              onClick={() => void handleShare()}
              disabled={selectedUserIds.size === 0 || isSharing}
            >
              <Share2 className='w-4 h-4 mr-1.5' />
              {isSharing
                ? 'Sharing…'
                : `Share${selectedUserIds.size > 0 ? ` (${selectedUserIds.size})` : ''}`}
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
};
