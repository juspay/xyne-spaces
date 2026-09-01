import { type ReactElement, useMemo, useState } from 'react';
import { Trash2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { v4 as uuidv4 } from 'uuid';
import { Button } from '../../ui/Button/Button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/Select';
import UserAvatar, { AvatarShape, AvatarSize } from '../../UserAvatar/UserAvatar';
import { EntitySelector } from '../../ui/EntitySelector/EntitySelector';
import type { SelectorOption } from '../../ui/EntitySelector/EntitySelector.types';
import { useActiveUserSearch, useUser } from '../../../hooks/useUsers';
import { getUserDisplayName } from '../../../utils/userDisplayName';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { useZero } from '../../../hooks/useZero';
import { queries } from '../../../zero/queries';
import { mutators } from '../../../zero/mutators';

type CollaboratorRole = 'ADMIN' | 'CONTRIBUTOR';

const ROLE_OPTIONS: { value: CollaboratorRole; label: string }[] = [
  { value: 'ADMIN', label: 'Admin' },
  { value: 'CONTRIBUTOR', label: 'Contributor' },
];

interface CollaboratorsSectionProps {
  appId: string;
  appCreatedBy: string;
  currentUserId: string;
}

const CollaboratorRowName = ({ userId }: { userId: string }): ReactElement => {
  const user = useUser(userId);
  return (
    <div className='flex-1 min-w-0'>
      <span className='block text-sm text-foreground truncate'>
        {user ? getUserDisplayName(user) : 'Unknown user'}
      </span>
      {user?.email && (
        <span className='block text-[11px] text-muted-foreground truncate'>{user.email}</span>
      )}
    </div>
  );
};

/**
 * Collaborators of an app template. Admins (or the creator) can add/remove collaborators and
 * change roles; contributors see a read-only list. Rendered in template edit mode only.
 */
export const CollaboratorsSection = ({
  appId,
  appCreatedBy,
  currentUserId,
}: CollaboratorsSectionProps): ReactElement => {
  const zero = useZero();
  const [collaboratorRows] = useCachedQuery(queries.getAppCollaborators({ appId }));
  const collaborators = useMemo(() => collaboratorRows ?? [], [collaboratorRows]);

  // The creator is an implicit admin (server enforces the same rule).
  const canManage =
    appCreatedBy === currentUserId ||
    collaborators.some(c => c.userId === currentUserId && c.collaboratorType === 'ADMIN');

  const adminCount = collaborators.filter(c => c.collaboratorType === 'ADMIN').length;

  const [saving, setSaving] = useState(false);
  const [searchValue, setSearchValue] = useState('');
  const [pendingUserId, setPendingUserId] = useState<string | null>(null);
  const [pendingRole, setPendingRole] = useState<CollaboratorRole>('CONTRIBUTOR');

  // Mention-style user search: typing the first letters of a name/email lists matching users.
  const searchResults = useActiveUserSearch(searchValue, 15);
  const pendingUser = useUser(pendingUserId || '');
  const collaboratorUserIds = useMemo(
    () => new Set(collaborators.map(c => c.userId)),
    [collaborators],
  );

  const userOptions: SelectorOption[] = useMemo(() => {
    const options = searchResults
      .filter(u => !collaboratorUserIds.has(u.id))
      .map(u => ({
        value: u.id,
        label: getUserDisplayName(u),
        subtitle: u.email,
        icon: <UserAvatar userId={u.id} size={AvatarSize.SM} shape={AvatarShape.CIRCULAR} />,
      }));
    // Keep the picked user visible in the trigger even when the search no longer matches them.
    if (pendingUserId && pendingUser && !options.some(o => o.value === pendingUserId)) {
      options.unshift({
        value: pendingUser.id,
        label: getUserDisplayName(pendingUser),
        subtitle: pendingUser.email,
        icon: (
          <UserAvatar userId={pendingUser.id} size={AvatarSize.SM} shape={AvatarShape.CIRCULAR} />
        ),
      });
    }
    return options;
  }, [searchResults, collaboratorUserIds, pendingUserId, pendingUser]);

  const runMutation = async (mutation: Parameters<typeof zero.mutate>[0]): Promise<boolean> => {
    setSaving(true);
    try {
      const res = await zero.mutate(mutation).server;
      if (res.type === 'error') {
        toast.error('Failed to update collaborators', {
          description: res.error.message || 'Failed to update collaborators',
          duration: 5000,
        });
        return false;
      }
      return true;
    } finally {
      setSaving(false);
    }
  };

  const handleAdd = async (): Promise<void> => {
    if (!pendingUserId) return;
    const ok = await runMutation(
      mutators.appCollaborators.add({
        id: uuidv4(),
        appId,
        userId: pendingUserId,
        collaboratorType: pendingRole,
        timestamp: Date.now(),
      }),
    );
    if (ok) {
      setPendingUserId(null);
      setPendingRole('CONTRIBUTOR');
      setSearchValue('');
      toast.success('Collaborator added');
    }
  };

  const handleRoleChange = async (
    collaboratorId: string,
    role: CollaboratorRole,
  ): Promise<void> => {
    await runMutation(
      mutators.appCollaborators.updateRole({
        id: collaboratorId,
        collaboratorType: role,
        timestamp: Date.now(),
      }),
    );
  };

  const handleRemove = async (collaboratorId: string): Promise<void> => {
    const ok = await runMutation(mutators.appCollaborators.remove({ id: collaboratorId }));
    if (ok) toast.success('Collaborator removed');
  };

  return (
    <div className='space-y-3'>
      {/* Header mirrors the revamped EditAppForm SectionHeading (title + muted subtitle). */}
      <div>
        <p className='text-base font-semibold text-foreground'>Collaborators</p>
        <p className='text-sm text-muted-foreground mt-0.5'>
          Admins manage collaborators; contributors can edit the app.
        </p>
      </div>

      {collaborators.length === 0 ? (
        <p className='text-xs text-muted-foreground py-2'>
          No collaborators yet. Only the app creator can edit this app.
        </p>
      ) : (
        <div className='border border-border rounded-md divide-y divide-border'>
          {collaborators.map(collaborator => {
            // The only admin can't be removed or demoted (server enforces this too).
            const isLastAdmin = collaborator.collaboratorType === 'ADMIN' && adminCount <= 1;
            return (
              <div key={collaborator.id} className='flex items-center gap-2.5 px-3 py-2'>
                <UserAvatar
                  userId={collaborator.userId}
                  size={AvatarSize.SM}
                  shape={AvatarShape.CIRCULAR}
                  showActiveStatus={false}
                />
                <CollaboratorRowName userId={collaborator.userId} />
                {canManage ? (
                  <>
                    <Select
                      value={collaborator.collaboratorType}
                      onValueChange={value =>
                        void handleRoleChange(collaborator.id, value as CollaboratorRole)
                      }
                      disabled={saving || isLastAdmin}
                    >
                      <SelectTrigger
                        className='w-32 h-8 text-xs'
                        title={isLastAdmin ? 'An app must keep at least one admin' : undefined}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ROLE_OPTIONS.map(option => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      type='button'
                      variant='ghost'
                      size='sm'
                      className='h-8 w-8 p-0 text-muted-foreground hover:text-destructive'
                      disabled={saving || isLastAdmin}
                      title={
                        isLastAdmin ? 'An app must keep at least one admin' : 'Remove collaborator'
                      }
                      onClick={() => void handleRemove(collaborator.id)}
                      data-track-category='Apps'
                      data-track-name='RemoveAppCollaborator'
                    >
                      <Trash2 size={14} />
                    </Button>
                  </>
                ) : (
                  <span className='text-xs text-muted-foreground'>
                    {collaborator.collaboratorType === 'ADMIN' ? 'Admin' : 'Contributor'}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {canManage && (
        <div className='flex items-center gap-2'>
          <div className='flex-1 min-w-0'>
            <EntitySelector
              options={userOptions}
              selectedValue={pendingUserId}
              onSelect={setPendingUserId}
              placeholder='Add collaborator'
              searchPlaceholder='Search users...'
              isLoading={false}
              width='100%'
              onSearchChange={setSearchValue}
              disableClientFiltering={true}
            />
          </div>
          <Select
            value={pendingRole}
            onValueChange={value => setPendingRole(value as CollaboratorRole)}
            disabled={saving}
          >
            <SelectTrigger className='w-32 h-9 text-xs'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ROLE_OPTIONS.map(option => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type='button'
            size='sm'
            variant='outline'
            className='h-9 gap-1'
            disabled={saving || !pendingUserId}
            onClick={() => void handleAdd()}
            data-track-category='Apps'
            data-track-name='AddAppCollaborator'
          >
            <Plus size={14} />
            Add
          </Button>
        </div>
      )}
    </div>
  );
};

export default CollaboratorsSection;
