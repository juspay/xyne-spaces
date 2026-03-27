// SmallUserAvatar.tsx
import { ReactElement } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useUser } from '../../hooks/useUsers';
import { useProfilePictureUrl } from '../../hooks/useProfilePicture';

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

  const { url: pictureUrl } = useProfilePictureUrl(targetUserId, user?.picture);

  return (
    <div
      className='w-[15px] h-[15px] rounded-full bg-muted-foreground/50 flex items-center justify-center text-[8px] font-medium text-foreground flex-shrink-0'
      style={pictureUrl ? { backgroundImage: `url(${pictureUrl})`, backgroundSize: 'cover' } : {}}
    >
      {!pictureUrl && initials}
    </div>
  );
};

export default SmallUserAvatar;
