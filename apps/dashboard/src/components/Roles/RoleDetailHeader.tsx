import { ReactElement, RefObject } from 'react';
import { Check, Pencil, UserPlus, X } from 'lucide-react';
import { ShieldCheck } from '@xyne/icons';
import { Button } from '../ui/Button/Button';
import Input from '../ui/Input/Input';
import AvatarGroup from '../ui/Avatar/AvatarGroup';
import Tooltip from '../ui/Tooltip';
import { formatDate } from '../../utils/dateUtils';

interface RoleDetailHeaderProps {
  name: string;
  description: string | null;
  memberUserIds: string[];
  createdAt: number | undefined;
  editing: boolean;
  saving: boolean;
  editName: string;
  editDesc: string;
  editNameRef: RefObject<HTMLInputElement | null>;
  canSaveEdit: boolean;
  onEditNameChange: (value: string) => void;
  onEditDescChange: (value: string) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onAddUsers: () => void;
}

/**
 * Top band of the role detail panel, held at the app's 52px chrome height so its
 * rule continues the one under the sidebar's AppNavigator across the whole window.
 *
 * That budget buys a single line, so everything sits horizontally: identity, then
 * the two facts an admin needs before acting (who's in it, when it was set up),
 * then actions. Faces stand in for the member count — the panel answers "who is in
 * this role" before the list below has to be read. Facts drop right-to-left as the
 * panel narrows so the role name never gets crushed.
 */
const RoleDetailHeader = ({
  name,
  description,
  memberUserIds,
  createdAt,
  editing,
  saving,
  editName,
  editDesc,
  editNameRef,
  canSaveEdit,
  onEditNameChange,
  onEditDescChange,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onAddUsers,
}: RoleDetailHeaderProps): ReactElement => {
  if (editing) {
    return (
      <div className='shrink-0 flex h-[52px] items-center gap-2.5 border-b border-border px-4'>
        <Input
          ref={editNameRef}
          value={editName}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => onEditNameChange(e.target.value)}
          onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
            if (e.key === 'Enter' && canSaveEdit) onSaveEdit();
            if (e.key === 'Escape') onCancelEdit();
          }}
          maxLength={40}
          placeholder='e.g. XYNE_PM'
          aria-label='Role name'
          className='h-8 w-52 shrink-0 text-sm font-medium'
        />
        <Input
          value={editDesc}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => onEditDescChange(e.target.value)}
          onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
            if (e.key === 'Enter' && canSaveEdit) onSaveEdit();
            if (e.key === 'Escape') onCancelEdit();
          }}
          maxLength={80}
          placeholder='What is this role for?'
          aria-label='Role description'
          className='h-8 min-w-0 flex-1 text-sm'
        />
        <div className='flex shrink-0 items-center gap-1.5'>
          <Button
            size='sm'
            onClick={onSaveEdit}
            data-track-category='ROLES'
            data-track-name='SAVE_ROLE_EDIT'
            disabled={!canSaveEdit}
            loading={saving}
          >
            <Check size={14} /> Save
          </Button>
          <Button
            size='sm'
            variant='outline'
            onClick={onCancelEdit}
            data-track-category='ROLES'
            data-track-name='CANCEL_ROLE_EDIT'
            disabled={saving}
          >
            <X size={14} /> Cancel
          </Button>
        </div>
      </div>
    );
  }

  const memberCount = memberUserIds.length;

  return (
    <div className='shrink-0 flex h-[52px] items-center gap-4 border-b border-border px-4'>
      <div className='flex min-w-0 flex-1 items-center gap-2.5'>
        <span className='size-8 shrink-0 flex items-center justify-center rounded-[10px] bg-muted text-muted-foreground'>
          <ShieldCheck size={16} />
        </span>
        {/* leading-tight, not leading-none — role names are uppercase + underscores,
            and `_` clips below the baseline at zero leading. */}
        <h1 className='truncate text-base font-semibold leading-tight tracking-[-0.32px] text-foreground'>
          {name}
        </h1>
        <p className='hidden min-w-0 flex-1 truncate text-xs text-muted-foreground lg:block'>
          {description?.trim() ? description : 'No description yet'}
        </p>
      </div>

      <div className='hidden shrink-0 items-center gap-3 sm:flex'>
        <div className='flex items-center gap-2'>
          {memberCount > 0 && <AvatarGroup userIds={memberUserIds} size='sm' count={4} />}
          <span className='text-xs text-muted-foreground'>
            <span className='font-medium tabular-nums text-foreground'>{memberCount}</span>{' '}
            {memberCount === 1 ? 'member' : 'members'}
          </span>
        </div>
        {createdAt !== undefined && (
          <>
            <span className='hidden h-3 w-px bg-border xl:block' />
            <span className='hidden text-xs text-muted-foreground xl:block'>
              Created {formatDate(createdAt)}
            </span>
          </>
        )}
      </div>

      <div className='flex shrink-0 items-center gap-1.5'>
        <Tooltip content='Rename or describe this role'>
          <Button
            size='iconSm'
            variant='ghost'
            onClick={onStartEdit}
            aria-label='Edit role'
            className='rounded-lg text-muted-foreground hover:text-foreground'
            data-track-category='ROLES'
            data-track-name='StartEditRole'
          >
            <Pencil size={15} />
          </Button>
        </Tooltip>
        <Button
          size='sm'
          onClick={onAddUsers}
          data-track-category='ROLES'
          data-track-name='OpenAddMembers'
        >
          <UserPlus size={14} /> Add users
        </Button>
      </div>
    </div>
  );
};

export default RoleDetailHeader;
