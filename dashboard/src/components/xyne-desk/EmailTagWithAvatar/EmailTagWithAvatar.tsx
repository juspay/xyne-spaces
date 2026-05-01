import { ReactElement, useMemo, type DragEvent } from 'react';
import { X } from 'lucide-react';
import Avatar from '../../ui/Avatar/Avatar';
import { useUsers } from '../../../hooks/useUsers';

interface EmailTagWithAvatarProps {
  email: string;
  onRemove: () => void;
  disabled?: boolean;
  users: ReturnType<typeof useUsers>;
  draggable?: boolean;
  onDragStart?: (e: DragEvent<HTMLDivElement>) => void;
  onDragEnd?: (e: DragEvent<HTMLDivElement>) => void;
}

export const EmailTagWithAvatar = ({
  email,
  onRemove,
  disabled,
  users,
  draggable,
  onDragStart,
  onDragEnd,
}: EmailTagWithAvatarProps): ReactElement => {
  const user = useMemo(() => {
    return users.find(u => u.email.toLowerCase() === email.toLowerCase());
  }, [users, email]);

  const namePart = email.split('@')[0] || email;
  const fallbackDisplayName = namePart
    .split(/[._-]/)
    .map(word => (word.charAt(0) ?? '').toUpperCase() + word.slice(1))
    .join(' ');

  const displayName = user?.name || fallbackDisplayName;
  const initialLetter = (user?.name?.charAt(0) ?? namePart.charAt(0) ?? '').toUpperCase();

  return (
    <div
      className={`inline-flex items-center gap-2 rounded-lg border border-input bg-background py-1 px-1.5 ${draggable && !disabled ? 'cursor-grab active:cursor-grabbing' : ''}`}
      draggable={draggable && !disabled ? true : undefined}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      {/* Use Avatar component for internal users, custom fallback for external */}
      {user?.id ? (
        <Avatar
          userId={user.id}
          size='sm'
          showActiveStatus={false}
          className='!size-4 !text-[9px] !rounded-[3px]'
        />
      ) : (
        <div className='flex-shrink-0 flex items-center justify-center overflow-hidden bg-border w-4 h-4 rounded-[3px] aspect-square'>
          <span className='text-[9px] font-medium text-muted-foreground'>{initialLetter}</span>
        </div>
      )}
      <span className='text-sm text-foreground font-medium'>{displayName}</span>
      {!disabled && (
        <button
          onClick={e => {
            e.stopPropagation();
            onRemove();
          }}
          className='hover:bg-muted rounded p-0.5 transition-colors'
          aria-label={`Remove ${email}`}
          data-track-category='EMAIL'
          data-track-name='RemoveEmailTag'
          data-track-metadata={JSON.stringify({ email })}
        >
          <X size={14} className='text-muted-foreground' />
        </button>
      )}
    </div>
  );
};
