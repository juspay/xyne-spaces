import { ReactElement, useMemo } from 'react';
import { X } from 'lucide-react';
import Avatar from '../../ui/Avatar/Avatar';
import { useUsers } from '../../../hooks/useUsers';

interface EmailTagWithAvatarProps {
  email: string;
  onRemove: () => void;
  disabled?: boolean;
  users: ReturnType<typeof useUsers>;
}

export const EmailTagWithAvatar = ({
  email,
  onRemove,
  disabled,
  users,
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
    <div className='inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white py-1 px-1.5'>
      {/* Use Avatar component for internal users, custom fallback for external */}
      {user?.id ? (
        <Avatar
          userId={user.id}
          size='sm'
          showActiveStatus={false}
          className='!size-4 !text-[9px] !rounded-[3px]'
        />
      ) : (
        <div className='flex-shrink-0 flex items-center justify-center overflow-hidden bg-gray-200 w-4 h-4 rounded-[3px] aspect-square'>
          <span className='text-[9px] font-medium text-gray-600'>{initialLetter}</span>
        </div>
      )}
      <span className='text-sm text-gray-900 font-medium'>{displayName}</span>
      {!disabled && (
        <button
          onClick={e => {
            e.stopPropagation();
            onRemove();
          }}
          className='hover:bg-gray-100 rounded p-0.5 transition-colors'
          aria-label={`Remove ${email}`}
          data-track-category='EMAIL'
          data-track-name='RemoveEmailTag'
          data-track-metadata={JSON.stringify({ email })}
        >
          <X size={14} className='text-gray-500' />
        </button>
      )}
    </div>
  );
};
