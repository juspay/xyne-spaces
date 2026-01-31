// SmallUserAvatar.tsx
import { ReactElement } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useUser } from '../../hooks/useUsers';

const SmallUserAvatar = ({ userId }: { userId?: string | null }): ReactElement => {
  const { user: currentUser } = useAuth();
  const targetUserId = userId || currentUser?.id || '';
  const user = useUser(targetUserId);

  const initials =
    user?.name
      ?.split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase() || '?';

  return (
    <div
      className='w-[15px] h-[15px] rounded-full bg-gray-300 flex items-center justify-center text-[8px] font-medium text-gray-700 flex-shrink-0'
      style={
        user?.picture ? { backgroundImage: `url(${user.picture})`, backgroundSize: 'cover' } : {}
      }
    >
      {!user?.picture && initials}
    </div>
  );
};

export default SmallUserAvatar;
